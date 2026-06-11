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
  stored: number;       // 今回取得・保存した商品数
  aiJudged: number;     // AI判定結果を保存した商品数
  aiQueued: number;     // AI判定に送った商品数（aiJudged と差がある場合はAPIエラー）
  skipped: number;      // 既存判定(ai/manual)があるためスキップした商品数
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
    return { personName, stored: 0, aiJudged: 0, aiQueued: 0, skipped: 0, excluded: 0, error: '人物が見つかりません' };
  }

  const excludeKeywords = person.config.excludeKeywords ?? [];
  const existingVerdicts = await getAllVerdicts(person.name);

  let stored = 0;
  let aiJudged = 0;
  let aiQueued = 0;
  let skipped = 0;
  let excluded = 0;
  const toJudge: RakutenItem[] = [];

  const apiKeyStatus = process.env.OPENAI_API_KEY
    ? `設定あり(${process.env.OPENAI_API_KEY.length}文字)`
    : '★未設定★';
  console.log(`[batch] ===== 開始: ${personName} (OPENAI_API_KEY=${apiKeyStatus}) =====`);
  console.log(`[batch] 既存verdicts: ${Object.keys(existingVerdicts).length}件 (ai=${Object.values(existingVerdicts).filter(v=>v.source==='ai').length}, manual=${Object.values(existingVerdicts).filter(v=>v.source==='manual').length}, auto=${Object.values(existingVerdicts).filter(v=>v.source==='auto').length})`);

  // カテゴリ毎に楽天API取得 → Redis保存 → 判定分類
  for (const cat of CATEGORIES) {
    const result = await getProductsByCategory(
      person.name, person.group, cat, person.config, 'no-store'
    );
    const products = result.status === 'ok' ? result.products : [];

    console.log(`[batch] ${cat}: ${products.length}件取得 (API status=${result.status})`);

    await storeProducts(person.name, cat, products);
    stored += products.length;

    let catExcluded = 0, catSkipped = 0, catNew = 0;
    for (const p of products) {
      // 除外キーワード一致 → 即 unrelated（AI 不要な明確なケース）
      if (excludeKeywords.some((kw) => p.title.includes(kw))) {
        console.log(`[batch]   除外KW一致: id=${p.id} | "${p.title.slice(0, 60)}"`);
        await saveVerdict(person.name, p.id, 'unrelated', 0, 'auto', '除外キーワード一致');
        excluded++;
        catExcluded++;
        continue;
      }

      const existing = existingVerdicts[p.id];
      if (existing && (existing.source === 'manual' || existing.source === 'ai')) {
        // 手動・AI 判定済みは保持（再判定コストを避ける）
        skipped++;
        catSkipped++;
        continue;
      }

      // 未判定 or auto判定 → AI 判定キューへ
      console.log(`[batch]   AI対象: id=${p.id} existing=${existing?.source ?? 'なし'} | "${p.title.slice(0, 60)}"`);
      toJudge.push(p);
      catNew++;
    }

    console.log(`[batch] ${cat} 集計: 新規=${catNew} スキップ(判定済)=${catSkipped} 除外KW=${catExcluded}`);
  }

  console.log(`[batch] --- 全カテゴリ集計: 取得=${stored} 新規(AI対象)=${toJudge.length} スキップ=${skipped} 除外=${excluded} ---`);
  console.log(`[batch] --- AI判定チェック: OPENAI_API_KEY=${apiKeyStatus} ---`);

  if (toJudge.length === 0) {
    console.log(`[batch] AI判定なし: 全商品が判定済みまたは除外KW一致`);
  } else if (!process.env.OPENAI_API_KEY) {
    console.log(`[batch] ★AI判定スキップ: OPENAI_API_KEY が未設定★`);
  } else {
    const batch = toJudge.slice(0, MAX_AI_PER_PERSON);
    aiQueued = batch.length;
    if (toJudge.length > MAX_AI_PER_PERSON) {
      console.log(`[batch] AI判定上限により ${toJudge.length - MAX_AI_PER_PERSON}件をスキップ（次回バッチで処理）`);
    }
    console.log(`[batch] AI判定開始: ${batch.length}件を送信`);

    const aiResults = await judgeProducts(batch, person);

    for (const { id, result } of aiResults) {
      if (!result) {
        const product = batch.find((p) => p.id === id);
        console.log(`[batch]   AI→null (APIエラー) id=${id} | "${product?.title.slice(0, 40) ?? '不明'}"`);
        continue;
      }
      const product = batch.find((p) => p.id === id);
      if (!product) continue;
      console.log(`[batch]   AI→${result.verdict} score=${result.score} reason="${result.reason}" | "${product.title.slice(0, 40)}"`);
      await saveVerdict(
        person.name, id, result.verdict, result.score, 'ai', result.reason
      );
      aiJudged++;
    }

    if (aiJudged < aiQueued) {
      console.log(`[batch] ★警告: AI送信${aiQueued}件のうち${aiQueued - aiJudged}件が保存されませんでした（APIエラー？）`);
    }
  }

  console.log(`[batch] ===== 完了: ${personName} 取得=${stored} AI対象=${aiQueued} AI完了=${aiJudged} スキップ=${skipped} 除外=${excluded} =====`);
  return { personName, stored, aiJudged, aiQueued, skipped, excluded };
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
        aiQueued: 0,
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
