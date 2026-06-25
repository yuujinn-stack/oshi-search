import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis';
import { ensureGroupMeta } from '@/lib/group-meta';
import type { PersonPriority } from '@/app/admin/work-check/work-check-types';
import type { ActivityStatus } from '@/types/person';

const META_KEY = 'admin:person-meta';

export interface PersonMeta {
  memo?: string;
  priority?: PersonPriority;
  updatedAt?: number;
  activityStatus?: ActivityStatus;
  generation?: string;
  joinedAt?: string;
  leftAt?: string;
  currentGroupName?: string;
  formerGroupNames?: string[];
  membershipNote?: string;
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
  };
  const {
    personName, memo, priority,
    activityStatus, generation, joinedAt, leftAt,
    currentGroupName, formerGroupNames, membershipNote,
  } = body;
  if (!personName) {
    return NextResponse.json({ error: 'personName required' }, { status: 400 });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Redis not available' }, { status: 503 });

  const existing = await redis.hget<string>(META_KEY, personName);
  const current: PersonMeta = existing
    ? ((typeof existing === 'string' ? JSON.parse(existing) : existing) as PersonMeta)
    : {};

  const updated: PersonMeta = {
    ...current,
    ...(memo !== undefined ? { memo } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(activityStatus !== undefined ? { activityStatus } : {}),
    ...(generation !== undefined ? { generation } : {}),
    ...(joinedAt !== undefined ? { joinedAt } : {}),
    ...(leftAt !== undefined ? { leftAt } : {}),
    ...(currentGroupName !== undefined ? { currentGroupName } : {}),
    ...(formerGroupNames !== undefined ? { formerGroupNames } : {}),
    ...(membershipNote !== undefined ? { membershipNote } : {}),
    updatedAt: Date.now(),
  };

  await redis.hset(META_KEY, { [personName]: JSON.stringify(updated) });

  // currentGroupName が設定されていれば GroupMeta を自動作成
  if (currentGroupName) {
    await ensureGroupMeta(currentGroupName).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
