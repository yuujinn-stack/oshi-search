// person_group_memberships（人物とグループの所属履歴）の読み書き。解釈は src/lib/group-membership.ts。
import { cache } from 'react';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { personGroupMemberships } from '@/db/schema';
import { revalidatePublicListings } from '@/lib/public-listing-cache';
import { isValidMembershipStatus, type MembershipRecord } from '@/lib/group-membership';

function rowToRecord(r: typeof personGroupMemberships.$inferSelect): MembershipRecord {
  return {
    personName: r.personName,
    groupName: r.groupName,
    activityStatus: isValidMembershipStatus(r.activityStatus) ? r.activityStatus : 'unknown',
    joinedAt: r.joinedAt,
    leftAt: r.leftAt,
    note: r.note,
  };
}

// リクエスト内の重複取得を防ぐ（cross-request キャッシュではないため、更新は次のリクエストから反映）
const getAllMembershipRecordsRaw = cache(async (): Promise<MembershipRecord[]> => {
  const rows = await db.select().from(personGroupMemberships);
  return rows.map(rowToRecord);
});

/**
 * 全所属履歴。取得に失敗した場合（テーブル未作成を含む）は [] を返し、
 * 全員が従来どおり persons.group + person_meta で解釈される（ページは落とさない）。
 */
export async function getAllMembershipRecords(): Promise<MembershipRecord[]> {
  try {
    return await getAllMembershipRecordsRaw();
  } catch (err) {
    console.error('[db] getAllMembershipRecords failed:', String(err));
    return [];
  }
}

export async function getMembershipRecordsForPerson(personName: string): Promise<MembershipRecord[]> {
  const all = await getAllMembershipRecords();
  return all.filter((r) => r.personName === personName);
}

export interface MembershipInput {
  groupName: string;
  activityStatus: MembershipRecord['activityStatus'];
  joinedAt?: string | null;
  leftAt?: string | null;
  note?: string | null;
}

/** (person_name, group_name) 単位の upsert。同じ内容を何度保存しても行は増えない */
export async function upsertMemberships(personName: string, inputs: MembershipInput[]): Promise<void> {
  const now = new Date();
  for (const m of inputs) {
    const groupName = m.groupName.trim();
    if (!groupName) continue;
    const values = {
      personName,
      groupName,
      activityStatus: m.activityStatus,
      joinedAt: m.joinedAt?.trim() || null,
      leftAt: m.leftAt?.trim() || null,
      note: m.note?.trim() || null,
      updatedAt: now,
    };
    await db
      .insert(personGroupMemberships)
      .values(values)
      .onConflictDoUpdate({
        target: [personGroupMemberships.personName, personGroupMemberships.groupName],
        set: {
          activityStatus: values.activityStatus,
          joinedAt: values.joinedAt,
          leftAt: values.leftAt,
          note: values.note,
          updatedAt: now,
        },
      });
  }
  revalidatePublicListings();
}

/** 管理画面で明示的に削除した所属行だけを消す（人物・作品データには触れない） */
export async function deleteMemberships(personName: string, groupNames: string[]): Promise<void> {
  if (groupNames.length === 0) return;
  await db
    .delete(personGroupMemberships)
    .where(and(eq(personGroupMemberships.personName, personName), inArray(personGroupMemberships.groupName, groupNames)));
  revalidatePublicListings();
}
