// バッチ処理の中核ロジック
// 呼び出し元: /api/admin/batch (管理画面から手動) / /api/cron/refresh (Vercel Cron)
// ユーザーのページアクセス時には絶対に呼ばない

import { getAllPersonsWithConfig, getAllPersonsMerged } from './persons';
import { getProductsByCategory } from './rakuten';
import { storeProducts, saveBatchMeta, CATEGORIES } from './product-store';
import { getAllVerdicts, saveVerdict } from './judgment-store';
import { judgeProducts, shouldAutoApprove, PROMPT_VERSION } from './ai-judge';
import { checkPostMembershipGroupContent } from './product-membership-guard';
import { getPersonMeta } from './person-meta';
import type { RakutenItem } from '@/types/rakuten';
import type { PersonWithConfig } from '@/types/person';

// 1人あたりの AI 呼び出し上限（Vercel の 300s タイムアウト対策）
const MAX_AI_PER_PERSON = 150;

// 中古商品の保存上限（新品が多い場合に中古で埋め尽くされるのを防ぐ）
const MAX_USED_ITEMS_STORED = 50;

// 中古タイトル正規化（新品との重複チェック用: 【中古】プレフィックスを除去してから比較）
function normalizeForUsedDedup(title: string): string {
  return title.replace(/^【中古】\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

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
  stored: number;              // 今回楽天APIから取得・保存した商品数（カテゴリ合計）
  aiJudged: number;            // AI API呼び出しで判定を保存した商品数（自動承認は含まない）
  aiQueued: number;            // AI APIへ送信した商品数（aiJudged + aiFailed = aiQueued）
  autoApproved: number;        // ルールベース自動承認された商品数（人物名+写真集 or グループCD等）
  skipped: number;             // 既存判定(ai/manual)があるためスキップした商品数
  excluded: number;            // 除外キーワード一致でスキップした商品数
  usedSuppressed: number;      // 中古dedup: 新品と重複して除外した商品数
  membershipFiltered: number;  // 卒業後グループ商品候補として確認待ちにした商品数
  // --- 追加診断フィールド ---
  fetchFailed: number;             // 楽天APIエラーになったカテゴリ数（upstream_error / error）
  failedCategories: string[];      // 取得に失敗したカテゴリ名のリスト
  aiFailed: number;                // AI判定エラー件数（aiQueued - aiJudged）
  aiKeyMissing: boolean;           // true=OPENAI_API_KEY未設定でAI判定スキップ
  relatedCount: number;            // AI判定（API呼び出し分のみ）で related になった件数
  unrelatedCount: number;          // AI判定（API呼び出し分のみ）で unrelated になった件数
  uncertainCount: number;          // AI判定（API呼び出し分のみ）で uncertain になった件数
  rakutenConfigMissing: boolean;   // true=RAKUTEN_APP_ID/ACCESS_KEY が未設定または空文字
  upstreamHttpStatus?: number;     // 楽天APIが返した最初の 4xx/5xx ステータスコード
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
  aiLimit?: number,
): Promise<PersonBatchResult> {
  const all = getAllPersonsWithConfig();
  const person = configOverride ?? all.find((p) => p.name === personName);
  if (!person) {
    return {
      personName, stored: 0, aiJudged: 0, aiQueued: 0, autoApproved: 0, skipped: 0, excluded: 0,
      usedSuppressed: 0, membershipFiltered: 0,
      fetchFailed: 0, failedCategories: [], aiFailed: 0, aiKeyMissing: false,
      relatedCount: 0, unrelatedCount: 0, uncertainCount: 0,
      rakutenConfigMissing: false,
      error: '人物が見つかりません',
    };
  }

  const excludeKeywords = person.config.excludeKeywords ?? [];
  const existingVerdicts = await getAllVerdicts(person.name);
  const personMeta = await getPersonMeta(person.name);

  let stored = 0;
  let aiJudged = 0;
  let aiQueued = 0;
  let autoApproved = 0;
  let skipped = 0;
  let excluded = 0;
  let usedSuppressed = 0;
  let membershipFiltered = 0;
  let fetchFailed = 0;
  const failedCategories: string[] = [];
  let relatedCount = 0;
  let unrelatedCount = 0;
  let uncertainCount = 0;
  let rakutenConfigMissing = false;
  let upstreamHttpStatus: number | undefined = undefined;
  const toJudge: RakutenItem[] = [];

  const apiKeyStatus = process.env.OPENAI_API_KEY
    ? `設定あり(${process.env.OPENAI_API_KEY.length}文字)`
    : '★未設定★';
  console.log(`[batch] ===== 開始: ${personName} (OPENAI_API_KEY=${apiKeyStatus}) =====`);
  console.log(`[batch] 既存verdicts: ${Object.keys(existingVerdicts).length}件 (ai=${Object.values(existingVerdicts).filter(v=>v.source==='ai').length}, manual=${Object.values(existingVerdicts).filter(v=>v.source==='manual').length}, auto=${Object.values(existingVerdicts).filter(v=>v.source==='auto').length})`);

  // 新品商品タイトルセット（中古カテゴリでの重複抑制に使用）
  const newTitleSet = new Set<string>();

  // verdict 済み商品 ID セット（storeProducts で保持対象を特定するために使用）
  const existingVerdictIds = new Set(Object.keys(existingVerdicts));

  // カテゴリ毎に楽天API取得 → Redis保存 → 判定分類
  for (const cat of CATEGORIES) {
    const result = await getProductsByCategory(
      person.name, person.group, cat, person.config, 'no-store'
    );
    if (result.status === 'config_missing') {
      // 全カテゴリ同じ結果になるため早期脱出（変数名のみログ出力・値は出さない）
      rakutenConfigMissing = true;
      console.log(`[batch] 楽天API設定不足: RAKUTEN_APP_ID または RAKUTEN_ACCESS_KEY が未設定 (${personName})`);
      break;
    }
    if (result.status === 'upstream_error') {
      fetchFailed++;
      failedCategories.push(cat);
      if (upstreamHttpStatus === undefined) upstreamHttpStatus = result.httpStatus;
      console.log(`[batch] ${cat}: 楽天API upstreamエラー HTTP ${result.httpStatus} (fetchFailed=${fetchFailed})`);
    } else if (result.status === 'error') {
      fetchFailed++;
      failedCategories.push(cat);
      console.log(`[batch] ${cat}: 楽天APIネットワークエラー (fetchFailed=${fetchFailed})`);
    }
    let products = result.status === 'ok' ? result.products : [];

    // 中古カテゴリ: 同一タイトルの新品が既に取得済みなら除外し、保存件数を上限内に制限
    if (cat === '中古' && products.length > 0) {
      const beforeDedup = products.length;
      products = products.filter((p) => !newTitleSet.has(normalizeForUsedDedup(p.title)));
      const suppressed = beforeDedup - products.length;
      usedSuppressed += suppressed;
      if (suppressed > 0) {
        console.log(`[batch] 中古dedup: 新品と重複する${suppressed}件を除外 (残=${products.length}件)`);
      }
      if (products.length > MAX_USED_ITEMS_STORED) {
        console.log(`[batch] 中古上限: ${products.length}件 → ${MAX_USED_ITEMS_STORED}件に制限`);
        products = products.slice(0, MAX_USED_ITEMS_STORED);
      }
    }

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

    try {
      await storeProducts(person.name, cat, products, existingVerdictIds);
    } catch (err) {
      console.error(`[batch] DB保存失敗 cat=${cat} personName=${personName}: ${String(err)}`);
      return {
        personName, stored, aiJudged: 0, aiQueued: 0, autoApproved, skipped, excluded,
        usedSuppressed, membershipFiltered,
        fetchFailed, failedCategories, aiFailed: 0, aiKeyMissing: false,
        relatedCount: 0, unrelatedCount: 0, uncertainCount: 0,
        rakutenConfigMissing: false, upstreamHttpStatus,
        error: `DB保存失敗: ${cat}`,
      };
    }
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
        autoApproved++;
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

      // ━━━ 優先度3.5: 卒業後グループ商品候補チェック ━━━
      // manual・shouldAutoApprove 済は上でスキップ済みのため非影響
      // ai 判定済み（スキップ対象外のもの = outdated or forceRejudge）も対象にする
      if (personMeta) {
        const guardResult = checkPostMembershipGroupContent(
          p.title,
          person.name,
          person.config.aliases ?? [],
          personMeta,
        );
        if (guardResult.shouldReview) {
          if (tracked) {
            trackLog(`🎓 ステップ3.5: 卒業後グループ商品候補 → uncertain 保存`);
            trackLog(`   title="${p.title}"`);
            trackLog(`   id=${p.id} | reason="${guardResult.reason}"`);
          }
          console.log(`[batch]   卒業後グループ商品候補: id=${p.id} | "${p.title.slice(0, 60)}"`);
          await saveVerdict(person.name, p.id, 'uncertain', 0, 'auto', guardResult.reason);
          membershipFiltered++;
          catNew++;
          continue;
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

    // 新品カテゴリのタイトルを収集（後続の中古dedup用: 中古カテゴリ自体は対象外）
    if (cat !== '中古') {
      for (const p of products) {
        newTitleSet.add(p.title.replace(/\s+/g, ' ').trim().toLowerCase());
      }
    }
  }

  console.log(`[batch] --- 全カテゴリ集計: 取得=${stored} 新規(AI対象)=${toJudge.length} スキップ=${skipped} 除外=${excluded} ---`);
  console.log(`[batch] --- AI判定チェック: OPENAI_API_KEY=${apiKeyStatus} ---`);

  let aiKeyMissing = false;

  if (toJudge.length === 0) {
    console.log(`[batch] AI判定なし: 全商品が判定済みまたは除外KW一致`);
  } else if (!process.env.OPENAI_API_KEY) {
    // APIキー未設定: AI対象あり・判定スキップ → aiKeyMissing フラグで呼び出し元に通知
    aiKeyMissing = true;
    console.log(`[batch] ★AI判定スキップ: OPENAI_API_KEY が未設定 (対象=${toJudge.length}件)★`);
  } else {
    const effectiveLimit = Math.min(MAX_AI_PER_PERSON, aiLimit ?? MAX_AI_PER_PERSON);
    const batch = toJudge.slice(0, effectiveLimit);
    aiQueued = batch.length;
    if (toJudge.length > effectiveLimit) {
      console.log(`[batch] AI判定上限により ${toJudge.length - effectiveLimit}件をスキップ（次回バッチで処理）`);
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
        trackLog(`🤖 ステップ5: AI判定完了 → DB保存`);
        trackLog(`   title="${product.title}"`);
        trackLog(`   id=${id} | verdict=${result.verdict} | score=${result.score}`);
        trackLog(`   reason="${result.reason}"`);
        trackLog(`   公開表示: ${displayable ? '✅ 表示対象（related & score>=70）' : `❌ 非表示（verdict=${result.verdict}, score=${result.score}）`}`);
      }
      await saveVerdict(
        person.name, id, result.verdict, result.score, 'ai', result.reason, PROMPT_VERSION
      );
      aiJudged++;
      if (result.verdict === 'related') relatedCount++;
      else if (result.verdict === 'unrelated') unrelatedCount++;
      else uncertainCount++;
    }

    if (aiJudged < aiQueued) {
      console.log(`[batch] ★警告: AI送信${aiQueued}件のうち${aiQueued - aiJudged}件が保存されませんでした（APIエラー？）`);
    }
  }

  const aiFailed = Math.max(0, aiQueued - aiJudged);
  console.log(`[batch] ===== 完了: ${personName} 取得=${stored} fetchFailed=${fetchFailed} upstreamHttpStatus=${upstreamHttpStatus ?? '-'} rakutenConfigMissing=${rakutenConfigMissing} AI対象=${aiQueued} AI完了=${aiJudged} aiFailed=${aiFailed} aiKeyMissing=${aiKeyMissing} related=${relatedCount} unrelated=${unrelatedCount} uncertain=${uncertainCount} スキップ=${skipped} 除外=${excluded} 中古抑制=${usedSuppressed} 卒業後候補=${membershipFiltered} =====`);
  return {
    personName, stored, aiJudged, aiQueued, autoApproved, skipped, excluded, usedSuppressed, membershipFiltered,
    fetchFailed, failedCategories, aiFailed, aiKeyMissing, relatedCount, unrelatedCount, uncertainCount,
    rakutenConfigMissing, upstreamHttpStatus,
  };
}

// 全人物を処理（Cron/管理画面から呼ぶ）
export async function processAllPersons(): Promise<BatchSummary> {
  const persons = await getAllPersonsMerged();
  const startedAt = Date.now();
  const results: PersonBatchResult[] = [];

  for (const person of persons) {
    try {
      // configOverride で渡すことで processPerson 内の JSON-only 検索を回避し、
      // Redis管理人物（CSVインポート組）も正しく処理できる
      const result = await processPerson(person.name, false, person);
      results.push(result);
    } catch (err) {
      results.push({
        personName: person.name,
        stored: 0, aiJudged: 0, aiQueued: 0, autoApproved: 0, skipped: 0, excluded: 0,
        usedSuppressed: 0, membershipFiltered: 0,
        fetchFailed: 0, failedCategories: [], aiFailed: 0, aiKeyMissing: false,
        relatedCount: 0, unrelatedCount: 0, uncertainCount: 0,
        rakutenConfigMissing: false,
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
