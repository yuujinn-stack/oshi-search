import { db } from '@/db/client';
import { groupMeta as groupMetaTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { GroupMeta } from '@/types/group';
import type { GroupActivityStatus } from '@/types/group';
import { upsertGroupMeta, deleteGroupMetaInDB } from '@/db/write';

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
    createdAt:      r.createdAt.getTime(),
    updatedAt:      r.updatedAt.getTime(),
  };
}

export async function getAllGroupMetas(): Promise<GroupMeta[]> {
  try {
    const rows = await db.select().from(groupMetaTable);
    return rows.map(dbRowToGroupMeta).sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
  } catch (err) {
    console.error('[db] getAllGroupMetas failed:', String(err));
    return [];
  }
}

// DBエラー時に throw する版（グループページのリダイレクト判定で error/empty を区別するために使う）
// getAllGroupMetas が [] を返すと改名グループが 404 になるため OrThrow で区別する
export async function getAllGroupMetasOrThrow(): Promise<GroupMeta[]> {
  const rows = await db.select().from(groupMetaTable);
  return rows.map(dbRowToGroupMeta).sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
}

export async function getGroupMeta(groupName: string): Promise<GroupMeta | null> {
  try {
    const rows = await db.select().from(groupMetaTable).where(eq(groupMetaTable.groupName, groupName));
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
