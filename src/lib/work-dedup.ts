/**
 * 作品重複候補の検出・分類・統合計画生成
 *
 * 設計原則:
 * - DB アクセスを含まない純粋関数のみ（テスト可能）
 * - 本番データを変更しない（dry-run 専用）
 * - タイトル一致だけで自動統合しない（必ず人間確認）
 * - canApplyAutomatically は常に false（今回実装では apply 未実施）
 */

import { createHash } from 'crypto';
import { normalizeProviderName } from '@/lib/vod-dedup';

/** 候補グループ検出アルゴリズムのバージョン。変更時はレビュー結果を無効化する。 */
export const ALGORITHM_VERSION = 'v1';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export type WorkDuplicateConfidence = 'exact' | 'high' | 'medium' | 'low' | 'conflict';
export type DedupReviewStatus = 'pending' | 'approved' | 'rejected' | 'deferred';

/** 1 workId に対応する集約エントリ（複数の personName 行を統合済み） */
export interface WorkDedupEntry {
  workId: string;
  title: string;
  /** 比較キー（normalizeWorkTitleForMatching の結果） */
  dedupKey: string;
  type: string;
  tmdbId: number | null;
  source: string;
  releaseYear: number | null;
  overview: string | null;
  posterUrl: string | null;
  status: string;
  hasDeleted: boolean;
  persons: string[];
  personLinkCount: number;
  /** isConfirmedVodAvailability 適用前の全 VOD 件数 */
  vodCount: number;
  updatedAt: number;
  createdAt: number;
}

/** 重複候補グループ（複数の workId が同一作品の可能性） */
export interface WorkDedupGroup {
  groupId: string;
  entries: WorkDedupEntry[];
  confidence: WorkDuplicateConfidence;
  reasons: string[];
  conflicts: string[];
  canonicalRecommendation: CanonicalWorkRecommendation;
  mergePlan: WorkMergePlan;
}

export interface CanonicalWorkRecommendation {
  recommendedWorkId: string | null;
  reasons: string[];
  conflicts: string[];
}

export interface WorkMergePlan {
  canonicalWorkId: string;
  duplicateWorkIds: string[];
  confidence: WorkDuplicateConfidence;
  reasons: string[];
  conflicts: string[];
  personLinksToMove: number;
  personLinksToDeduplicate: number;
  vodRecordsToMove: number;
  vodRecordsToDeduplicate: number;
  productsToMove: number;
  relatedWorksToUpdate: number;
  redirectsToCreate: number;
  rankingEntriesToUpdate: number;
  /** 今回実装では常に false（apply は未実施） */
  canApplyAutomatically: boolean;
}

export interface WorkDedupStats {
  totalWorkRecords: number;
  publishedWorkRecords: number;
  uniqueWorkIds: number;
  uniqueDedupKeys: number;
  duplicateCandidateGroups: number;
  duplicateCandidateWorks: number;
  exactGroups: number;
  highGroups: number;
  mediumGroups: number;
  lowGroups: number;
  conflictGroups: number;
  externalIdMatchGroups: number;
  titleTypeYearMatchGroups: number;
  titleTypeYearMismatchGroups: number;
  typeConflictGroups: number;
  canonicalSelectableGroups: number;
  autoApplyForbiddenGroups: number;
}

// alias検証エラー
export type AliasValidationError =
  | 'SELF_REFERENCE'
  | 'CIRCULAR'
  | 'CANONICAL_NOT_FOUND';

// ─── フェーズ2: タイトル正規化 ───────────────────────────────────────────────

/**
 * 重複候補検出専用の作品名正規化関数。
 * 表示名を書き換えるためではなく、比較キー生成にのみ使用する。
 *
 * 安全に処理する差異:
 * - Unicode 正規化 (NFKC: 全角→半角、合字展開等)
 * - 英字大小文字統一
 * - 全角・半角スペース統一 → シングルスペース
 * - 連続スペース統一
 * - 全角・半角括弧除去（タイトル注記を除去）
 * - 中黒・コロン等 → スペース
 * - 句読点・感嘆符・疑問符除去
 *
 * 削除しない文字:
 * - 数字（2, II, Season 2 等）
 * - 劇場版・特別編・シーズン・前編・後編等の修飾語
 * - 公演年・リメイク年
 */
export function normalizeWorkTitleForMatching(title: string): string {
  return (
    title
      // Unicode 正規化: 全角英数→半角, 結合文字正規化 等
      .normalize('NFKC')
      .toLowerCase()
      // 文頭の明確な媒体注記プレフィックスのみ除去（"TVドラマ XX" → "XX"）
      // 劇場版・特別編等は除去しない
      .replace(/^(tv番組|tvドラマ|テレビ番組|テレビドラマ)\s+/i, '')
      // 全角・半角括弧を除去（注記の除去: "(映画)" "(2023年)" 等）
      .replace(/[（）()\[\]｛｝{}「」『』【】〔〕〈〉《》]/g, '')
      // 中黒・ブレット → スペース
      .replace(/[・･•·]/g, ' ')
      // コロン → スペース (サブタイトル区切りを空白で扱う)
      .replace(/[：:]/g, ' ')
      // 全角・半角スペースを統一
      .replace(/[　\s\t\r\n]+/g, ' ')
      // 句読点・記号除去（ただし - と . は数値に含まれる場合があるので保留）
      .replace(/[。、，,！!？?～〜…‥]/g, '')
      // 連続スペースをシングルに
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ─── フェーズ3: 信頼度判定 ──────────────────────────────────────────────────

interface ConfidenceResult {
  confidence: WorkDuplicateConfidence;
  reasons: string[];
  conflicts: string[];
}

/**
 * 同一 dedupKey グループ内の workId リストから信頼度を判定する。
 * entries は同一 dedupKey を共有する WorkDedupEntry の配列（2件以上）。
 */
export function assessDuplicateGroup(entries: WorkDedupEntry[]): ConfidenceResult {
  if (entries.length < 2) {
    return { confidence: 'low', reasons: [], conflicts: ['エントリ数不足'] };
  }

  const reasons: string[] = [];
  const conflicts: string[] = [];

  // ── 1. TMDb ID チェック ──
  const tmdbIds = entries.map((e) => e.tmdbId).filter((id): id is number => id !== null);
  const uniqueTmdbIds = new Set(tmdbIds);

  if (uniqueTmdbIds.size > 1) {
    // 複数の異なる TMDb ID → 確実に別作品
    conflicts.push(`異なるTMDb IDが混在: ${[...uniqueTmdbIds].join(', ')}`);
    return { confidence: 'conflict', reasons, conflicts };
  }

  if (uniqueTmdbIds.size === 1 && tmdbIds.length === entries.length) {
    // 全エントリが同じ TMDb ID を持つ
    const sharedId = [...uniqueTmdbIds][0];
    const types = new Set(entries.map((e) => e.type));
    if (types.size > 1) {
      reasons.push(`複数作品でTMDb ID ${sharedId} が一致`);
      conflicts.push(`作品種別が異なる: ${[...types].join(' vs ')}`);
      return { confidence: 'conflict', reasons, conflicts };
    }
    reasons.push(`複数作品でTMDb ID ${sharedId} が一致`);
    reasons.push(`作品種別一致: ${[...types][0]}`);
    return { confidence: 'exact', reasons, conflicts };
  }

  if (uniqueTmdbIds.size === 1 && tmdbIds.length > 0 && tmdbIds.length < entries.length) {
    // 一部エントリのみ TMDb ID あり（同じ ID 値）
    const sharedId = [...uniqueTmdbIds][0];
    if (tmdbIds.length === 1) {
      reasons.push(`候補内の1作品のみがTMDb ID ${sharedId} を保持`);
    } else {
      reasons.push(`候補内の${tmdbIds.length}作品がTMDb ID ${sharedId} を保持（残り${entries.length - tmdbIds.length}件はIDなし）`);
    }
  }

  // ── 2. workType チェック ──
  const types = new Set(entries.map((e) => e.type));
  if (types.size > 1) {
    conflicts.push(`作品種別が異なる: ${[...types].join(' vs ')}`);
    return { confidence: 'conflict', reasons, conflicts };
  }
  const workType = [...types][0];

  // ── 3. releaseYear チェック ──
  const years = entries
    .map((e) => e.releaseYear)
    .filter((y): y is number => y !== null);
  const uniqueYears = new Set(years);

  if (uniqueYears.size > 1) {
    conflicts.push(`公開年が異なる: ${[...uniqueYears].join(', ')}`);
    return { confidence: 'conflict', reasons, conflicts };
  }

  const hasAllYears = years.length === entries.length;
  const hasNoYears = years.length === 0;
  const sharedYear = uniqueYears.size === 1 ? [...uniqueYears][0] : null;

  // ── 4. タイトル・種別・年すべて一致 → high ──
  if (hasAllYears && sharedYear !== null) {
    reasons.push('正規化タイトル完全一致');
    reasons.push(`作品種別一致: ${workType}`);
    reasons.push(`公開年一致: ${sharedYear}`);
    return { confidence: 'high', reasons, conflicts };
  }

  // ── 5. 年欠落 → medium ──
  if (!hasNoYears && !hasAllYears) {
    reasons.push('正規化タイトル一致');
    reasons.push(`作品種別一致: ${workType}`);
    conflicts.push('公開年が一部欠落');
    return { confidence: 'medium', reasons, conflicts };
  }

  // ── 6. 公開年が全エントリで不明 → medium（情報不足）──
  if (hasNoYears) {
    reasons.push('正規化タイトル一致');
    reasons.push(`作品種別一致: ${workType}`);
    conflicts.push('全エントリの公開年が不明');
    return { confidence: 'medium', reasons, conflicts };
  }

  // ── 7. フォールバック ──
  reasons.push('正規化タイトル一致のみ');
  return { confidence: 'low', reasons, conflicts };
}

// ─── フェーズ5: canonical 候補選定 ─────────────────────────────────────────

/**
 * 重複候補グループからどの workId を canonical（正本）にするか推奨する。
 * 今回は選定のみ。確定・apply は行わない。
 */
export function selectCanonical(entries: WorkDedupEntry[]): CanonicalWorkRecommendation {
  if (entries.length === 0) {
    return { recommendedWorkId: null, reasons: [], conflicts: ['エントリが空'] };
  }
  if (entries.length === 1) {
    return { recommendedWorkId: entries[0].workId, reasons: ['唯一のエントリ'], conflicts: [] };
  }

  const scored = entries.map((e) => {
    let score = 0;
    const scoreReasons: string[] = [];

    // TMDb ID あり → 最高信頼ソース
    if (e.tmdbId !== null) { score += 5; scoreReasons.push('TMDb ID あり'); }
    // TMDb ソース
    if (e.source === 'tmdb') { score += 3; scoreReasons.push('ソース: tmdb'); }
    // 手動 CSV → 役名等が充実している可能性
    if (e.source === 'manual_csv') { score += 2; scoreReasons.push('ソース: manual_csv'); }
    // 公開中
    if (e.status === 'auto_published') { score += 3; scoreReasons.push('公開中'); }
    if (e.status === 'needs_review') { score += 1; scoreReasons.push('レビュー待ち'); }
    // 論理削除なし
    if (!e.hasDeleted) { score += 1; scoreReasons.push('削除なし'); }
    // 説明テキストあり
    if (e.overview && e.overview.length > 50) { score += 2; scoreReasons.push('詳細説明あり'); }
    if (e.overview && e.overview.length > 0) { score += 1; }
    // ポスター画像あり
    if (e.posterUrl) { score += 2; scoreReasons.push('ポスター画像あり'); }
    // 公開年あり
    if (e.releaseYear !== null) { score += 1; scoreReasons.push('公開年あり'); }
    // 出演者数
    if (e.personLinkCount > 0) { score += Math.min(e.personLinkCount, 3); scoreReasons.push(`人物連携 ${e.personLinkCount}件`); }
    // VOD 件数
    if (e.vodCount > 0) { score += Math.min(e.vodCount, 3); scoreReasons.push(`VOD ${e.vodCount}件`); }
    // 更新日時（新しいほど+）
    score += e.updatedAt > Date.now() - 30 * 24 * 3600 * 1000 ? 1 : 0;

    return { entry: e, score, scoreReasons };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const conflicts: string[] = [];

  // 同点チェック
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    conflicts.push('スコアが同点のため人間判断が必要');
  }

  return {
    recommendedWorkId: best.entry.workId,
    reasons: best.scoreReasons,
    conflicts,
  };
}

// ─── フェーズ6: 統合影響範囲集計 ────────────────────────────────────────────

/**
 * 統合計画（マージプラン）を生成する。
 * dry-run 専用。この関数は実データを変更しない。
 */
export function buildMergePlan(
  group: Pick<WorkDedupGroup, 'entries' | 'confidence' | 'reasons' | 'conflicts' | 'canonicalRecommendation'>,
): WorkMergePlan {
  const canonicalId = group.canonicalRecommendation.recommendedWorkId;
  if (!canonicalId) {
    return {
      canonicalWorkId: '',
      duplicateWorkIds: group.entries.map((e) => e.workId),
      confidence: group.confidence,
      reasons: group.reasons,
      conflicts: [...group.conflicts, 'canonical 未選定'],
      personLinksToMove: 0,
      personLinksToDeduplicate: 0,
      vodRecordsToMove: 0,
      vodRecordsToDeduplicate: 0,
      productsToMove: 0,
      relatedWorksToUpdate: 0,
      redirectsToCreate: 0,
      rankingEntriesToUpdate: 0,
      canApplyAutomatically: false,
    };
  }

  const canonical = group.entries.find((e) => e.workId === canonicalId)!;
  const duplicates = group.entries.filter((e) => e.workId !== canonicalId);

  // 移動対象の人物リンク数（重複除去前）
  const allDupPersons = duplicates.flatMap((e) => e.persons);
  const canonicalPersons = new Set(canonical.persons);
  const newPersonLinks = allDupPersons.filter((p) => !canonicalPersons.has(p)).length;
  const dedupPersonLinks = allDupPersons.filter((p) => canonicalPersons.has(p)).length;

  // VOD レコード（重複はサービス名で判定）
  const dupVodTotal = duplicates.reduce((s, e) => s + e.vodCount, 0);
  // 重複は推測値（同一サービスが canonical にもある可能性）
  const vodDedup = Math.min(dupVodTotal, canonical.vodCount);

  return {
    canonicalWorkId: canonicalId,
    duplicateWorkIds: duplicates.map((e) => e.workId),
    confidence: group.confidence,
    reasons: group.reasons,
    conflicts: group.conflicts,
    personLinksToMove: newPersonLinks,
    personLinksToDeduplicate: dedupPersonLinks,
    vodRecordsToMove: Math.max(0, dupVodTotal - vodDedup),
    vodRecordsToDeduplicate: vodDedup,
    // 商品は人物依存のため人物移動件数で近似
    productsToMove: newPersonLinks,
    // related_works テーブルは存在しないため 0（参照は workId 書き換え）
    relatedWorksToUpdate: 0,
    // alias = duplicate workId 数
    redirectsToCreate: duplicates.length,
    // Redis ランキングエントリ = duplicate 数
    rankingEntriesToUpdate: duplicates.length,
    // 今回実装では apply しない
    canApplyAutomatically: false,
  };
}

// ─── フェーズ4: 候補グループ ID ─────────────────────────────────────────────

/**
 * workId リストから安定したグループ ID（candidateGroupKey）を生成する。
 * - SHA-256 の完全な 64 文字 lowercase hex を返す（切り詰めない）
 * - algorithmVersion を含まない（workId 集合が同じなら常に同一キー）
 * - workIds が空または 1 件の場合は空文字を返す（呼び出し元で除外すること）
 */
export function makeGroupId(workIds: string[]): string {
  if (workIds.length < 2) return '';
  const normalized = workIds.map((id) => id.trim()).filter(Boolean);
  if (normalized.length < 2) return '';
  return createHash('sha256')
    .update([...new Set(normalized)].sort().join('|'))
    .digest('hex'); // 64文字 lowercase hex（切り詰めなし）
}

// ─── フェーズ4: 重複候補の一括検出 ─────────────────────────────────────────

/**
 * 全作品エントリから重複候補グループを検出する。
 * 引数は既に workId 単位で集約済みの WorkDedupEntry[]。
 * DB アクセスなし。
 */
export function detectDuplicates(entries: WorkDedupEntry[]): WorkDedupGroup[] {
  // dedupKey でグルーピング（O(n) — 総当たり禁止）
  const keyMap = new Map<string, WorkDedupEntry[]>();
  for (const entry of entries) {
    const existing = keyMap.get(entry.dedupKey) ?? [];
    existing.push(entry);
    keyMap.set(entry.dedupKey, existing);
  }

  const groups: WorkDedupGroup[] = [];

  for (const [, groupEntries] of keyMap) {
    // 同一 dedupKey に複数の異なる workId がある場合のみ候補
    const uniqueWorkIds = new Set(groupEntries.map((e) => e.workId));
    if (uniqueWorkIds.size < 2) continue;

    // workId 単位で代表エントリを1件にまとめる（同一 workId の重複を除去）
    const byWorkId = new Map<string, WorkDedupEntry>();
    for (const e of groupEntries) {
      if (!byWorkId.has(e.workId)) byWorkId.set(e.workId, e);
    }
    const deduped = [...byWorkId.values()];

    const groupId = makeGroupId(deduped.map((e) => e.workId));
    if (!groupId) continue; // 2件未満（通常ありえない）

    const { confidence, reasons, conflicts } = assessDuplicateGroup(deduped);
    const canonicalRecommendation = selectCanonical(deduped);
    const partialGroup = { entries: deduped, confidence, reasons, conflicts, canonicalRecommendation };
    const mergePlan = buildMergePlan(partialGroup);

    groups.push({
      groupId,
      entries: deduped,
      confidence,
      reasons,
      conflicts,
      canonicalRecommendation,
      mergePlan,
    });
  }

  // 信頼度降順（exact → high → medium → low → conflict）でソート
  const ORDER: Record<WorkDuplicateConfidence, number> = {
    exact: 0, high: 1, medium: 2, low: 3, conflict: 4,
  };
  groups.sort((a, b) => ORDER[a.confidence] - ORDER[b.confidence]);

  return groups;
}

// ─── 統計集計 ───────────────────────────────────────────────────────────────

export function computeStats(
  allRows: { status: string; deleted: boolean }[],
  allEntries: WorkDedupEntry[],
  groups: WorkDedupGroup[],
): WorkDedupStats {
  const totalWorkRecords = allRows.length;
  const publishedWorkRecords = allRows.filter(
    (r) => r.status === 'auto_published' && !r.deleted,
  ).length;

  const byConfidence = (c: WorkDuplicateConfidence) => groups.filter((g) => g.confidence === c).length;
  const exactG = groups.filter((g) => g.confidence === 'exact');
  const highG = groups.filter((g) => g.confidence === 'high');

  const externalIdMatchGroups = exactG.length;
  const titleTypeYearMatchGroups = highG.length;
  const titleTypeYearMismatchGroups = groups.filter((g) => {
    return g.conflicts.some((c) => c.includes('公開年'));
  }).length;
  const typeConflictGroups = groups.filter((g) => {
    return g.conflicts.some((c) => c.includes('作品種別'));
  }).length;

  return {
    totalWorkRecords,
    publishedWorkRecords,
    uniqueWorkIds: allEntries.length,
    uniqueDedupKeys: new Set(allEntries.map((e) => e.dedupKey)).size,
    duplicateCandidateGroups: groups.length,
    duplicateCandidateWorks: groups.reduce((s, g) => s + g.entries.length, 0),
    exactGroups: byConfidence('exact'),
    highGroups: byConfidence('high'),
    mediumGroups: byConfidence('medium'),
    lowGroups: byConfidence('low'),
    conflictGroups: byConfidence('conflict'),
    externalIdMatchGroups,
    titleTypeYearMatchGroups,
    titleTypeYearMismatchGroups,
    typeConflictGroups,
    canonicalSelectableGroups: groups.filter(
      (g) => g.canonicalRecommendation.recommendedWorkId !== null,
    ).length,
    autoApplyForbiddenGroups: groups.length, // 今回は全グループ apply 禁止
  };
}

// ─── フェーズ8: alias 検証（循環・自己参照禁止） ────────────────────────────

/**
 * alias 登録の安全性を検証する（DB 変更なし）。
 * @returns エラーコードまたは null（OK）
 */
export function validateAlias(
  aliasWorkId: string,
  canonicalWorkId: string,
  existingAliases: Map<string, string>,
  allWorkIds: Set<string>,
): AliasValidationError | null {
  // 自己参照禁止
  if (aliasWorkId === canonicalWorkId) return 'SELF_REFERENCE';

  // canonical が存在しない
  if (!allWorkIds.has(canonicalWorkId)) return 'CANONICAL_NOT_FOUND';

  // 循環チェック: alias → canonical → (alias の候補)
  // canonicalWorkId が他の alias のターゲットになっているか辿る
  const visited = new Set<string>();
  let current = canonicalWorkId;
  while (existingAliases.has(current)) {
    if (current === aliasWorkId) return 'CIRCULAR';
    if (visited.has(current)) break;
    visited.add(current);
    current = existingAliases.get(current)!;
  }
  if (current === aliasWorkId) return 'CIRCULAR';

  return null;
}

// ─── フェーズ4: DB データ → WorkDedupEntry 変換 ─────────────────────────────

/** DB の raw 行型（dedup 検出に必要な列のみ） */
export interface WorkRawRow {
  id: string;
  personName: string;
  title: string;
  normalizedTitle: string;
  type: string;
  tmdbId: number | null;
  source: string;
  releaseYear: number | null;
  overview: string | null;
  posterUrl: string | null;
  status: string;
  deleted: boolean;
  vodData: Record<string, unknown>;
  updatedAt: Date;
  createdAt: Date;
}

/**
 * DB 行リスト（(personName, workId) の全行）を workId 単位の WorkDedupEntry に変換する。
 * 単一 SQL クエリ結果から変換するため N+1 なし。
 */
export function aggregateEntries(rows: WorkRawRow[]): WorkDedupEntry[] {
  const map = new Map<string, {
    title: string; type: string; tmdbId: number | null; source: string;
    releaseYear: number | null; overview: string | null; posterUrl: string | null;
    statuses: string[]; hasDeleted: boolean; persons: Set<string>; personLinkCount: number;
    vodCounts: number[]; updatedAt: Date; createdAt: Date;
  }>();

  for (const row of rows) {
    const existing = map.get(row.id);
    const vodProviders = (row.vodData?.vodProviders as unknown[] | undefined) ?? [];
    const vodCount = vodProviders.length;

    if (!existing) {
      map.set(row.id, {
        title: row.title,
        type: row.type,
        tmdbId: row.tmdbId,
        source: row.source,
        releaseYear: row.releaseYear,
        overview: row.overview,
        posterUrl: row.posterUrl,
        statuses: [row.status],
        hasDeleted: row.deleted,
        persons: new Set([row.personName]),
        personLinkCount: 1,
        vodCounts: [vodCount],
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
      });
    } else {
      existing.statuses.push(row.status);
      if (row.deleted) existing.hasDeleted = true;
      existing.persons.add(row.personName);
      existing.personLinkCount += 1;
      existing.vodCounts.push(vodCount);
      // 最新 updatedAt を採用
      if (row.updatedAt > existing.updatedAt) existing.updatedAt = row.updatedAt;
      // TMDb ID を補完
      if (existing.tmdbId === null && row.tmdbId !== null) existing.tmdbId = row.tmdbId;
      // overview / posterUrl を補完
      if (!existing.overview && row.overview) existing.overview = row.overview;
      if (!existing.posterUrl && row.posterUrl) existing.posterUrl = row.posterUrl;
    }
  }

  return [...map.entries()].map(([workId, data]) => {
    // 最も公開寄りのステータスを代表値とする
    const statusPriority: Record<string, number> = {
      auto_published: 3, needs_review: 2, hidden: 1,
    };
    const repStatus = data.statuses.reduce((best, s) =>
      (statusPriority[s] ?? 0) > (statusPriority[best] ?? 0) ? s : best,
    );
    const vodCount = Math.max(0, ...data.vodCounts);

    return {
      workId,
      title: data.title,
      dedupKey: normalizeWorkTitleForMatching(data.title),
      type: data.type,
      tmdbId: data.tmdbId,
      source: data.source,
      releaseYear: data.releaseYear,
      overview: data.overview,
      posterUrl: data.posterUrl,
      status: repStatus,
      hasDeleted: data.hasDeleted,
      persons: [...data.persons],
      personLinkCount: data.personLinkCount,
      vodCount,
      updatedAt: data.updatedAt.getTime(),
      createdAt: data.createdAt.getTime(),
    };
  });
}
