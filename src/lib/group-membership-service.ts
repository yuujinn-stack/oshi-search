// 所属履歴の保存（管理画面の所属編集・所属情報CSV・データ移行スクリプトで共通）。
// 行の upsert / 明示削除のあと、person_meta の旧フィールド（persons.group についての activityStatus・日付）を揃え、
// 所属グループの group_meta が無ければ既存の登録ルール（ensureGroupMeta）で作る。
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { personGroupMemberships } from '@/db/schema';
import { upsertPersonMeta } from '@/db/write';
import { ensureGroupMeta } from '@/lib/group-meta';
import { getPersonMeta } from '@/lib/person-meta';
import { deleteMemberships, upsertMemberships, type MembershipInput } from '@/lib/group-membership-store';
import { isValidMembershipStatus, legacyMetaMirror, type MembershipRecord } from '@/lib/group-membership';

/** キャッシュを通さずに1人分の所属行を読む（保存直後の値が必要なため） */
export async function fetchMembershipRecords(personName: string): Promise<MembershipRecord[]> {
  const rows = await db.select().from(personGroupMemberships).where(eq(personGroupMemberships.personName, personName));
  return rows.map((r) => ({
    personName: r.personName,
    groupName: r.groupName,
    activityStatus: isValidMembershipStatus(r.activityStatus) ? r.activityStatus : 'unknown',
    joinedAt: r.joinedAt,
    leftAt: r.leftAt,
    note: r.note,
  }));
}

export async function saveMembershipsForPerson(
  person: { name: string; group: string },
  inputs: MembershipInput[],
  removeGroups: string[] = [],
): Promise<{ records: MembershipRecord[]; groupsCreated: string[] }> {
  await deleteMemberships(person.name, removeGroups.filter((g) => !inputs.some((m) => m.groupName === g)));
  await upsertMemberships(person.name, inputs);

  const groupsCreated: string[] = [];
  for (const m of inputs) {
    if (await ensureGroupMeta(m.groupName).catch(() => false)) groupsCreated.push(m.groupName.trim());
  }

  const records = await fetchMembershipRecords(person.name);
  const mirror = legacyMetaMirror(person, records);
  if (Object.keys(mirror).length > 0) {
    const current = (await getPersonMeta(person.name)) ?? {};
    const next = { ...current, updatedAt: Date.now() };
    if (mirror.activityStatus !== undefined) next.activityStatus = mirror.activityStatus;
    if (mirror.joinedAt !== undefined) next.joinedAt = mirror.joinedAt;
    if (mirror.leftAt !== undefined) next.leftAt = mirror.leftAt;
    const changed = (['activityStatus', 'joinedAt', 'leftAt'] as const)
      .some((k) => (current[k] ?? undefined) !== (next[k] ?? undefined));
    if (changed) await upsertPersonMeta(person.name, next);
  }
  return { records, groupsCreated };
}
