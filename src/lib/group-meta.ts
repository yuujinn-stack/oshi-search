import { cache } from 'react';
import { db } from '@/db/client';
import { groupMeta as groupMetaTable } from '@/db/schema';
import { eq, getTableColumns } from 'drizzle-orm';
import type { GroupMeta } from '@/types/group';
import type { GroupActivityStatus } from '@/types/group';
import { upsertGroupMeta, deleteGroupMetaInDB, updateGroupHomeCategoryInDB } from '@/db/write';
import { isHomeGroupCategory, type HomeGroupCategory } from '@/lib/home-group-category';

// DB行 → GroupMeta マッピング
function dbRowToGroupMeta(r: typeof groupMetaTable.$inferSelect): GroupMeta {
  return {
    groupName:      r.groupName,
    slug:           r.slug,
    activityStatus: r.activityStatus as GroupActivityStatus,
    formedAt:       r.formedAt ?? undefined,
    endedAt:        r.endedAt ?? undefined,
    renamedFrom:    r.renamedFrom ?? undefined,
    renamedTo:      r.renamedTo ?? undefined,
    formerNames:    r.formerNames?.length ? r.formerNames : undefined,
    officialSite:   r.officialSite ?? undefined,
    note:           r.note ?? undefined,
    gender:         r.gender === 'female' || r.gender === 'male' ? r.gender : undefined,
    homeCategory:   isHomeGroupCategory(r.homeCategory) ? r.homeCategory : undefined,
    createdAt:      r.createdAt.getTime(),
    updatedAt:      r.updatedAt.getTime(),
  };
}

// react の cache() でリクエスト内の重複 DB 呼び出しを防ぐ（generateMetadata + page で
// それぞれ getAllGroupMetas / getAllGroupMetasOrThrow を呼んでも group_meta の取得は1回のみ）。
// cross-request キャッシュではないため、管理画面での更新は次のリクエストから即座に反映される。
const getAllGroupMetasRaw = cache(async (): Promise<GroupMeta[]> => {
  const rows = await selectGroupMetaRows();
  return rows.map(dbRowToGroupMeta).sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
});

// home_category 列が本番DBにまだ無い（/admin/db-init 前にデプロイされた）場合でも、グループ一覧・グループページ・
// トップページを壊さないよう、その列を除いて読み直す（分類は初期値の一覧で判定＝従来どおり）。
type GroupMetaRow = typeof groupMetaTable.$inferSelect;
// drizzle の DrizzleQueryError は message がクエリ文で、Postgres のエラー（code 42703 = undefined_column）は cause に入る
export function isMissingHomeCategoryColumn(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    const { message, code, cause } = e as { message?: unknown; code?: unknown; cause?: unknown };
    const msg = String(message ?? e);
    if (msg.includes('home_category') && (code === '42703' || msg.includes('does not exist'))) return true;
    e = cause;
  }
  return false;
}
async function selectGroupMetaRows(where?: ReturnType<typeof eq>): Promise<GroupMetaRow[]> {
  try {
    const q = db.select().from(groupMetaTable);
    return await (where ? q.where(where) : q);
  } catch (err) {
    if (!isMissingHomeCategoryColumn(err)) throw err;
    console.warn('[db] group_meta.home_category が未作成のため、分類なしで読み込みます（/admin/db-init を実行してください）');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { homeCategory: _omit, ...cols } = getTableColumns(groupMetaTable);
    const q = db.select(cols).from(groupMetaTable);
    const rows = await (where ? q.where(where) : q);
    return rows.map((r) => ({ ...r, homeCategory: null }));
  }
}

export async function getAllGroupMetas(): Promise<GroupMeta[]> {
  try {
    return await getAllGroupMetasRaw();
  } catch (err) {
    console.error('[db] getAllGroupMetas failed:', String(err));
    return [];
  }
}

// DBエラー時に throw する版（グループページのリダイレクト判定で error/empty を区別するために使う）
// getAllGroupMetas が [] を返すと改名グループが 404 になるため OrThrow で区別する
export async function getAllGroupMetasOrThrow(): Promise<GroupMeta[]> {
  return await getAllGroupMetasRaw();
}

// getPublicGroupNote は 'use client' コンポーネント（検索結果カード等）からも
// import されるため、db（サーバー専用）を読み込むこのファイルには置かず、
// 依存のない src/lib/group-note.ts に切り出している。
export { getPublicGroupNote } from '@/lib/group-note';

export async function getGroupMeta(groupName: string): Promise<GroupMeta | null> {
  try {
    const rows = await selectGroupMetaRows(eq(groupMetaTable.groupName, groupName));
    return rows.length > 0 ? dbRowToGroupMeta(rows[0]) : null;
  } catch (err) {
    console.error('[db] getGroupMeta failed:', String(err));
    return null;
  }
}

export async function saveGroupMeta(meta: GroupMeta): Promise<void> {
  meta.updatedAt = Date.now();
  await upsertGroupMeta(meta);
}

/**
 * トップページ「グループで探す」の分類だけを保存する（他の列は変更しない）。
 * 対象グループの group_meta が無ければ false（新規作成はしない）。
 */
export async function saveGroupHomeCategory(groupName: string, category: HomeGroupCategory): Promise<boolean> {
  return await updateGroupHomeCategoryInDB(groupName, category);
}

export async function deleteGroupMeta(groupName: string): Promise<void> {
  await deleteGroupMetaInDB(groupName);
}

export async function ensureGroupMeta(groupName: string): Promise<boolean> {
  if (!groupName.trim()) return false;
  try {
    const existing = await getGroupMeta(groupName.trim());
    if (existing) {
      return false;
    }
    await saveGroupMeta({
      groupName: groupName.trim(),
      slug: encodeURIComponent(groupName.trim()),
      activityStatus: 'active',
      note: '人物登録時に自動作成',
      createdAt: Date.now(),
    });
    return true;
  } catch { return false; }
}
