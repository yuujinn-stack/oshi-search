import { NextResponse } from 'next/server';
import { ensureGroupMeta } from '@/lib/group-meta';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetas } from '@/lib/person-meta';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { ActivityStatus, CareerStatus } from '@/types/person';
import { upsertPersonMeta } from '@/db/write';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { saveMembershipsForPerson } from '@/lib/group-membership-service';
import {
  currentMemberships,
  groupMembershipRecords,
  personsInGroup,
  resolvePersonMemberships,
  type MembershipRecord,
} from '@/lib/group-membership';
import {
  planMembershipCsvRow,
  type MembershipConflict,
  type MembershipUpsert,
} from '@/lib/group-membership-csv';

/**
 * テンプレート用の meta。所属履歴がある人物は、activityStatus / joinedAt / leftAt を「対象グループとの所属」の値に、
 * currentGroupName を現在の所属に置き換える（person_meta の値は persons.group についての値のため）。
 */
function templateMeta(
  person: { name: string; group: string },
  meta: PersonMeta | undefined,
  records: MembershipRecord[] | undefined,
  groupName: string,
): PersonMeta | null {
  if (!records?.length) return meta ?? null;
  const ms = resolvePersonMemberships(person, meta, records);
  const m = ms.find((x) => x.groupName === groupName);
  const current = currentMemberships(ms).find((x) => x.source === 'membership');
  const out: PersonMeta = { ...(meta ?? {}) };
  delete out.activityStatus; delete out.joinedAt; delete out.leftAt; delete out.currentGroupName;
  if (m?.status) out.activityStatus = m.status;
  if (m?.joinedAt) out.joinedAt = m.joinedAt;
  if (m?.leftAt) out.leftAt = m.leftAt;
  if (current) out.currentGroupName = current.groupName;
  return out;
}

export const MAX_MULTI_PERSONS = 100;

// ── GET: グループメンバー or 個人 or 複数人 + 既存メタを返す（テンプレート生成用）──
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const group = searchParams.get('group');
  const personName = searchParams.get('person');
  const personsParam = searchParams.get('persons');

  if (!group && !personName && !personsParam) {
    return NextResponse.json({ error: 'group・person・persons のいずれかが必要です' }, { status: 400 });
  }

  try {
    const [allPersons, metaMap, membershipRecords] = await Promise.all([
      getAllPersonsMerged(),
      getAllPersonMetas().catch(() => ({} as Record<string, PersonMeta>)),
      getAllMembershipRecords(),
    ]);
    const recordsByPerson = groupMembershipRecords(membershipRecords);

    // 複数人モード: ?persons=name1,name2,...
    if (personsParam) {
      const rawNames = personsParam.split(',').map((s) => s.trim()).filter(Boolean);
      // 重複を除去してから上限チェック
      const uniqueNames = [...new Set(rawNames)];
      if (uniqueNames.length === 0) {
        return NextResponse.json({ error: '人物名が指定されていません' }, { status: 400 });
      }
      if (uniqueNames.length > MAX_MULTI_PERSONS) {
        return NextResponse.json(
          { error: `一度に選択できるのは${MAX_MULTI_PERSONS}人までです` },
          { status: 400 },
        );
      }
      const personMap = new Map(allPersons.map((p) => [p.name, p]));
      const members = uniqueNames
        .filter((name) => personMap.has(name))
        .map((name) => {
          const p = personMap.get(name)!;
          return { name: p.name, group: p.group ?? '', meta: templateMeta(p, metaMap[name], recordsByPerson.get(name), p.group ?? '') };
        });
      return NextResponse.json({ members });
    }

    if (personName) {
      const person = allPersons.find((p) => p.name === personName);
      if (!person) return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
      return NextResponse.json({
        members: [{ name: person.name, group: person.group ?? '', meta: templateMeta(person, metaMap[person.name], recordsByPerson.get(person.name), person.group ?? '') }],
      });
    }

    // persons.group に加え、所属履歴でこのグループに所属（現在・過去）する人物も含める。
    // 所属履歴がある人物の行の groupName は対象グループ（その所属の状態・日付を出す）
    const members = personsInGroup(group!, allPersons, recordsByPerson);
    if (members.length === 0) return NextResponse.json({ members: [] });

    return NextResponse.json({
      members: members.map((m) => {
        const records = recordsByPerson.get(m.name);
        return {
          name: m.name,
          group: records?.length ? group! : (m.group ?? ''),
          meta: templateMeta(m, metaMap[m.name], records, group!),
        };
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

const VALID_STATUSES = new Set<ActivityStatus>([
  'active', 'graduated', 'withdrawn', 'hiatus', 'retired', 'unknown',
]);
const VALID_CAREER_STATUSES = new Set<CareerStatus>([
  'active', 'inactive', 'retired', 'deceased', 'unknown',
]);

const CLEAR_SENTINEL = '**clear**';

// ── CSV パーサー（クォートフィールド対応）────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = parseCsvLine(line).map((v) => v.replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

// ── フィールド更新ロジック ──────────────────────────────────────────────────
type FieldAction = 'update' | 'clear' | 'keep';

interface FieldChange {
  field: string;
  action: FieldAction;
  oldValue: string | undefined;
  newValue: string | undefined;
}

function resolveField(
  fieldName: string,
  rawValue: string,
  current: string | undefined,
): FieldChange {
  if (!rawValue) return { field: fieldName, action: 'keep', oldValue: current, newValue: current };
  if (rawValue === CLEAR_SENTINEL) return { field: fieldName, action: 'clear', oldValue: current, newValue: undefined };
  return { field: fieldName, action: 'update', oldValue: current, newValue: rawValue };
}

// ── プレビュー行 ─────────────────────────────────────────────────────────────
export interface PreviewRow {
  name: string;
  found: boolean;
  groupName: string;
  changes: FieldChange[];
  hasChanges: boolean;
  error?: string;
  duplicate?: boolean;
  /** 所属履歴（person_group_memberships）がある人物：所属に関する列は所属履歴に反映する */
  membershipManaged?: boolean;
  membershipUpserts?: MembershipUpsert[];
  /** 反映しなかった値（既存と異なる・脱退済みを現役に戻す等）。管理画面の所属編集で確認する */
  conflicts?: MembershipConflict[];
  notes?: string[];
}

// 所属履歴がある人物では、これらの列を person_meta に直接書かず planMembershipCsvRow で扱う
const MEMBERSHIP_COLUMNS = ['activityStatus', 'joinedAt', 'leftAt', 'currentGroupName', 'formerGroupNames'] as const;

function previewForMembershipPerson(
  row: Record<string, string>,
  person: { name: string; group: string },
  existing: PersonMeta,
  records: MembershipRecord[],
): Pick<PreviewRow, 'changes' | 'membershipUpserts' | 'conflicts' | 'notes'> {
  const rest: Record<string, string> = { ...row };
  for (const c of MEMBERSHIP_COLUMNS) rest[c] = '';
  const changes = computeChanges(rest, existing);
  const plan = planMembershipCsvRow({
    personGroup: person.group,
    records,
    existingFormerGroupNames: existing.formerGroupNames,
    row: {
      groupName: row['groupName'] ?? '',
      activityStatus: row['activityStatus'] ?? '',
      joinedAt: row['joinedAt'] ?? '',
      leftAt: row['leftAt'] ?? '',
      currentGroupName: row['currentGroupName'] ?? '',
      formerGroupNames: row['formerGroupNames'] ?? '',
    },
  });
  if (plan.formerGroupNames) {
    const old = (existing.formerGroupNames ?? []).join(', ');
    changes.push({ field: 'formerGroupNames', action: 'update', oldValue: old || undefined, newValue: plan.formerGroupNames.join(', ') });
  }
  return { changes, membershipUpserts: plan.upserts, conflicts: plan.conflicts, notes: plan.notes };
}

function computeChanges(row: Record<string, string>, existing: PersonMeta): FieldChange[] {
  const changes: FieldChange[] = [];

  // activityStatus
  const rawStatus = row['activityStatus']?.trim() ?? '';
  if (rawStatus && rawStatus !== CLEAR_SENTINEL && !VALID_STATUSES.has(rawStatus as ActivityStatus)) {
    // invalid — skip with error
    changes.push({ field: 'activityStatus', action: 'keep', oldValue: existing.activityStatus, newValue: existing.activityStatus });
  } else {
    changes.push(resolveField('activityStatus', rawStatus, existing.activityStatus));
  }

  changes.push(resolveField('generation', row['generation']?.trim() ?? '', existing.generation));
  changes.push(resolveField('joinedAt', row['joinedAt']?.trim() ?? '', existing.joinedAt));
  changes.push(resolveField('leftAt', row['leftAt']?.trim() ?? '', existing.leftAt));
  changes.push(resolveField('currentGroupName', row['currentGroupName']?.trim() ?? '', existing.currentGroupName));
  changes.push(resolveField('membershipNote', row['membershipNote']?.trim() ?? '', existing.membershipNote));

  // formerGroupNames (カンマ区切り配列)
  const rawFormer = row['formerGroupNames']?.trim() ?? '';
  const existingFormerStr = (existing.formerGroupNames ?? []).join(', ');
  if (!rawFormer) {
    changes.push({ field: 'formerGroupNames', action: 'keep', oldValue: existingFormerStr || undefined, newValue: existingFormerStr || undefined });
  } else if (rawFormer === CLEAR_SENTINEL) {
    changes.push({ field: 'formerGroupNames', action: 'clear', oldValue: existingFormerStr || undefined, newValue: undefined });
  } else {
    changes.push({ field: 'formerGroupNames', action: 'update', oldValue: existingFormerStr || undefined, newValue: rawFormer });
  }

  // 活動情報フィールド
  changes.push(resolveField('primaryGenre', row['primaryGenre']?.trim() ?? '', existing.primaryGenre));
  changes.push(resolveField('roleNote', row['roleNote']?.trim() ?? '', existing.roleNote));

  // careerStatus
  const rawCareer = row['careerStatus']?.trim() ?? '';
  if (rawCareer && rawCareer !== CLEAR_SENTINEL && !VALID_CAREER_STATUSES.has(rawCareer as CareerStatus)) {
    changes.push({ field: 'careerStatus', action: 'keep', oldValue: existing.careerStatus, newValue: existing.careerStatus });
  } else {
    changes.push(resolveField('careerStatus', rawCareer, existing.careerStatus));
  }

  // 配列フィールド: genres / titles / publicRoles / awards
  for (const arrayField of ['genres', 'titles', 'publicRoles', 'awards'] as const) {
    const rawArr = row[arrayField]?.trim() ?? '';
    const existingArr = (existing[arrayField] ?? []).join(', ');
    if (!rawArr) {
      changes.push({ field: arrayField, action: 'keep', oldValue: existingArr || undefined, newValue: existingArr || undefined });
    } else if (rawArr === CLEAR_SENTINEL) {
      changes.push({ field: arrayField, action: 'clear', oldValue: existingArr || undefined, newValue: undefined });
    } else {
      changes.push({ field: arrayField, action: 'update', oldValue: existingArr || undefined, newValue: rawArr });
    }
  }

  return changes.filter((c) => c.action !== 'keep');
}

function applyChanges(existing: PersonMeta, changes: FieldChange[]): PersonMeta {
  const updated: PersonMeta = { ...existing, updatedAt: Date.now() };
  for (const ch of changes) {
    const ARRAY_FIELDS = new Set(['formerGroupNames', 'genres', 'titles', 'publicRoles', 'awards']);
    if (ch.action === 'clear') {
      delete (updated as Record<string, unknown>)[ch.field];
    } else if (ch.action === 'update') {
      if (ARRAY_FIELDS.has(ch.field)) {
        (updated as Record<string, unknown>)[ch.field] = (ch.newValue ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      } else if (ch.field === 'activityStatus') {
        (updated as Record<string, unknown>)[ch.field] = ch.newValue as ActivityStatus;
      } else if (ch.field === 'careerStatus') {
        (updated as Record<string, unknown>)[ch.field] = ch.newValue as CareerStatus;
      } else {
        (updated as Record<string, unknown>)[ch.field] = ch.newValue;
      }
    }
  }
  return updated;
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const { csv, action } = await req.json() as { csv: string; action: 'preview' | 'apply' };
    if (!csv?.trim()) return NextResponse.json({ error: 'CSV が空です' }, { status: 400 });
    if (action !== 'preview' && action !== 'apply') return NextResponse.json({ error: 'action は preview か apply' }, { status: 400 });

    const rows = parseCsv(csv);
    if (rows.length === 0) return NextResponse.json({ error: 'データ行がありません' }, { status: 400 });

    // 全人物名セット + 全 PersonMeta + 所属履歴を取得
    const [allPersons, metaMap, membershipRecords] = await Promise.all([
      getAllPersonsMerged(),
      getAllPersonMetas().catch(() => ({} as Record<string, PersonMeta>)),
      getAllMembershipRecords(),
    ]);

    const personNameSet = new Set(allPersons.map((p) => p.name));
    const personByName = new Map(allPersons.map((p) => [p.name, p]));
    const recordsByPerson = groupMembershipRecords(membershipRecords);

    const seenNames = new Set<string>();
    const previewRows: PreviewRow[] = rows.map((row) => {
      const name = row['name']?.trim() ?? '';
      if (!name) return { name: '(空)', found: false, groupName: '', changes: [], hasChanges: false, error: 'name 列が空' };
      if (seenNames.has(name)) {
        return { name, found: false, groupName: row['groupName']?.trim() ?? '', changes: [], hasChanges: false, duplicate: true };
      }
      seenNames.add(name);
      const found = personNameSet.has(name);
      const existing = metaMap[name] ?? {};
      const records = recordsByPerson.get(name);
      if (found && records?.length) {
        const m = previewForMembershipPerson(row, personByName.get(name)!, existing, records);
        return {
          name,
          found,
          groupName: row['groupName']?.trim() ?? '',
          ...m,
          membershipManaged: true,
          hasChanges: m.changes.length > 0 || (m.membershipUpserts?.length ?? 0) > 0,
        };
      }
      const changes = found ? computeChanges(row, existing) : [];
      return {
        name,
        found,
        groupName: row['groupName']?.trim() ?? '',
        changes,
        hasChanges: changes.length > 0,
      };
    });

    if (action === 'preview') {
      return NextResponse.json({
        rows: previewRows,
        summary: {
          total: previewRows.length,
          toUpdate: previewRows.filter((r) => r.found && r.hasChanges && !r.duplicate).length,
          toSkip: previewRows.filter((r) => !r.found || !r.hasChanges || r.duplicate).length,
          conflicts: previewRows.reduce((n, r) => n + (r.conflicts?.length ?? 0), 0),
        },
      });
    }

    // apply
    let updated = 0;
    let skipped = 0;
    let groupsCreated = 0;
    const errors: string[] = [];

    for (const preview of previewRows) {
      if (!preview.found || !preview.hasChanges || preview.duplicate) { skipped++; continue; }
      try {
        if (preview.changes.length > 0) {
          const newMeta = applyChanges(metaMap[preview.name] ?? {}, preview.changes);
          await upsertPersonMeta(preview.name, newMeta);
        }
        if (preview.membershipUpserts?.length) {
          // 所属履歴の追加・空欄の補完（競合した値は反映しない）。person_meta の旧フィールドもここで揃える
          await saveMembershipsForPerson(personByName.get(preview.name)!, preview.membershipUpserts);
        }
        const groupsToEnsure = [
          preview.groupName,
          preview.changes.find((c) => c.field === 'currentGroupName' && c.action === 'update')?.newValue,
        ].filter(Boolean) as string[];
        for (const g of groupsToEnsure) {
          const created = await ensureGroupMeta(g);
          if (created) groupsCreated++;
        }
        updated++;
      } catch (err) {
        errors.push(`${preview.name}: ${String(err)}`);
      }
    }

    return NextResponse.json({ updated, skipped, groupsCreated, errors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
