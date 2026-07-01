// 出演作品取得・AI判定・AI補完パイプライン
// 管理画面から実行される。一般ユーザーのアクセス時には呼ばない。

import OpenAI from 'openai';
import { logOpenAIUsage } from '@/lib/openai-usage';
import type { PersonWithConfig } from '@/types/person';
import type { WorkRecord, WorkStatus } from '@/types/work';
import { findBestTmdbPerson, getTmdbCredits, getWatchProviders } from './tmdb';
import type { TmdbWorkCandidate, TmdbPersonMatch } from './tmdb';
import { getAllWorks, saveWork, deleteWorksBySource, updateWorkVod } from './work-store';
import { supplementVodWithAI } from './vod-supplement';
import type { VodProvider } from '@/types/vod';

export interface WorkProcessResult {
  newCount: number;
  skippedCount: number;
  rejudgedCount: number;
  aiJudgedCount: number;
  ruleBasedCount: number;
  autoPublishedCount: number;
  needsReviewCount: number;
  hiddenCount: number;
  supplementCount: number;       // AI補完で新規追加した件数
  vodUpdatedCount?: number;      // 配信情報更新件数（includeVod=true 時）
  vodAiCalledCount?: number;     // VOD AI Web検索補完の実行件数
  matchedTmdbPerson?: TmdbPersonMatch;
  error?: string;
}

export interface WorkProcessOptions {
  action?: 'tmdb' | 'supplement' | 'all'; // デフォルト: 'tmdb'
  forceRejudge?: boolean;                  // 手動確認済み以外を再判定
  deleteSupplementFirst?: boolean;         // AI補完作品を削除してから再補完
  includeVod?: boolean;                    // 配信情報取得まで含める（新規セットアップ向け）
  skipWorkAi?: boolean;                    // TMDb作品のAI判定をスキップしルールベース判定のみ使用（初回取得向け）
}

// AI判定の詳細結果（内部型）
interface JudgeResult {
  decision: WorkStatus;  // AIが直接返した最終判定
  samePerson: boolean;
  reason: string;
  confidenceScore: number; // 参考値のみ
  usedAi: boolean;
}

// AI補完の作品候補
export interface AiWorkSuggestion {
  title: string;
  type: 'movie' | 'tv';
  releaseYear?: number;
  reason: string;
}

// 重複判定用タイトル正規化
export function normalizeWorkTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s　！？!?。、.,，]/g, '')
    .trim();
}

// 安定した Work ID 生成
function generateWorkId(
  tmdbId: number | undefined,
  normalizedTitle: string,
  type: string,
): string {
  if (tmdbId) return `tmdb-${type}-${tmdbId}`;
  return `ai-${type}-${normalizedTitle.slice(0, 24)}`;
}

// OpenAI クライアント（lazy init）
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

// 安全サイドへの強制ルール（AI判定後に適用）
// genre が 坂道・芸人・俳優 等で、声優作品・アニメ関連の場合に auto_published を防ぐ
function applySafetyOverride(
  candidate: TmdbWorkCandidate,
  person: PersonWithConfig,
  tmdbMatch: TmdbPersonMatch | undefined,
  judgment: JudgeResult,
): JudgeResult {
  const genre = person.genre ?? '';
  const isNonVoice = ['坂道', '芸人', 'テレビ', '俳優'].includes(genre);
  if (!isNonVoice) return judgment;

  const roleNameLower = (candidate.roleName ?? '').toLowerCase();

  // 役名に voice / (声) が含まれる → hidden 確定
  if (
    roleNameLower.includes('voice') ||
    roleNameLower.includes('(声)') ||
    roleNameLower.includes('声優')
  ) {
    console.log(`[safety] "${candidate.title}" 役名にvoice含む → hidden（上書き）`);
    return {
      ...judgment,
      decision: 'hidden',
      reason: '役名にvoice含む（声優作品）',
    };
  }

  // TMDb人物部門が Animation → auto_published は needs_review に格下げ
  if (tmdbMatch?.department === 'Animation' && judgment.decision === 'auto_published') {
    console.log(`[safety] "${candidate.title}" TMDb人物がAnimation部門 → needs_review（格下げ）`);
    return {
      ...judgment,
      decision: 'needs_review',
      reason: 'TMDb人物がAnimation部門のためauto_published拒否',
    };
  }

  // AI が samePerson=false と判定 → auto_published は needs_review に格下げ
  if (!judgment.samePerson && judgment.decision === 'auto_published') {
    console.log(`[safety] "${candidate.title}" AI:samePerson=false → needs_review（格下げ）`);
    return {
      ...judgment,
      decision: 'needs_review',
      reason: '同一人物の確認が取れないためauto_published拒否',
    };
  }

  return judgment;
}

// OpenAI未設定時のフォールバック判定（TMDb由来のみ）
function ruleBasedDecision(candidate: TmdbWorkCandidate): JudgeResult {
  // TMDb combined_credits は出演確認済みのため needs_review を基本とする
  // 役名あり・高vote数は needs_review、それ以外も needs_review（管理者確認推奨）
  return {
    decision: 'needs_review',
    samePerson: true,
    reason: 'ルールベース（OPENAI_API_KEY未設定）',
    confidenceScore: candidate.roleName ? 75 : 65,
    usedAi: false,
  };
}

// TMDb由来作品の AI 判定
// OpenAI に decision を直接返させ、スコア閾値による変換は行わない
export async function judgeWork(
  candidate: TmdbWorkCandidate,
  person: PersonWithConfig,
  tmdbMatch?: TmdbPersonMatch,
): Promise<JudgeResult> {
  const openai = getOpenAI();
  if (!openai) return ruleBasedDecision(candidate);

  const typeLabel = candidate.type === 'movie' ? '映画' : 'ドラマ・TV番組';

  const personLines = [
    `名前: ${person.name}`,
    person.config.aliases?.length
      ? `別名・愛称: ${person.config.aliases.join('、')}`
      : '',
    person.config.realName ? `本名: ${person.config.realName}` : '',
    person.group ? `グループ: ${person.group}` : '',
    person.genre ? `ジャンル: ${person.genre}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const tmdbPersonLines = tmdbMatch
    ? [
        `TMDb人物名: ${tmdbMatch.name}`,
        tmdbMatch.department ? `TMDb部門: ${tmdbMatch.department}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const workLines = [
    `タイトル: ${candidate.title}`,
    candidate.originalTitle ? `原題: ${candidate.originalTitle}` : '',
    `種別: ${typeLabel}`,
    candidate.releaseYear ? `公開年: ${candidate.releaseYear}` : '',
    `役名: ${candidate.roleName ?? '（未記載）'}`,
    candidate.overview ? `概要: ${candidate.overview.slice(0, 150)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `あなたは日本の芸能人・アーティストの出演作品管理AIです。
以下のTMDbクレジットデータが対象人物の出演作品かどうかを判定してください。

【対象人物】
${personLines}

${tmdbPersonLines ? `【TMDb人物マッチング情報】\n${tmdbPersonLines}\n\n` : ''}【作品情報（TMDbクレジット）】
${workLines}

【判定基準】
auto_published: 本人出演が明確。役名あり、または主要グループ名義の代表作
needs_review: 出演の可能性はあるが確認推奨。役名不明・マイナー作品・短い名前で同名別人の懸念あり
hidden: 同名別人である可能性が高い、または無関係・エキストラ以下

【注意】
- 日本人タレントで1〜2文字の名前は同名別人リスクに注意
- グループ名義で本人も参加している場合は auto_published 可
- 役名が空欄でもTMDbクレジット自体は出演の証拠になる

以下のJSONのみ返してください:
{
  "decision": "auto_published | needs_review | hidden",
  "samePerson": true,
  "reason": "30文字以内の判定理由",
  "confidenceScore": 85
}`;

  const startTime = Date.now();
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 100,
      temperature: 0,
    });

    await logOpenAIUsage({
      feature: 'work_ai',
      model: 'gpt-4o-mini',
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - startTime,
      personName: person.name,
      success: true,
    });

    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as {
      decision?: string;
      samePerson?: boolean;
      reason?: string;
      confidenceScore?: number;
    };

    const validStatuses: WorkStatus[] = ['auto_published', 'needs_review', 'hidden'];
    const decision: WorkStatus = validStatuses.includes(parsed.decision as WorkStatus)
      ? (parsed.decision as WorkStatus)
      : 'needs_review';

    const confidenceScore =
      typeof parsed.confidenceScore === 'number'
        ? Math.max(0, Math.min(100, parsed.confidenceScore))
        : 50;

    console.log(
      `[work-judge] "${candidate.title}" → decision:${decision} same:${parsed.samePerson ?? '?'} score:${confidenceScore} reason:"${parsed.reason ?? ''}"`,
    );

    return {
      decision,
      samePerson: parsed.samePerson !== false,
      reason: parsed.reason ?? '',
      confidenceScore,
      usedAi: true,
    };
  } catch (err) {
    await logOpenAIUsage({
      feature: 'work_ai',
      model: 'gpt-4o-mini',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startTime,
      personName: person.name,
      success: false,
      errorMessage: String(err),
    });
    console.error(`[work-judge] OpenAIエラー: "${candidate.title}"`, err);
    return ruleBasedDecision(candidate);
  }
}

// OpenAI による作品補完（TMDbにない日本のバラエティ・番組等）
// 管理者操作時のみ呼ぶ。結果は全件 needs_review で保存。
async function supplementWithOpenAI(
  person: PersonWithConfig,
  existingNormalizedTitles: Set<string>,
): Promise<AiWorkSuggestion[]> {
  const openai = getOpenAI();
  if (!openai) {
    console.log('[work-supplement] OPENAI_API_KEY未設定 → 補完スキップ');
    return [];
  }

  const personLines = [
    `名前: ${person.name}`,
    person.config.aliases?.length
      ? `別名・愛称: ${person.config.aliases.join('、')}`
      : '',
    person.group ? `グループ: ${person.group}` : '',
    person.genre ? `ジャンル: ${person.genre}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `あなたは日本の芸能人・アーティストの出演作品管理AIです。
以下の人物についてTMDbに登録されていない可能性が高い日本のバラエティ番組・
アイドル番組・ドラマ・映画などの出演作品を補完してください。

【対象人物】
${personLines}

【補完対象】
- 日本のバラエティ番組でのレギュラー・準レギュラー・ゲスト出演（特集回は除く）
- グループの主要TV・映像出演
- ドラマ・映画での出演
- 確実性が高いものを優先

【除外条件】
- 音楽番組での単発歌唱披露（レギュラーでない限り）
- 推測・不確かな情報
- 出演が確認できないもの

最大15件まで。以下のJSONのみ返してください:
{
  "works": [
    {
      "title": "作品タイトル",
      "type": "tv",
      "releaseYear": 2022,
      "reason": "補完理由（20文字以内）"
    }
  ]
}`;

  const startTime = Date.now();
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 600,
      temperature: 0,
    });

    await logOpenAIUsage({
      feature: 'work_supplement',
      model: 'gpt-4o-mini',
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - startTime,
      personName: person.name,
      success: true,
    });

    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { works?: unknown[] };
    const works = Array.isArray(parsed.works) ? parsed.works : [];

    const suggestions: AiWorkSuggestion[] = [];
    for (const w of works) {
      if (typeof w !== 'object' || !w || !('title' in w)) continue;
      const item = w as Record<string, unknown>;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title) continue;
      // 既存タイトルと重複チェック
      if (existingNormalizedTitles.has(normalizeWorkTitle(title))) continue;

      suggestions.push({
        title,
        type: item.type === 'movie' ? 'movie' : 'tv',
        releaseYear:
          typeof item.releaseYear === 'number' ? item.releaseYear : undefined,
        reason: typeof item.reason === 'string' ? item.reason : '',
      });
    }

    console.log(`[work-supplement] "${person.name}": ${suggestions.length}件補完`);
    return suggestions;
  } catch (err) {
    await logOpenAIUsage({
      feature: 'work_supplement',
      model: 'gpt-4o-mini',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startTime,
      personName: person.name,
      success: false,
      errorMessage: String(err),
    });
    console.error(`[work-supplement] OpenAIエラー: "${person.name}"`, err);
    return [];
  }
}

// AI補完候補を取得する（DBへの保存なし・ドライラン用）
// work-ai-supplement API から呼ぶ。既存作品は除外済みで返す。
export async function fetchAiWorkSuggestions(
  person: PersonWithConfig,
): Promise<AiWorkSuggestion[]> {
  const existing = await getAllWorks(person.name);
  const existingNormalized = new Set(existing.map((w) => normalizeWorkTitle(w.title)));
  return supplementWithOpenAI(person, existingNormalized);
}

// 人物の出演作品を処理する（TMDb取得・AI補完・AI判定・Redis保存）
export async function processPersonWorks(
  person: PersonWithConfig,
  options: WorkProcessOptions = {},
): Promise<WorkProcessResult> {
  const { action = 'tmdb', forceRejudge = false, deleteSupplementFirst = false, includeVod = false, skipWorkAi = false } = options;

  const result: WorkProcessResult = {
    newCount: 0,
    skippedCount: 0,
    rejudgedCount: 0,
    aiJudgedCount: 0,
    ruleBasedCount: 0,
    autoPublishedCount: 0,
    needsReviewCount: 0,
    hiddenCount: 0,
    supplementCount: 0,
  };

  const now = Date.now();

  // --- TMDb 取得・AI判定フロー ---
  if (action === 'tmdb' || action === 'all') {
    const tmdbMatch = await findBestTmdbPerson(person);
    if (!tmdbMatch) {
      result.error = `TMDbに「${person.name}」が見つかりませんでした（マッチスコア不足）`;
      console.log(`[work-processor] ${result.error}`);
      // TMDbが見つからなくても supplement は続行
      if (action !== 'all') return result;
    } else {
      result.matchedTmdbPerson = tmdbMatch;
      const candidates = await getTmdbCredits(tmdbMatch.id);

      // 既存 work マップ
      const existing = await getAllWorks(person.name);
      const existingById = new Map(existing.map((w) => [w.id, w]));
      const existingByTmdbId = new Map(
        existing.filter((w) => w.tmdbId !== undefined).map((w) => [w.tmdbId!, w]),
      );

      for (const candidate of candidates) {
        const normalizedTitle = normalizeWorkTitle(candidate.title);
        const id = generateWorkId(candidate.tmdbId, normalizedTitle, candidate.type);

        const existingWork =
          existingById.get(id) ??
          (candidate.tmdbId ? existingByTmdbId.get(candidate.tmdbId) : undefined);

        if (existingWork) {
          if (!forceRejudge) {
            result.skippedCount++;
            continue;
          }
          if (existingWork.checkedAt) {
            result.skippedCount++;
            continue;
          }
          result.rejudgedCount++;
        }

        // AI判定 → 安全ルール適用（voice役・Animation人物対策）
        // skipWorkAi=true（初回取得時）はOpenAIを呼ばずルールベース判定のみ使用
        const rawJudgment = skipWorkAi
          ? ruleBasedDecision(candidate)
          : await judgeWork(candidate, person, tmdbMatch);
        const judgment = applySafetyOverride(candidate, person, tmdbMatch, rawJudgment);
        if (judgment.usedAi) result.aiJudgedCount++;
        else result.ruleBasedCount++;

        const work: WorkRecord = {
          id,
          personName: person.name,
          title: candidate.title,
          originalTitle: candidate.originalTitle,
          normalizedTitle,
          type: candidate.type,
          tmdbId: candidate.tmdbId,
          source: 'tmdb',
          releaseYear: candidate.releaseYear,
          roleName: candidate.roleName,
          overview: candidate.overview,
          posterUrl: candidate.posterUrl,
          confidenceScore: judgment.confidenceScore,
          status: judgment.decision,       // ← AIの decision をそのまま採用
          aiDecision: judgment.decision,
          aiSamePerson: judgment.samePerson,
          aiReason: judgment.reason,
          usedAi: judgment.usedAi,
          tmdbMatchedPersonId: tmdbMatch.id,
          tmdbMatchedPersonName: tmdbMatch.name,
          createdAt: existingWork?.createdAt ?? now,
          updatedAt: now,
        };

        await saveWork(work);

        if (!existingWork) result.newCount++;

        if (judgment.decision === 'auto_published') result.autoPublishedCount++;
        else if (judgment.decision === 'needs_review') result.needsReviewCount++;
        else result.hiddenCount++;
      }
    }
  }

  // --- AI補完フロー ---
  if (action === 'supplement' || action === 'all') {
    // 既存 AI補完作品を削除してから再補完する場合
    if (deleteSupplementFirst) {
      await deleteWorksBySource(person.name, 'openai_suggestion');
      console.log(`[work-supplement] "${person.name}": 既存AI補完作品を削除`);
    }

    // 重複除外のために現在の全タイトルを取得
    const allExisting = await getAllWorks(person.name);
    const existingNormalized = new Set(allExisting.map((w) => normalizeWorkTitle(w.title)));

    const suggestions = await supplementWithOpenAI(person, existingNormalized);

    for (const s of suggestions) {
      const normalizedTitle = normalizeWorkTitle(s.title);
      const id = generateWorkId(undefined, normalizedTitle, s.type);

      // 保存直前に再度重複チェック（補完候補同士の重複対策）
      if (existingNormalized.has(normalizedTitle)) continue;
      existingNormalized.add(normalizedTitle);

      const work: WorkRecord = {
        id,
        personName: person.name,
        title: s.title,
        normalizedTitle,
        type: s.type,
        source: 'openai_suggestion',
        releaseYear: s.releaseYear,
        confidenceScore: 50,         // 補完作品は参考値50固定
        status: 'needs_review',      // AI補完は常に needs_review
        aiReason: s.reason,
        usedAi: true,
        createdAt: now,
        updatedAt: now,
      };

      await saveWork(work);
      result.supplementCount++;
      result.needsReviewCount++;
    }
  }

  // --- 配信情報取得フロー（includeVod=true の場合のみ） ---
  // 新規セットアップ時に自動実行。一般ユーザーアクセス時は絶対に呼ばない。
  if (includeVod) {
    const vodTargets = (await getAllWorks(person.name)).filter(
      (w) => w.status === 'auto_published' && w.tmdbId,
    );

    // 1回のセットアップで最大10件（コスト制御）
    const VOD_AI_LIMIT = 10;
    // 新規作品は vodAiCheckedAt=undefined → stale=true → 自動でAI実行
    const VOD_AI_STALE_MS = 7 * 24 * 60 * 60 * 1000;

    let vodUpdated = 0;
    let vodAiCalled = 0;

    console.log(
      `[work-processor] VOD取得開始: "${person.name}" 対象${vodTargets.length}件`,
    );

    for (const work of vodTargets) {
      try {
        const { providers: tmdbProviders } = await getWatchProviders(work.tmdbId!, work.type as 'movie' | 'tv');
        let finalProviders: VodProvider[] = tmdbProviders;
        let vodAiCheckedAt: number | undefined;

        // TMDb=0件 かつ AI上限未達 かつ stale かつ nextVodCheckAt 未到来でない → AI補完
        const nextCheckScheduled = work.nextVodCheckAt && Date.now() < work.nextVodCheckAt;
        if (tmdbProviders.length === 0 && vodAiCalled < VOD_AI_LIMIT && !nextCheckScheduled) {
          const lastAiCheck = work.vodAiCheckedAt ?? 0;
          const isStale = Date.now() - lastAiCheck >= VOD_AI_STALE_MS;
          if (isStale) {
            console.log(`[work-processor] VOD AI補完: "${work.title}"`);
            const aiProviders = await supplementVodWithAI(work);
            vodAiCalled++;
            vodAiCheckedAt = Date.now();
            if (aiProviders.length > 0) {
              finalProviders = aiProviders;
              console.log(
                `[work-processor] VOD AI補完結果: "${work.title}" → ${aiProviders.length}件 (${aiProviders.map((p) => p.providerName).join(', ')})`,
              );
            } else {
              // 配信確認できずマーカーを保存
              finalProviders = [{
                providerId: -9999,
                providerName: '配信確認できず',
                type: 'unknown',
                countryCode: 'JP',
                source: 'openai_web_search',
                sourceLabel: 'AI Web検索補完',
                confidence: 'low',
                note: '公式配信ページを確認できず。配信なしとは断定しない。',
                checkedDate: new Date().toISOString().slice(0, 10),
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }];
            }
          }
        }

        const hasRealProviders = finalProviders.some((p) => p.providerName !== '配信確認できず');
        const vodStatus = vodAiCheckedAt
          ? (hasRealProviders ? 'found' as const : 'not_found' as const)
          : undefined;
        const nextVodCheckAt = vodStatus === 'not_found'
          ? Date.now() + 30 * 24 * 60 * 60 * 1000
          : undefined;

        await updateWorkVod(person.name, work.id, finalProviders, {
          vodAiCheckedAt,
          vodStatus,
          nextVodCheckAt,
        });
        vodUpdated++;
      } catch (err) {
        console.error(`[work-processor] VOD取得エラー: "${work.title}"`, err);
      }
    }

    result.vodUpdatedCount = vodUpdated;
    result.vodAiCalledCount = vodAiCalled;
    console.log(
      `[work-processor] VOD取得完了: "${person.name}" 更新${vodUpdated}件 AI補完${vodAiCalled}件`,
    );
  }

  console.log(
    `[work-processor] ${person.name}: ` +
      `TMDb新規${result.newCount} 再判定${result.rejudgedCount} スキップ${result.skippedCount} ` +
      `AI補完${result.supplementCount} ` +
      `AI判定${result.aiJudgedCount} ルール${result.ruleBasedCount} ` +
      `公開${result.autoPublishedCount} 確認待ち${result.needsReviewCount} 非表示${result.hiddenCount}` +
      (result.vodUpdatedCount !== undefined ? ` VOD更新${result.vodUpdatedCount}件 VOD-AI${result.vodAiCalledCount}件` : ''),
  );
  return result;
}
