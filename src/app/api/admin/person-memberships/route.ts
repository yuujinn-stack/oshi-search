// 人物の所属履歴（person_group_memberships）の取得・保存。/admin/work-check の人物編集パネルから使う。
// 保存は (人物, グループ) 単位の upsert と、画面で明示的に削除したグループの行の削除だけ（人物・作品データは触らない）。
import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getPersonMeta } from '@/lib/person-meta';
import { fetchMembershipRecords, saveMembershipsForPerson } from '@/lib/group-membership-service';
import { resolvePersonMemberships, validateMembershipInputs, type MembershipInputLike } from '@/lib/group-membership';

export const dynamic = 'force-dynamic';

async function findPerson(name: string) {
  const persons = await getAllPersonsMerged();
  return persons.find((p) => p.name === name);
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('person')?.trim();
  if (!name) return NextResponse.json({ error: 'person required' }, { status: 400 });
  const person = await findPerson(name);
  if (!person) return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  try {
    const [records, meta] = await Promise.all([fetchMembershipRecords(name), getPersonMeta(name)]);
    return NextResponse.json({
      records,
      memberships: resolvePersonMemberships(person, meta ?? undefined, records),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { personName?: string; memberships?: MembershipInputLike[]; removeGroups?: string[] };
  const name = body.personName?.trim();
  if (!name) return NextResponse.json({ error: 'personName required' }, { status: 400 });
  const inputs = (body.memberships ?? []).map((m) => ({
    groupName: String(m.groupName ?? '').trim(),
    activityStatus: m.activityStatus,
    joinedAt: m.joinedAt?.trim() || null,
    leftAt: m.leftAt?.trim() || null,
    note: m.note?.trim() || null,
  }));
  const error = validateMembershipInputs(inputs);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const person = await findPerson(name);
  if (!person) return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  try {
    const removeGroups = (body.removeGroups ?? []).map((g) => String(g).trim()).filter(Boolean);
    const { records, groupsCreated } = await saveMembershipsForPerson(person, inputs, removeGroups);
    const meta = await getPersonMeta(name);
    return NextResponse.json({
      ok: true,
      records,
      groupsCreated,
      memberships: resolvePersonMemberships(person, meta ?? undefined, records),
      currentGroupName: meta?.currentGroupName ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
