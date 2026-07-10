import type { GroupMeta } from '@/types/group';

// ASCII スラッグ判定: 英小文字・数字・ハイフンのみ、先頭が英数字
export function isAsciiSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

// GroupMeta から /groups/{slug} URL を生成
export function groupHref(meta: GroupMeta): string {
  return isAsciiSlug(meta.slug)
    ? `/groups/${meta.slug}`
    : `/groups/${encodeURIComponent(meta.groupName)}`;
}

// グループ名から GroupMeta を探して URL を生成（見つからない場合はエンコード名でフォールバック）
export function groupHrefByName(groupName: string, metas: GroupMeta[]): string {
  const meta = metas.find((m) => m.groupName === groupName);
  return meta ? groupHref(meta) : `/groups/${encodeURIComponent(groupName)}`;
}

// URL スラッグから GroupMeta を解決（ASCII slug / エンコード済み名前 / デコード一致 の順で試みる）
export function resolveGroupFromSlug(slug: string, metas: GroupMeta[]): GroupMeta | null {
  const decoded = tryDecode(slug);

  // 1. ASCII slug の完全一致 (例: "nogizaka46")
  const bySlug = metas.find((m) => m.slug === slug);
  if (bySlug) return bySlug;

  // 2. デコードしたスラッグがグループ名と一致 (例: "%E4%B9%83..." → "乃木坂46")
  const byName = metas.find((m) => m.groupName === decoded);
  if (byName) return byName;

  // 3. DB に保存されたスラッグをデコードしたものと一致
  const byDecodedSlug = metas.find((m) => {
    try { return decodeURIComponent(m.slug) === decoded; } catch { return false; }
  });
  if (byDecodedSlug) return byDecodedSlug;

  return null;
}

// GroupMeta の canonical スラッグを返す（ASCII slug があればそれ、なければエンコード済みグループ名）
export function canonicalGroupSlug(meta: GroupMeta): string {
  return isAsciiSlug(meta.slug) ? meta.slug : encodeURIComponent(meta.groupName);
}

function tryDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
