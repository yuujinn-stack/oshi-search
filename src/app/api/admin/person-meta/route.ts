import { NextRequest, NextResponse } from 'next/server';
import { ensureGroupMeta } from '@/lib/group-meta';
import { getPersonMeta, getAllPersonMetas } from '@/lib/person-meta';
import { upsertPersonMeta } from '@/db/write';
import type { PersonPriority } from '@/app/admin/work-check/work-check-types';
import type { ActivityStatus, CareerStatus } from '@/types/person';

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
  /** 'female' | 'male' | undefined(未設定)。写真集機能用。管理画面からの手動設定のみ。 */
  gender?: 'female' | 'male';
}

// POSTの body.gender専用の型。null は「未設定に戻す（明示的にクリア）」、
// undefined は「このリクエストではgenderを変更しない」を意味する（他フィールドと違い、
// 未設定に戻す操作を必須要件としてサポートするため区別する）。
type GenderPatchValue = 'female' | 'male' | null;

export async function GET() {
  try {
    const result = await getAllPersonMetas();
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
    gender?: GenderPatchValue;
  };
  const {
    personName, memo, priority,
    activityStatus, generation, joinedAt, leftAt,
    currentGroupName, formerGroupNames, membershipNote,
    primaryGenre, genres, titles, publicRoles, awards, careerStatus, roleNote,
    gender,
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
    // gender: null は「未設定に戻す」の明示的な指示として扱う（他フィールドと異なり
    // クリア操作をサポートする必要があるため、undefinedとnullを区別する）。
    ...(gender !== undefined ? { gender: gender ?? undefined } : {}),
    updatedAt: Date.now(),
  };

  const current = (await getPersonMeta(personName)) ?? {};
  const updated: PersonMeta = { ...current, ...patch };
  await upsertPersonMeta(personName, updated);
  if (currentGroupName) await ensureGroupMeta(currentGroupName).catch(() => {});
  return NextResponse.json({ ok: true });
}
