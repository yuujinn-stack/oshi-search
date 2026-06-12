// 出演作品取得・AI判定パイプライン
// 管理画面から実行される。一般ユーザーのアクセス時には呼ばない。

import OpenAI from 'openai';
import type { PersonWithConfig } from '@/types/person';
import type { WorkRecord, WorkStatus } from '@/types/work';
import type { TmdbWorkCandidate } from './tmdb';
import { searchTmdbPerson, getTmdbCredits } from './tmdb';
import { getAllWorks, saveWork } from './work-store';

// --- スコア閾値（後から変更しやすい定数） ---
export const WORK_SCORE_AUTO_PUBLISH = 90;
export const WORK_SCORE_NEEDS_REVIEW = 70;

export interface WorkProcessResult {
  newCount: number;
  skippedCount: number;
  rejudgedCount: number;
  aiJudgedCount: number;
  ruleBasedCount: number;
  autoPublishedCount: number;
  needsReviewCount: number;
  hiddenCount: number;
  error?: string;
}

// AI判定の詳細結果
interface JudgeResult {
  score: number;
  reason: string;
  usedAi: boolean;
  relation?: 'strong' | 'medium' | 'weak' | 'none';
  statusRecommendation?: WorkStatus;
  needsHumanReview?: boolean;
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

// スコアから status を決定（AIの statusRecommendation より score の閾値を優先）
function scoreToStatus(score: number): WorkStatus {
  if (score >= WORK_SCORE_AUTO_PUBLISH) return 'auto_published';
  if (score >= WORK_SCORE_NEEDS_REVIEW) return 'needs_review';
  return 'hidden';
}

// OpenAI APIが未設定の場合に使うルールベーススコア
// ※ TMDb combined_credits は全件出演クレジット済みのため、基準を高めに設定
function computeRuleBasedScore(candidate: TmdbWorkCandidate): number {
  let score = 60; // TMDbクレジット = 出演確認済みなので基準点を高めに
  if (candidate.roleName) score += 20; // 役名あり = 主要キャスト
  if ((candidate.voteCount ?? 0) > 5000) score += 20;
  else if ((candidate.voteCount ?? 0) > 1000) score += 10;
  else if ((candidate.voteCount ?? 0) > 100) score += 3;
  return Math.min(score, 100);
}

// OpenAI クライアント（lazy init）
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

// 作品の関連度を AI 判定（OpenAI未設定時はルールベースにフォールバック）
export async function judgeWork(
  candidate: TmdbWorkCandidate,
  person: PersonWithConfig,
): Promise<JudgeResult> {
  const openai = getOpenAI();
  if (!openai) {
    const score = computeRuleBasedScore(candidate);
    return {
      score,
      reason: 'ルールベース判定（OPENAI_API_KEY未設定）',
      usedAi: false,
    };
  }

  const typeLabel = candidate.type === 'movie' ? '映画' : 'ドラマ・TV番組';

  const aliasText =
    person.config.aliases?.length
      ? `別名・愛称: ${person.config.aliases.join('、')}`
      : '';
  const personText = [
    `芸名: ${person.name}`,
    aliasText,
    person.config.realName ? `本名: ${person.config.realName}` : '',
    person.group ? `グループ: ${person.group}` : '',
    person.genre ? `ジャンル: ${person.genre}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const workText = [
    `タイトル: ${candidate.title}`,
    `種別: ${typeLabel}`,
    candidate.releaseYear ? `公開年: ${candidate.releaseYear}` : '',
    `TMDb役名: ${candidate.roleName ?? '（未記載）'}`,
    candidate.overview ? `概要: ${candidate.overview.slice(0, 200)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `あなたは日本の芸能人・アーティストの出演作品を判定するAIです。

【対象人物】
${personText}

【作品情報（TMDbクレジットデータ）】
${workText}

【判定手順】
1. この TMDb クレジットが本当に対象人物（同名別人でない）のものか確認する
2. 役名から本人の役割の重要度を判断する（主役・主要キャスト・脇役・エキストラ等）
3. 対象人物のファンにとって価値のある作品かを評価する
4. グループ名義の場合：グループ名が一致すれば有効（メンバーとして参加）

【confidenceScore 基準】
90〜100: 本人主演・重要な役での出演が明確（例: 主演映画・主演ドラマ）
80〜89:  本人出演は明確だが役割が脇役、またはグループ名義の主要作品
70〜79:  出演は確認できるが不確実・確認推奨（役名不明、マイナー作品等）
50〜69:  関連がありそうだが人物や役の確認が必要（同名別人の可能性あり等）
30〜49:  関連が薄い、または関係ない可能性が高い
0〜29:   無関係、または明確に別人

【注意】
- TMDb役名が空欄でも出演確認済みの可能性あり（エキストラは除く）
- 日本人に多い短い名前（1〜2文字）は同名別人に注意
- グループ作品はメンバー全員関連とみなして80以上を基本とする

以下のJSONのみ返してください（他のテキスト不要）:
{
  "relation": "strong | medium | weak | none",
  "confidenceScore": 0,
  "statusRecommendation": "auto_published | needs_review | hidden",
  "reason": "50文字以内の判定理由",
  "needsHumanReview": true
}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 120,
      temperature: 0,
    });

    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as {
      relation?: string;
      confidenceScore?: number;
      statusRecommendation?: string;
      reason?: string;
      needsHumanReview?: boolean;
    };

    const score =
      typeof parsed.confidenceScore === 'number'
        ? Math.max(0, Math.min(100, parsed.confidenceScore))
        : 50;

    const validStatuses: WorkStatus[] = ['auto_published', 'needs_review', 'hidden'];
    const aiStatusRec =
      validStatuses.includes(parsed.statusRecommendation as WorkStatus)
        ? (parsed.statusRecommendation as WorkStatus)
        : undefined;

    const validRelations = ['strong', 'medium', 'weak', 'none'] as const;
    const relation = validRelations.includes(parsed.relation as (typeof validRelations)[number])
      ? (parsed.relation as (typeof validRelations)[number])
      : undefined;

    console.log(
      `[work-judge] AI判定: "${candidate.title}" → score:${score} relation:${relation ?? '?'} status:${aiStatusRec ?? '?'} reason:"${parsed.reason ?? ''}"`,
    );

    return {
      score,
      reason: parsed.reason ?? '',
      usedAi: true,
      relation,
      statusRecommendation: aiStatusRec,
      needsHumanReview: parsed.needsHumanReview,
    };
  } catch (err) {
    console.error(`[work-judge] OpenAIエラー: "${candidate.title}"`, err);
    const score = computeRuleBasedScore(candidate);
    return {
      score,
      reason: 'AI判定エラー（ルールベースにフォールバック）',
      usedAi: false,
    };
  }
}

// 人物の出演作品を TMDb から取得・AI判定・Redis 保存
// forceRejudge=true: 手動確認済み（checkedAt あり）以外を再判定
export async function processPersonWorks(
  person: PersonWithConfig,
  forceRejudge = false,
): Promise<WorkProcessResult> {
  const result: WorkProcessResult = {
    newCount: 0,
    skippedCount: 0,
    rejudgedCount: 0,
    aiJudgedCount: 0,
    ruleBasedCount: 0,
    autoPublishedCount: 0,
    needsReviewCount: 0,
    hiddenCount: 0,
  };

  // TMDb 人物ID を取得（本名 → aliases の順に試みる）
  let personId: number | null = null;
  const searchCandidates = [person.name, ...(person.config.aliases ?? [])];
  for (const nameCandidate of searchCandidates) {
    personId = await searchTmdbPerson(nameCandidate);
    if (personId) break;
  }

  if (!personId) {
    result.error = `TMDbに「${person.name}」が見つかりませんでした`;
    console.log(`[work-processor] ${result.error}`);
    return result;
  }

  const candidates = await getTmdbCredits(personId);
  if (!candidates.length) {
    result.error = 'TMDbでクレジットが見つかりませんでした';
    return result;
  }

  // 既存 work をマップで保持（重複スキップ・再判定に使用）
  const existing = await getAllWorks(person.name);
  const existingById = new Map(existing.map((w) => [w.id, w]));
  const existingByTmdbId = new Map(
    existing.filter((w) => w.tmdbId !== undefined).map((w) => [w.tmdbId!, w]),
  );

  const now = Date.now();

  for (const candidate of candidates) {
    const normalizedTitle = normalizeWorkTitle(candidate.title);
    const id = generateWorkId(candidate.tmdbId, normalizedTitle, candidate.type);

    // 既存チェック
    const existingWork =
      existingById.get(id) ?? (candidate.tmdbId ? existingByTmdbId.get(candidate.tmdbId) : undefined);

    if (existingWork) {
      if (!forceRejudge) {
        // 通常モード: 既存はすべてスキップ
        result.skippedCount++;
        continue;
      }
      // forceRejudge: 手動確認済み（checkedAt あり）はスキップ
      if (existingWork.checkedAt) {
        result.skippedCount++;
        continue;
      }
      // AI自動判定のみのものは再判定
      result.rejudgedCount++;
    }

    // AI判定（またはルールベース）
    const judgment = await judgeWork(candidate, person);
    if (judgment.usedAi) result.aiJudgedCount++;
    else result.ruleBasedCount++;

    const status = scoreToStatus(judgment.score);
    const work: WorkRecord = {
      id,
      personName: person.name,
      title: candidate.title,
      normalizedTitle,
      type: candidate.type,
      tmdbId: candidate.tmdbId,
      source: 'tmdb',
      releaseYear: candidate.releaseYear,
      roleName: candidate.roleName,
      overview: candidate.overview,
      posterUrl: candidate.posterUrl,
      confidenceScore: judgment.score,
      status,
      aiReason: judgment.reason,
      aiRelation: judgment.relation,
      aiStatusRecommendation: judgment.statusRecommendation,
      aiNeedsHumanReview: judgment.needsHumanReview,
      usedAi: judgment.usedAi,
      createdAt: existingWork?.createdAt ?? now,
      updatedAt: now,
    };

    await saveWork(work);

    if (existingWork) {
      // 再判定はカウントを newCount に含めない
    } else {
      result.newCount++;
    }

    if (status === 'auto_published') result.autoPublishedCount++;
    else if (status === 'needs_review') result.needsReviewCount++;
    else result.hiddenCount++;
  }

  console.log(
    `[work-processor] ${person.name}: ` +
      `新規${result.newCount} 再判定${result.rejudgedCount} スキップ${result.skippedCount} ` +
      `AI${result.aiJudgedCount} ルール${result.ruleBasedCount} ` +
      `公開${result.autoPublishedCount} 確認待ち${result.needsReviewCount} 非表示${result.hiddenCount}`,
  );
  return result;
}
