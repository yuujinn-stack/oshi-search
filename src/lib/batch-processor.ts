// バッチ処理の中核ロジック
// 呼び出し元: /api/admin/batch (管理画面から手動) / /api/cron/refresh (Vercel Cron)
// ユーザーのページアクセス時には絶対に呼ばない

import { getAllPersonsWithConfig } from './persons';
import { getProductsByCategory } from './rakuten';
import { storeProducts, saveBatchMeta, CATEGORIES } from './product-store';
import { getAllVerdicts, saveVerdict } from './judgment-store';
import { judgeProducts, shouldAutoApprove, PROMPT_VERSION } from './ai-judge';
import type { RakutenItem } from '@/types/rakuten';
import type { PersonWithConfig } from '@/types/person';

// 1人あたりの AI 呼び出し上限（Vercel の 300s タイムアウト対策）
const MAX_AI_PER_PERSON = 150;

// 問題商品追跡キーワード（Vercelログで各ステップを追跡する）
const TRACK_TITLE_TERMS = ['感情の隙間', '1st写真集', '2nd写真集', '3rd写真集'];

function isTracked(title: string): boolean {
  return TRACK_TITLE_TERMS.some((t) => title.includes(t));
}

function trackLog(msg: string): void {
  console.log(`[batch:TRACK] ${msg}`);
}

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
// forceRejudge=true の場合: ai判定済み商品も再判定（manual は常に保持）
// configOverride: persons_master.json にない人物（CSVインポート組）を処理するときに使う
export async function processPerson(
  personName: string,
  forceRejudge = false,
  configOverride?: PersonWithConfig,
): Promise<PersonBatchResult> {
  const all = getAllPersonsWithConfig();
  const person = configOverride ?? all.find((p) => p.name === personName);
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

    // 追跡対象商品がAPI取得されたかログ（ステップ1・2）
    for (const p of products) {
      if (isTracked(p.title)) {
        trackLog(`✅ ステップ1: 楽天API取得 | cat=${cat}`);
        trackLog(`   title="${p.title}"`);
        trackLog(`   id=${p.id} | url=${p.itemUrl}`);
        trackLog(`   → ステップ2: Redis(storeProducts)へ保存開始`);
      }
    }

    await storeProducts(person.name, cat, products);
    stored += products.length;

    // storeProducts 完了後ログ（ステップ2）
    for (const p of products) {
      if (isTracked(p.title)) {
        trackLog(`✅ ステップ2: Redis保存完了 | cat=${cat} | id=${p.id}`);
      }
    }

    let catExcluded = 0, catSkipped = 0, catNew = 0;
    for (const p of products) {
      const tracked = isTracked(p.title);

      // 除外キーワード一致 → 即 unrelated（AI 不要な明確なケース）
      if (excludeKeywords.some((kw) => p.title.includes(kw))) {
        console.log(`[batch]   除外KW一致: id=${p.id} | "${p.title.slice(0, 60)}"`);
        if (tracked) {
          trackLog(`❌ ステップ3: 除外KWにより unrelated 保存`);
          trackLog(`   title="${p.title}"`);
          trackLog(`   id=${p.id} | 公開表示: ❌ 表示対象外（除外KW）`);
        }
        await saveVerdict(person.name, p.id, 'unrelated', 0, 'auto', '除外キーワード一致');
        excluded++;
        catExcluded++;
        continue;
      }

      // ━━━ 最優先: deleted (管理者が手動削除) は何があってもスキップ ━━━
      if (existingVerdicts[p.id]?.verdict === 'deleted') {
        skipped++;
        catSkipped++;
        continue;
      }

      // ━━━ 優先度1: 自動承認チェック（スキップ判定より前に実行）━━━
      // 既存の ai 判定が unrelated でも、条件を満たす商品は即 related で上書きする
      // 例: 人物名+写真集がタイトルに含まれる、グループCDのアーティスト名が一致する
      if (shouldAutoApprove(p, person)) {
        if (tracked) {
          trackLog(`✅ ステップ3: 自動承認（スキップより優先）`);
          trackLog(`   title="${p.title}"`);
          trackLog(`   id=${p.id} | → related/95 で保存`);
          trackLog(`   公開表示: ✅ 表示対象（related & score=95）`);
        }
        console.log(`[batch]   自動承認: id=${p.id} | "${p.title.slice(0, 60)}"`);
        await saveVerdict(person.name, p.id, 'related', 95, 'ai', '自動承認（人物名+写真集 or グループCD）', PROMPT_VERSION);
        aiJudged++;
        catNew++;
        console.log(`[PUBLIC_FILTER] itemTitle:"${p.title.slice(0, 60)}" category:${cat} label:related score:95 isPublic:true`);
        continue;
      }

      const existing = existingVerdicts[p.id];

      // ━━━ 優先度2: manual 判定は常に保持 ━━━
      if (existing?.source === 'manual') {
        if (tracked) {
          const displayable = existing.verdict === 'related' && existing.score >= 70;
          trackLog(`⏭ ステップ3: manual判定済みのためスキップ`);
          trackLog(`   title="${p.title}"`);
          trackLog(`   id=${p.id} | verdict=${existing.verdict} | score=${existing.score}`);
          trackLog(`   公開表示: ${displayable ? '✅ 表示対象' : `❌ 非表示（verdict=${existing.verdict}, score=${existing.score}）`}`);
        }
        const displayable = existing.verdict === 'related' && existing.score >= 70;
        console.log(`[PUBLIC_FILTER] itemTitle:"${p.title.slice(0, 60)}" category:${cat} label:${existing.verdict} score:${existing.score} manualStatus:manual isPublic:${displayable}`);
        skipped++;
        catSkipped++;
        continue;
      }

      // ━━━ 優先度3: ai 判定済みはスキップ（forceRejudge=true またはプロンプト変更時は再判定） ━━━
      if (existing?.source === 'ai') {
        const promptOutdated = existing.promptVersion !== PROMPT_VERSION;
        if (!forceRejudge && !promptOutdated) {
          if (tracked) {
            const displayable = existing.verdict === 'related' && existing.score >= 70;
            trackLog(`⏭ ステップ3: ai判定済みのためスキップ（promptVersion=${existing.promptVersion ?? '旧'}）`);
            trackLog(`   title="${p.title}"`);
            trackLog(`   id=${p.id} | verdict=${existing.verdict} | score=${existing.score}`);
            trackLog(`   公開表示: ${displayable ? '✅ 表示対象' : `❌ 非表示（verdict=${existing.verdict}, score=${existing.score}）`}`);
            if (existing.reason) trackLog(`   AI理由: "${existing.reason}"`);
          }
          const displayable = existing.verdict === 'related' && existing.score >= 70;
          console.log(`[PUBLIC_FILTER] itemTitle:"${p.title.slice(0, 60)}" category:${cat} label:${existing.verdict} score:${existing.score} isPublic:${displayable}`);
          skipped++;
          catSkipped++;
          continue;
        }
        // promptVersion が違うか forceRejudge → 再判定へ
        if (promptOutdated) {
          console.log(`[batch]   プロンプト更新再判定: ${existing.promptVersion ?? '旧'} → ${PROMPT_VERSION} | "${p.title.slice(0, 50)}"`);
        }
      }

      // ━━━ 優先度4: 未判定 / auto 判定 / 再判定対象 → AI キューへ ━━━
      if (tracked) {
        trackLog(`🎯 ステップ3→4: AI判定キューへ追加`);
        trackLog(`   title="${p.title}"`);
        trackLog(`   id=${p.id} | 既存verdict=${existing?.source ?? 'なし'}${forceRejudge ? ' (forceRejudge)' : ''}`);
      }
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
        if (product && isTracked(product.title)) {
          trackLog(`❌ ステップ5: AI→null (APIエラー)`);
          trackLog(`   title="${product.title}"`);
          trackLog(`   id=${id} | 公開表示: ❌ AI判定失敗のため非表示`);
        }
        continue;
      }
      const product = batch.find((p) => p.id === id);
      if (!product) continue;
      const displayable = result.verdict === 'related' && result.score >= 70;
      console.log(`[batch]   AI→${result.verdict} score=${result.score} reason="${result.reason}" | "${product.title.slice(0, 40)}"`);
      console.log(`[PUBLIC_FILTER] itemTitle:"${product.title.slice(0, 60)}" category:${product.category} label:${result.verdict} score:${result.score} isPublic:${displayable} excludeReason:${displayable ? 'none' : `verdict=${result.verdict} score=${result.score}`}`);
      if (isTracked(product.title)) {
        trackLog(`🤖 ステップ5: AI判定完了 → Redis保存`);
        trackLog(`   title="${product.title}"`);
        trackLog(`   id=${id} | verdict=${result.verdict} | score=${result.score}`);
        trackLog(`   reason="${result.reason}"`);
        trackLog(`   公開表示: ${displayable ? '✅ 表示対象（related & score>=70）' : `❌ 非表示（verdict=${result.verdict}, score=${result.score}）`}`);
      }
      await saveVerdict(
        person.name, id, result.verdict, result.score, 'ai', result.reason, PROMPT_VERSION
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
