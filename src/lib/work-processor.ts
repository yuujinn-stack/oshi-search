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
  aiJudgedCount: number;
  autoPublishedCount: number;
  needsReviewCount: number;
  hiddenCount: number;
  error?: string;
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

// スコアから status を決定
function scoreToStatus(score: number): WorkStatus {
  if (score >= WORK_SCORE_AUTO_PUBLISH) return 'auto_published';
  if (score >= WORK_SCORE_NEEDS_REVIEW) return 'needs_review';
  return 'hidden';
}

// OpenAI APIが未設定の場合に使うルールベーススコア
function computeRuleBasedScore(candidate: TmdbWorkCandidate): number {
  let score = 50;
  if (candidate.roleName) score += 15; // 役名あり = 主要キャスト確認済み
  if ((candidate.voteCount ?? 0) > 5000) score += 25;
  else if ((candidate.voteCount ?? 0) > 1000) score += 15;
  else if ((candidate.voteCount ?? 0) > 200) score += 5;
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
): Promise<{ score: number; reason: string }> {
  const openai = getOpenAI();
  if (!openai) {
    const score = computeRuleBasedScore(candidate);
    return { score, reason: 'ルールベース判定（OpenAI未設定）' };
  }

  const typeLabel = candidate.type === 'movie' ? '映画' : 'ドラマ・TV番組';
  const personText = [
    `芸名: ${person.name}`,
    person.group ? `グループ: ${person.group}` : '',
    person.genre ? `ジャンル: ${person.genre}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const workText = [
    `タイトル: ${candidate.title}`,
    `種別: ${typeLabel}`,
    candidate.releaseYear ? `公開年: ${candidate.releaseYear}` : '',
    `役名: ${candidate.roleName ?? '不明'}`,
    candidate.overview ? `概要: ${candidate.overview.slice(0, 150)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `あなたは芸能人の出演作品判定AIです。
以下の人物がファンに表示する価値のある出演作品かを評価してください。
（TMDbのクレジットデータから取得した作品です。人物の出演は確認済みです。）

対象人物:
${personText}

出演作品（TMDbデータ）:
${workText}

【スコア基準】
90以上: 役名明示の主要出演・人気作品（ファンが見るべき作品）
70〜89: 出演は確認済みだが役割が小さい、またはマイナー作品
70未満: エキストラ・ナレーションのみ、または無関係な可能性がある

以下のJSONのみ返してください（他のテキスト不要）:
{ "score": 0-100, "reason": "50文字以内" }`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 80,
      temperature: 0,
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as {
      score?: number;
      reason?: string;
    };
    const score =
      typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50;
    console.log(
      `[work-judge] "${candidate.title}" → score:${score} reason:"${parsed.reason ?? ''}"`,
    );
    return { score, reason: parsed.reason ?? '' };
  } catch (err) {
    console.error(`[work-judge] エラー: "${candidate.title}"`, err);
    const score = computeRuleBasedScore(candidate);
    return { score, reason: 'AI判定エラー（ルールベースにフォールバック）' };
  }
}

// 人物の出演作品を TMDb から取得・AI判定・Redis 保存
export async function processPersonWorks(person: PersonWithConfig): Promise<WorkProcessResult> {
  const result: WorkProcessResult = {
    newCount: 0,
    skippedCount: 0,
    aiJudgedCount: 0,
    autoPublishedCount: 0,
    needsReviewCount: 0,
    hiddenCount: 0,
  };

  // TMDb 人物ID を取得（本名 → aliases の順に試みる）
  let personId: number | null = null;
  const searchCandidates = [person.name, ...(person.config.aliases ?? [])];
  for (const candidate of searchCandidates) {
    personId = await searchTmdbPerson(candidate);
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

  // 既存 work の ID・tmdbId セットを構築（重複スキップ用）
  const existing = await getAllWorks(person.name);
  const existingIds = new Set(existing.map((w) => w.id));
  const existingTmdbIds = new Set(
    existing.filter((w) => w.tmdbId !== undefined).map((w) => w.tmdbId!),
  );

  const now = Date.now();

  for (const candidate of candidates) {
    const normalizedTitle = normalizeWorkTitle(candidate.title);
    const id = generateWorkId(candidate.tmdbId, normalizedTitle, candidate.type);

    // 既存作品はスキップ（tmdbId または id が一致）
    if (existingIds.has(id) || existingTmdbIds.has(candidate.tmdbId)) {
      result.skippedCount++;
      continue;
    }

    // AI判定（またはルールベース）
    const judgment = await judgeWork(candidate, person);
    result.aiJudgedCount++;

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
      createdAt: now,
      updatedAt: now,
    };

    await saveWork(work);
    result.newCount++;

    if (status === 'auto_published') result.autoPublishedCount++;
    else if (status === 'needs_review') result.needsReviewCount++;
    else result.hiddenCount++;
  }

  console.log(
    `[work-processor] ${person.name}: 新規${result.newCount}件 スキップ${result.skippedCount}件 AI判定${result.aiJudgedCount}件 ` +
      `公開${result.autoPublishedCount} 確認待ち${result.needsReviewCount} 非表示${result.hiddenCount}`,
  );
  return result;
}
