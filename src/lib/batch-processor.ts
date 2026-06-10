// バッチ処理の中核ロジック
// 呼び出し元: /api/admin/batch (管理画面から手動) / /api/cron/refresh (Vercel Cron)
// ユーザーのページアクセス時には絶対に呼ばない

import { getAllPersonsWithConfig } from './persons';
import { getProductsByCategory } from './rakuten';
import { storeProducts, saveBatchMeta, CATEGORIES } from './product-store';
import { getAllVerdicts, saveVerdict } from './judgment-store';
import { judgeProducts } from './ai-judge';
import type { RakutenItem } from '@/types/rakuten';

// 1人あたりの AI 呼び出し上限（Vercel の 300s タイムアウト対策）
const MAX_AI_PER_PERSON = 150;

export interface PersonBatchResult {
  personName: string;
  stored: number;       // Redisに保存した商品数
  aiJudged: number;     // AIで判定した商品数
  skipped: number;      // 既存判定ありのためスキップした商品数
  excluded: number;     // 除外キーワード一致でスキップした商品数
  error?: string;
}

export interface BatchSummary {
  startedAt: number;
  finishedAt: number;
  persons: PersonBatchResult[];
  totalAiCalls: number;
}

// 人物1人分のバッチ処理
export async function processPerson(
  personName: string,
): Promise<PersonBatchResult> {
  const all = getAllPersonsWithConfig();
  const person = all.find((p) => p.name === personName);
  if (!person) {
    return { personName, stored: 0, aiJudged: 0, skipped: 0, excluded: 0, error: '人物が見つかりません' };
  }

  const excludeKeywords = person.config.excludeKeywords ?? [];
  const existingVerdicts = await getAllVerdicts(person.name);

  let stored = 0;
  let aiJudged = 0;
  let skipped = 0;
  let excluded = 0;
  const toJudge: RakutenItem[] = [];

  const apiKeyStatus = process.env.OPENAI_API_KEY
    ? `設定あり(${process.env.OPENAI_API_KEY.length}文字)`
    : '★未設定★';
  console.log(`[batch] ===== 開始: ${personName} (OPENAI_API_KEY=${apiKeyStatus}) =====`);

  // カテゴリ毎に楽天API取得 → Redis保存 → 判定分類
  for (const cat of CATEGORIES) {
    const result = await getProductsByCategory(
      person.name, person.group, cat, person.config, 'no-store'
    );
    const products = result.status === 'ok' ? result.products : [];

    console.log(`[batch] ${cat}: ${products.length}件取得 (API status=${result.status})`);

    await storeProducts(person.name, cat, products);
    stored += products.length;

    for (const p of products) {
      // 除外キーワード一致 → 即 unrelated（AI 不要な明確なケース）
      if (excludeKeywords.some((kw) => p.title.includes(kw))) {
        await saveVerdict(person.name, p.id, 'unrelated', 0, 'auto', '除外キーワード一致');
        excluded++;
        continue;
      }

      const existing = existingVerdicts[p.id];
      if (existing && (existing.source === 'manual' || existing.source === 'ai')) {
        // 手動・AI 判定済みは保持（再判定コストを避ける）
        skipped++;
        continue;
      }

      // 未判定 or auto判定 → AI 判定キューへ
      toJudge.push(p);
    }
  }

  console.log(`[batch] --- AI判定チェック: 対象=${toJudge.length}件 / OPENAI_API_KEY=${apiKeyStatus} ---`);

  if (toJudge.length === 0) {
    console.log(`[batch] AI判定なし: 全商品スキップ済み`);
  } else if (!process.env.OPENAI_API_KEY) {
    console.log(`[batch] ★AI判定スキップ: OPENAI_API_KEY が未設定★`);
  } else {
    const batch = toJudge.slice(0, MAX_AI_PER_PERSON);
    if (toJudge.length > MAX_AI_PER_PERSON) {
      console.log(`[batch] AI判定上限により ${toJudge.length - MAX_AI_PER_PERSON}件をスキップ（次回バッチで処理）`);
    }
    console.log(`[batch] AI判定開始: ${batch.length}件を送信`);

    const aiResults = await judgeProducts(batch, person);

    for (const { id, result } of aiResults) {
      if (!result) {
        console.log(`[batch]   AI→null (APIエラー) id=${id}`);
        continue;
      }
      const product = batch.find((p) => p.id === id);
      if (!product) continue;
      console.log(`[batch]   AI→${result.verdict} score=${result.score} reason="${result.reason}" | ${product.title.slice(0, 40)}`);
      await saveVerdict(
        person.name, id, result.verdict, result.score, 'ai', result.reason
      );
      aiJudged++;
    }
  }

  console.log(`[batch] ===== 完了: ${personName} stored=${stored} ai=${aiJudged} skip=${skipped} excluded=${excluded} =====`);
  return { personName, stored, aiJudged, skipped, excluded };
}

// 全人物を処理（Cron/管理画面から呼ぶ）
export async function processAllPersons(): Promise<BatchSummary> {
  const persons = getAllPersonsWithConfig();
  const startedAt = Date.now();
  const results: PersonBatchResult[] = [];

  for (const person of persons) {
    try {
      const result = await processPerson(person.name);
      results.push(result);
    } catch (err) {
      results.push({
        personName: person.name,
        stored: 0,
        aiJudged: 0,
        skipped: 0,
        excluded: 0,
        error: String(err),
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const finishedAt = Date.now();
  const totalAiCalls = results.reduce((s, r) => s + r.aiJudged, 0);

  await saveBatchMeta({
    lastRunAt: finishedAt,
    personCount: persons.length,
    aiJudged: totalAiCalls,
  });

  return { startedAt, finishedAt, persons: results, totalAiCalls };
}
