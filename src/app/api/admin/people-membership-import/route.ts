import { NextResponse } from 'next/server';
import { ensureGroupMeta } from '@/lib/group-meta';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetas } from '@/lib/person-meta';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { ActivityStatus, CareerStatus } from '@/types/person';
import { upsertPersonMeta } from '@/db/write';

// ── GET: グループメンバー or 個人 + 既存メタを返す（テンプレート生成用）──────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const group = searchParams.get('group');
  const personName = searchParams.get('person');

  if (!group && !personName) {
    return NextResponse.json({ error: 'group または person が必要です' }, { status: 400 });
  }

  try {
    const [allPersons, metaMap] = await Promise.all([
      getAllPersonsMerged(),
      getAllPersonMetas().catch(() => ({} as Record<string, PersonMeta>)),
    ]);

    if (personName) {
      const person = allPersons.find((p) => p.name === personName);
      if (!person) return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
      return NextResponse.json({
        members: [{ name: person.name, group: person.group ?? '', meta: metaMap[person.name] ?? null }],
      });
    }

    const members = allPersons.filter((p) => p.group === group);
    if (members.length === 0) return NextResponse.json({ members: [] });

    return NextResponse.json({
      members: members.map((m) => ({
        name: m.name,
        group: m.group ?? '',
        meta: metaMap[m.name] ?? null,
      })),
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

    // 全人物名セット + 全 PersonMeta を取得
    const [allPersons, metaMap] = await Promise.all([
      getAllPersonsMerged(),
      getAllPersonMetas().catch(() => ({} as Record<string, PersonMeta>)),
    ]);

    const personNameSet = new Set(allPersons.map((p) => p.name));

    const previewRows: PreviewRow[] = rows.map((row) => {
      const name = row['name']?.trim() ?? '';
      if (!name) return { name: '(空)', found: false, groupName: '', changes: [], hasChanges: false, error: 'name 列が空' };
      const found = personNameSet.has(name);
      const existing = metaMap[name] ?? {};
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
          toUpdate: previewRows.filter((r) => r.found && r.hasChanges).length,
          toSkip: previewRows.filter((r) => !r.found || !r.hasChanges).length,
        },
      });
    }

    // apply
    let updated = 0;
    let skipped = 0;
    let groupsCreated = 0;
    const errors: string[] = [];

    for (const preview of previewRows) {
      if (!preview.found || !preview.hasChanges) { skipped++; continue; }
      try {
        const newMeta = applyChanges(metaMap[preview.name] ?? {}, preview.changes);
        await upsertPersonMeta(preview.name, newMeta);
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
