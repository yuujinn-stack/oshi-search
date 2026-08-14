// ChatGPT完全調査 → 14サービス完全同期の中核ロジック（純粋関数・DBアクセスなし）。
// /admin/vod-recheck の新しい「ChatGPT完全同期」CSVインポートモードから使う。
//
// 既存の追加・更新モード（mergeManualCsvVodProviders）とは異なり、こちらは
// 「ChatGPTが14サービスを実際に確認した結果が、その14サービスに関する唯一の真実」
// という前提のため、CSVに含まれないchatgpt調査対象サービスは削除する（完全同期）。
// ただし対象14サービス以外（手動登録の特殊provider等）は絶対に触らない。
//
// workIdは常に呼び出し側（CSV import）が確定済みのものをそのまま使う。
// タイトルからのworkId再推測は行わない（既存の同名作品対策[vod-work-match.ts]と同じ方針）。

import { normalizeProviderName } from '@/lib/vod-dedup';
import { VOD_PROVIDER_DISPLAY_NAMES } from '@/lib/vod-provider-names';
import { RECHECK_STALE_DAYS } from '@/lib/vod-recheck';
import type { VodProvider, VodProviderType } from '@/types/vod';

// ChatGPT完全調査の対象サービス範囲識別子。WorkRecord.chatgptServiceScope に保存する値。
export const CHATGPT_SERVICE_SCOPE = 'major14';

// 対象14サービスの正規化スラグ集合。vod-provider-names.ts（/vod/[provider]の表示名解決と
// 同じSingle Source of Truth・他モジュール非依存）のキー集合をそのまま再利用し、
// 対象サービス一覧を二重管理しない。vod-page.ts は import しない
// （vod-page.tsはモジュール読み込み時にDBクライアント関連のsql.raw()を評価するため、
// work-store.ts経由でこのファイルを読み込む全ての箇所に不要な重い依存が伝播してしまう）。
export const CHATGPT_SCOPE_SLUGS: ReadonlySet<string> = new Set(
  Object.keys(VOD_PROVIDER_DISPLAY_NAMES),
);

export function isChatgptScopeService(providerName: string): boolean {
  return CHATGPT_SCOPE_SLUGS.has(normalizeProviderName(providerName));
}

// ChatGPT完全同期CSVの1サービス分の入力（vodService='unknown'の行はここに含めない。
// 「14サービス全て確認したが対象サービスなし」を意味する行は呼び出し側で別途扱う）。
export interface ChatgptSyncServiceInput {
  providerName: string;
  type: VodProviderType;
  sourceUrl?: string;
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
}

export interface ChatgptSyncDiffUpdated {
  service: string;
  before: VodProviderType;
  after: VodProviderType;
}

export interface ChatgptSyncDiff {
  added: string[];
  removed: string[];
  updated: ChatgptSyncDiffUpdated[];
  unchanged: string[];
}

export interface ChatgptSyncResult {
  merged: VodProvider[];
  diff: ChatgptSyncDiff;
  resultCount: number; // 同期後、対象14サービス内で確認できたサービス数
}

function buildScopedProvider(input: ChatgptSyncServiceInput, now: number): VodProvider {
  return {
    // providerIdは表示に使われないため固定値で問題ない（既存のmanual_csv系と同様、名称ベースで照合する）
    providerId: -1,
    providerName: input.providerName,
    type: input.type,
    countryCode: 'JP',
    source: 'manual_csv',
    sourceLabel: 'ChatGPT完全調査',
    confidence: input.confidence ?? 'high',
    sourceUrl: input.sourceUrl || undefined,
    note: input.note || undefined,
    checkedDate: new Date(now).toISOString().slice(0, 10),
    createdAt: now,
    updatedAt: now,
  };
}

// 完全同期の差分計算＋マージ（純粋関数）。
// existing: 同期前のwork.vodProviders全体（scope外のサービスも含む）
// newServices: ChatGPTが今回「確認できた」として返した対象14サービス分のみ
//              （vodService=unknownの行は含めない＝0件確認の意味）
export function computeChatgptFullSync(
  existing: VodProvider[],
  newServices: ChatgptSyncServiceInput[],
  now: number = Date.now(),
): ChatgptSyncResult {
  // scope外（対象14サービスに該当しない）のエントリは、sourceを問わず一切変更しない
  const outsideScope = existing.filter((p) => !isChatgptScopeService(p.providerName));
  const insideScope = existing.filter((p) => isChatgptScopeService(p.providerName));

  const existingBySlug = new Map<string, VodProvider>();
  for (const p of insideScope) {
    // 同一slugが複数（表記ゆれ違反等）ある場合は最初の1件を代表として比較する
    const slug = normalizeProviderName(p.providerName);
    if (!existingBySlug.has(slug)) existingBySlug.set(slug, p);
  }

  const newBySlug = new Map<string, ChatgptSyncServiceInput>();
  for (const s of newServices) {
    newBySlug.set(normalizeProviderName(s.providerName), s);
  }

  const diff: ChatgptSyncDiff = { added: [], removed: [], updated: [], unchanged: [] };
  const mergedScoped: VodProvider[] = [];

  for (const [slug, input] of newBySlug) {
    const before = existingBySlug.get(slug);
    mergedScoped.push(buildScopedProvider(input, now));
    if (!before) {
      diff.added.push(input.providerName);
    } else if (before.type !== input.type) {
      diff.updated.push({ service: input.providerName, before: before.type, after: input.type });
    } else {
      diff.unchanged.push(input.providerName);
    }
  }

  for (const [slug, before] of existingBySlug) {
    if (!newBySlug.has(slug)) diff.removed.push(before.providerName);
  }

  return {
    merged: [...outsideScope, ...mergedScoped],
    diff,
    resultCount: mergedScoped.length,
  };
}

// ── ChatGPT完全同期結果の保護期間 ────────────────────────────────────────────
//
// 背景: ChatGPT完全同期は「対象14サービスについてはこれが最新の正しい状態」という
// 管理者確認済みの結論である。しかしTMDb自動更新（cron/vod-refresh・vod-fetch）や
// 既存AI補完（cron/vod-recheck・admin再確認）は、ChatGPT同期後も従来どおり自動実行され
// うるため、対策なしでは「ChatGPTが対象外と判断したサービスをTMDb/AIが後から再追加する」
// （例: Hulu単独に完全同期した直後、次回TMDb巡回でDisney+が復活する）という、
// 完全同期の結論と矛盾する状態が発生しうる。
//
// 保護期間は既存のstale設計（vod-recheck.tsのRECHECK_STALE_DAYS=180日、AI再確認Cronが
// 「再確認が必要」と判断するまでの期間）とそのまま整合させる。新しい期間を独自に
// 定義しない。保護期間を過ぎたら通常どおりTMDb/AIによる更新を許可する
// （＝ChatGPT結果を永久に固定するわけではない）。
export const CHATGPT_PROTECTION_DAYS = RECHECK_STALE_DAYS;
const CHATGPT_PROTECTION_MS = CHATGPT_PROTECTION_DAYS * 24 * 60 * 60 * 1000;

export interface ChatgptProtectionInput {
  chatgptResearchMode?: 'full_sync';
  lastChatgptResearchAt?: number;
}

// この作品が現在「ChatGPT完全同期の保護期間内」かどうか。
// 判定基準は常に lastChatgptResearchAt のみ（TMDb/AI/Cronの実行日時に一切影響されない
// ＝「推奨優先順位」で要求されている、ChatGPT調査日を基準とした判定）。
export function isChatgptProtectionActive(work: ChatgptProtectionInput, now: number = Date.now()): boolean {
  if (work.chatgptResearchMode !== 'full_sync') return false;
  if (work.lastChatgptResearchAt === undefined) return false;
  return now - work.lastChatgptResearchAt < CHATGPT_PROTECTION_MS;
}

// 保護期間中に自動処理（TMDb/AI）が新規追加・上書きしようとしているproviders配列から、
// 対象14サービスに該当するものだけを取り除く（14サービス外は素通しする＝影響しない）。
export function stripChatgptScopeServices(providers: VodProvider[]): VodProvider[] {
  return providers.filter((p) => !isChatgptScopeService(p.providerName));
}

// 「ChatGPT完全同期からstaleDays日以上経過し、再調査候補となる」かどうかの判定（純粋関数）。
// 未調査（lastChatgptResearchAt未設定）はここではfalse（＝対象外）とする。
// 「未調査」は既存の別フィルタ・バッジで扱うため、この関数は「調査済みだが古い」ケースのみを扱う。
export function isChatgptResearchStale(
  lastChatgptResearchAt: number | undefined,
  staleDays: number,
  now: number = Date.now(),
): boolean {
  if (lastChatgptResearchAt === undefined) return false;
  return now - lastChatgptResearchAt >= staleDays * 24 * 60 * 60 * 1000;
}
