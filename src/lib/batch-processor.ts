// バッチ処理の中核ロジック
// 呼び出し元: /api/admin/batch (管理画面から手動) / /api/cron/refresh (Vercel Cron)
// ユーザーのページアクセス時には絶対に呼ばない

import { getAllPersonsWithConfig } from './persons';
import { getProductsByCategory } from './rakuten';
import { storeProducts, saveBatchMeta, CATEGORIES } from './product-store';
import { getAllVerdicts, saveVerdict } from './judgment-store';
import { judgeProducts } from './ai-judge';
import { isBorderline, isDisplayable } from './scoring';
import type { RakutenItem } from '@/types/rakuten';

const MAX_AI_CALLS_PER_BATCH = 50; // バッチ全体でのAI上限（コスト制御）

export interface PersonBatchResult {
  personName: string;
  stored: number;       // Redisに保存した商品数
  autoClassified: number; // ルールで自動判定した商品数
  aiJudged: number;       // AIで判定した商品数
  skipped: number;        // 既存判定ありのためスキップした商品数
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
  remainingAiCalls: { count: number } // 参照渡しでAI残り呼び出し数を共有
): Promise<PersonBatchResult> {
  const all = getAllPersonsWithConfig();
  const person = all.find((p) => p.name === personName);
  if (!person) {
    return { personName, stored: 0, autoClassified: 0, aiJudged: 0, skipped: 0, error: '人物が見つかりません' };
  }

  const strictMode = person.config.strictMode ?? false;
  const existingVerdicts = await getAllVerdicts(person.name);

  let stored = 0;
  let autoClassified = 0;
  let aiJudged = 0;
  let skipped = 0;
  const borderline: RakutenItem[] = [];

  // カテゴリ毎に楽天API取得 → Redis保存 → 自動判定
  for (const cat of CATEGORIES) {
    const result = await getProductsByCategory(
      person.name, person.group, cat, person.config, 'no-store'
    );
    const products = result.status === 'ok' ? result.products : [];

    // 取得した商品を全件 Redis に保存（管理画面で全商品を確認できるように）
    await storeProducts(person.name, cat, products);
    stored += products.length;

    for (const p of products) {
      if (existingVerdicts[p.id]) {
        skipped++; // 既判定: スキップ（AIを再実行しない）
        continue;
      }

      if (isDisplayable(p.relevanceScore, strictMode)) {
        // スコアが閾値以上 → 確実に関連あり → 自動判定
        await saveVerdict(person.name, p.id, 'relevant', p.relevanceScore, 'auto');
        autoClassified++;
      } else if (p.relevanceScore < 0) {
        // 除外キーワード一致 → 確実に無関係 → 自動判定
        await saveVerdict(person.name, p.id, 'unrelated', p.relevanceScore, 'auto');
        autoClassified++;
      } else if (isBorderline(p.relevanceScore, strictMode)) {
        // 曖昧な商品 → AI判定候補へ
        borderline.push(p);
      }
    }
  }

  // AI判定（バッチ全体の上限に達していなければ実行）
  if (borderline.length > 0 && remainingAiCalls.count > 0 && process.env.OPENAI_API_KEY) {
    const toJudge = borderline.slice(0, remainingAiCalls.count);
    remainingAiCalls.count -= toJudge.length;

    const aiResults = await judgeProducts(
      toJudge.map((p) => ({ id: p.id, title: p.title })),
      person.name,
      person.group
    );

    for (const { id, result } of aiResults) {
      if (!result) continue;
      const product = toJudge.find((p) => p.id === id);
      if (!product) continue;
      await saveVerdict(
        person.name, id, result.verdict, product.relevanceScore, 'ai', result.reason
      );
      aiJudged++;
    }
  }

  return { personName, stored, autoClassified, aiJudged, skipped };
}

// 全人物を処理（Cron/管理画面から呼ぶ）
export async function processAllPersons(): Promise<BatchSummary> {
  const persons = getAllPersonsWithConfig();
  const startedAt = Date.now();
  const results: PersonBatchResult[] = [];
  const remainingAiCalls = { count: MAX_AI_CALLS_PER_BATCH };

  for (const person of persons) {
    try {
      const result = await processPerson(person.name, remainingAiCalls);
      results.push(result);
    } catch (err) {
      results.push({
        personName: person.name,
        stored: 0,
        autoClassified: 0,
        aiJudged: 0,
        skipped: 0,
        error: String(err),
      });
    }
    // Rakuten APIレート制限回避のため人物間に小間隔を入れる
    await new Promise((r) => setTimeout(r, 300));
  }

  const finishedAt = Date.now();
  const totalAiCalls = results.reduce((s, r) => s + r.aiJudged, 0);

  // バッチ実行情報を保存（管理画面で表示）
  await saveBatchMeta({
    lastRunAt: finishedAt,
    personCount: persons.length,
    aiJudged: totalAiCalls,
  });

  return { startedAt, finishedAt, persons: results, totalAiCalls };
}
