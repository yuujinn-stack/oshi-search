import type { GroupMeta } from '@/types/group';

// ── 固定マッピング ──────────────────────────────────────────────────────────────
// GroupMeta.slug が未設定または URL エンコード済み日本語の場合でも、
// 英数字 slug → 正式グループ名 を解決するためのフォールバック。
// 管理画面で slug を正しく設定すれば DB/Redis が優先される。
export const SLUG_TO_GROUP_NAME: Record<string, string> = {
  'nogizaka46':   '乃木坂46',
  'hinatazaka46': '日向坂46',
  'sakurazaka46': '櫻坂46',
  'keyakizaka46': '欅坂46',
  'equal-love':   '＝LOVE',
  'audrey':       'オードリー',
  'bananaman':    'バナナマン',
};

// 正式グループ名 → slug の逆引き
const GROUP_NAME_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_GROUP_NAME).map(([slug, name]) => [name, slug]),
);

// ── ユーティリティ ──────────────────────────────────────────────────────────────

// ASCII スラッグ判定: 英小文字・数字・ハイフンのみ、先頭が英数字
export function isAsciiSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

// GroupMeta の canonical スラッグを返す
// 優先: 1. GroupMeta.slug が ASCII slug → そのまま
//       2. 固定マッピング (GROUP_NAME_TO_SLUG) にグループ名が存在する → そちらを使用
//       3. encodeURIComponent(groupName) にフォールバック
export function canonicalGroupSlug(meta: GroupMeta): string {
  if (isAsciiSlug(meta.slug)) return meta.slug;
  const mapped = GROUP_NAME_TO_SLUG[meta.groupName];
  if (mapped) return mapped;
  return encodeURIComponent(meta.groupName);
}

// GroupMeta から /groups/{slug} URL を生成
export function groupHref(meta: GroupMeta): string {
  return `/groups/${canonicalGroupSlug(meta)}`;
}

// グループ名から /groups/{slug} URL を生成
// GroupMeta が見つかれば canonicalGroupSlug を使用
// なければ固定マッピング → encodeURIComponent フォールバック
export function groupHrefByName(groupName: string, metas: GroupMeta[]): string {
  const meta = metas.find((m) => m.groupName === groupName);
  if (meta) return groupHref(meta);
  const slug = GROUP_NAME_TO_SLUG[groupName];
  if (slug) return `/groups/${slug}`;
  return `/groups/${encodeURIComponent(groupName)}`;
}

// URL スラッグから GroupMeta を解決
// 優先順:
//   1. GroupMeta.slug と完全一致 (管理画面で slug 設定済みの場合)
//   2. デコードしたスラッグがグループ名と一致 (%E4%...  → 乃木坂46)
//   3. DB に保存された URL エンコード済みスラッグをデコードして一致
//   4. 固定マッピング経由 (nogizaka46 → 乃木坂46 → GroupMeta を探す)
export function resolveGroupFromSlug(slug: string, metas: GroupMeta[]): GroupMeta | null {
  const decoded = tryDecode(slug);

  // 1. slug 完全一致
  const bySlug = metas.find((m) => m.slug === slug);
  if (bySlug) return bySlug;

  // 2. デコードしたスラッグがグループ名と一致
  const byName = metas.find((m) => m.groupName === decoded);
  if (byName) return byName;

  // 3. DB の slug をデコードしたものと一致
  const byDecodedSlug = metas.find((m) => {
    try { return decodeURIComponent(m.slug) === decoded; } catch { return false; }
  });
  if (byDecodedSlug) return byDecodedSlug;

  // 4. 固定マッピング: nogizaka46 → "乃木坂46" → GroupMeta を探す
  const mappedName = SLUG_TO_GROUP_NAME[slug];
  if (mappedName) {
    const byMapped = metas.find((m) => m.groupName === mappedName);
    if (byMapped) return byMapped;
  }

  return null;
}

// slug → groupName を解決
// GroupMeta が見つからなくても固定マッピングでフォールバック（GroupMeta 未登録グループにも対応）
export function resolveGroupName(slug: string, metas: GroupMeta[]): string | null {
  const meta = resolveGroupFromSlug(slug, metas);
  if (meta) return meta.groupName;
  return SLUG_TO_GROUP_NAME[slug] ?? null;
}

function tryDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
