import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { ensureGroupMeta } from '@/lib/group-meta';
import { getPersonMeta } from '@/lib/person-meta';
import { dbWrite, upsertPersonMeta } from '@/db/write';
import { isDbOnlyWriteEnabled } from '@/lib/db-flag';
import type { PersonPriority } from '@/app/admin/work-check/work-check-types';
import type { ActivityStatus, CareerStatus } from '@/types/person';

const META_KEY = 'admin:person-meta';

export interface PersonMeta {
  memo?: string;
  priority?: PersonPriority;
  updatedAt?: number;
  // 所属情報
  activityStatus?: ActivityStatus;
  generation?: string;
  joinedAt?: string;
  leftAt?: string;
  currentGroupName?: string;
  formerGroupNames?: string[];
  membershipNote?: string;
  // 活動情報（拡張）
  primaryGenre?: string;
  genres?: string[];
  titles?: string[];
  publicRoles?: string[];
  awards?: string[];
  careerStatus?: CareerStatus;
  roleNote?: string;
}

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({});
  try {
    const raw = await redis.hgetall(META_KEY);
    if (!raw) return NextResponse.json({});
    const result: Record<string, PersonMeta> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        result[k] = (typeof v === 'string' ? JSON.parse(v) : v) as PersonMeta;
      } catch { /* skip */ }
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    personName: string;
    memo?: string;
    priority?: PersonPriority;
    activityStatus?: ActivityStatus;
    generation?: string;
    joinedAt?: string;
    leftAt?: string;
    currentGroupName?: string;
    formerGroupNames?: string[];
    membershipNote?: string;
    primaryGenre?: string;
    genres?: string[];
    titles?: string[];
    publicRoles?: string[];
    awards?: string[];
    careerStatus?: CareerStatus;
    roleNote?: string;
  };
  const {
    personName, memo, priority,
    activityStatus, generation, joinedAt, leftAt,
    currentGroupName, formerGroupNames, membershipNote,
    primaryGenre, genres, titles, publicRoles, awards, careerStatus, roleNote,
  } = body;
  if (!personName) {
    return NextResponse.json({ error: 'personName required' }, { status: 400 });
  }

  const patch = {
    ...(memo !== undefined ? { memo } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(activityStatus !== undefined ? { activityStatus } : {}),
    ...(generation !== undefined ? { generation } : {}),
    ...(joinedAt !== undefined ? { joinedAt } : {}),
    ...(leftAt !== undefined ? { leftAt } : {}),
    ...(currentGroupName !== undefined ? { currentGroupName } : {}),
    ...(formerGroupNames !== undefined ? { formerGroupNames } : {}),
    ...(membershipNote !== undefined ? { membershipNote } : {}),
    ...(primaryGenre !== undefined ? { primaryGenre } : {}),
    ...(genres !== undefined ? { genres } : {}),
    ...(titles !== undefined ? { titles } : {}),
    ...(publicRoles !== undefined ? { publicRoles } : {}),
    ...(awards !== undefined ? { awards } : {}),
    ...(careerStatus !== undefined ? { careerStatus } : {}),
    ...(roleNote !== undefined ? { roleNote } : {}),
    updatedAt: Date.now(),
  };

  if (isDbOnlyWriteEnabled()) {
    const current = (await getPersonMeta(personName)) ?? {};
    const updated: PersonMeta = { ...current, ...patch };
    await upsertPersonMeta(personName, updated);
    if (currentGroupName) await ensureGroupMeta(currentGroupName).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not available' }, { status: 503 });

  const existing = await redis.hget<string>(META_KEY, personName);
  const current: PersonMeta = existing
    ? ((typeof existing === 'string' ? JSON.parse(existing) : existing) as PersonMeta)
    : {};

  const updated: PersonMeta = { ...current, ...patch };

  await redis.hset(META_KEY, { [personName]: JSON.stringify(updated) });
  dbWrite(`person-meta/${personName}`, () => upsertPersonMeta(personName, updated));

  // currentGroupName が設定されていれば GroupMeta を自動作成
  if (currentGroupName) {
    await ensureGroupMeta(currentGroupName).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
