// 所属情報CSV（/admin/people-membership-import）の1行を、所属履歴（person_group_memberships）がある人物に
// どう反映するかを決める純粋関数。CSVの形式（name, groupName, activityStatus, joinedAt, leftAt,
// currentGroupName, formerGroupNames …）は変えない。
//
// 旧CSVの groupName は所属履歴（過去のグループ）を表すことがあるため、常に現在の所属とは解釈しない。
// 行の activityStatus / joinedAt / leftAt は「groupName（空なら persons.group）との所属」の値として扱う。
//
// 方針（既存の正しい所属を壊さない）
// - 空欄は「変更しない」。既存の値と異なる値は上書きせず「競合」として返し、管理画面で確認してもらう
// - 脱退・卒業済みの所属を現役（active / hiatus）として再登録しない
// - 既存の値が空（NULL）の項目だけを埋める。同じCSVを何度取り込んでも結果は同じ（冪等）
// - currentGroupName に所属履歴の無いグループ・脱退済みのグループが書かれていても、所属行は作らず競合にする
// - formerGroupNames は既存と合わせる（既存の値を消さない）。現役の所属グループは追加しない
// 所属履歴の行が無い人物には使わない（従来どおり person_meta だけを更新する）。
import type { ActivityStatus } from '@/types/person';
import { isFormerStatus, isValidMembershipStatus, type MembershipRecord } from '@/lib/group-membership';

export const CSV_CLEAR_SENTINEL = '**clear**';

export interface MembershipCsvRow {
  groupName: string;
  activityStatus: string;
  joinedAt: string;
  leftAt: string;
  currentGroupName: string;
  formerGroupNames: string;
}

export interface MembershipUpsert {
  groupName: string;
  activityStatus: ActivityStatus;
  joinedAt: string | null;
  leftAt: string | null;
  note?: string | null;
}

export interface MembershipConflict {
  field: string;
  groupName: string;
  existing: string | null;
  incoming: string;
  reason: string;
}

export interface MembershipCsvPlan {
  /** 所属履歴の行の追加・更新（空欄だった項目を埋めたもの） */
  upserts: MembershipUpsert[];
  /** 反映しなかった値（既存と異なる・脱退済みを現役に戻す等）。管理画面で確認する */
  conflicts: MembershipConflict[];
  /** person_meta.formerGroupNames の新しい値（変更が無ければ undefined） */
  formerGroupNames?: string[];
  /** 表示用の説明 */
  notes: string[];
}

const CURRENT_STATUSES = new Set<ActivityStatus>(['active', 'hiatus']);

function cell(v: string | undefined): string {
  const t = (v ?? '').trim();
  return t === CSV_CLEAR_SENTINEL ? '' : t; // 所属履歴の値は CSV からは消さない（**clear** も「変更しない」）
}

export function planMembershipCsvRow(input: {
  personGroup: string;
  records: MembershipRecord[];
  existingFormerGroupNames: string[] | undefined;
  row: MembershipCsvRow;
}): MembershipCsvPlan {
  const { personGroup, records, row } = input;
  const upserts: MembershipUpsert[] = [];
  const conflicts: MembershipConflict[] = [];
  const notes: string[] = [];
  const byGroup = new Map(records.map((r) => [r.groupName, r]));

  const targetGroup = cell(row.groupName) || personGroup;
  const rawStatus = cell(row.activityStatus);
  const status = isValidMembershipStatus(rawStatus) ? rawStatus : undefined;
  const joinedAt = cell(row.joinedAt);
  const leftAt = cell(row.leftAt);

  if (targetGroup && (status || joinedAt || leftAt)) {
    const existing = byGroup.get(targetGroup);
    if (existing) {
      let nextStatus = existing.activityStatus;
      let nextJoined = existing.joinedAt;
      let nextLeft = existing.leftAt;
      if (status && status !== existing.activityStatus) {
        if (isFormerStatus(existing.activityStatus) && CURRENT_STATUSES.has(status)) {
          conflicts.push({ field: 'activityStatus', groupName: targetGroup, existing: existing.activityStatus, incoming: status, reason: '脱退・卒業済みの所属を現役に戻さない' });
        } else if (existing.activityStatus === 'unknown') {
          nextStatus = status;
        } else {
          conflicts.push({ field: 'activityStatus', groupName: targetGroup, existing: existing.activityStatus, incoming: status, reason: '既存の所属状態と異なる' });
        }
      }
      if (joinedAt && joinedAt !== existing.joinedAt) {
        if (!existing.joinedAt) nextJoined = joinedAt;
        else conflicts.push({ field: 'joinedAt', groupName: targetGroup, existing: existing.joinedAt, incoming: joinedAt, reason: '既存の加入日と異なる' });
      }
      if (leftAt && leftAt !== existing.leftAt) {
        if (CURRENT_STATUSES.has(nextStatus)) {
          conflicts.push({ field: 'leftAt', groupName: targetGroup, existing: existing.leftAt, incoming: leftAt, reason: '現役の所属に脱退日は設定しない' });
        } else if (!existing.leftAt) {
          nextLeft = leftAt;
        } else {
          conflicts.push({ field: 'leftAt', groupName: targetGroup, existing: existing.leftAt, incoming: leftAt, reason: '既存の脱退日と異なる' });
        }
      }
      if (nextStatus !== existing.activityStatus || nextJoined !== existing.joinedAt || nextLeft !== existing.leftAt) {
        upserts.push({ groupName: targetGroup, activityStatus: nextStatus, joinedAt: nextJoined, leftAt: nextLeft, note: existing.note ?? null });
      }
    } else if (status) {
      if (CURRENT_STATUSES.has(status) && leftAt) {
        conflicts.push({ field: 'leftAt', groupName: targetGroup, existing: null, incoming: leftAt, reason: '現役の所属に脱退日は設定しない' });
        upserts.push({ groupName: targetGroup, activityStatus: status, joinedAt: joinedAt || null, leftAt: null });
      } else {
        upserts.push({ groupName: targetGroup, activityStatus: status, joinedAt: joinedAt || null, leftAt: leftAt || null });
      }
      notes.push(`${targetGroup} の所属履歴を追加`);
    } else {
      notes.push(`${targetGroup}：所属状態が空のため所属履歴には追加しない`);
    }
  }

  const currentGroupName = cell(row.currentGroupName);
  if (currentGroupName) {
    const r = byGroup.get(currentGroupName);
    if (!r) {
      conflicts.push({ field: 'currentGroupName', groupName: currentGroupName, existing: null, incoming: currentGroupName, reason: '所属履歴に無いグループ（人物の所属編集で追加してください）' });
    } else if (isFormerStatus(r.activityStatus)) {
      conflicts.push({ field: 'currentGroupName', groupName: currentGroupName, existing: r.activityStatus, incoming: currentGroupName, reason: '脱退・卒業済みのグループを現在の所属にしない' });
    }
  }

  const rawFormer = cell(row.formerGroupNames);
  if (rawFormer) {
    const incoming = rawFormer.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
    const existingList = input.existingFormerGroupNames ?? [];
    const merged = [...existingList];
    for (const g of incoming) {
      const r = byGroup.get(g);
      if (r && CURRENT_STATUSES.has(r.activityStatus)) {
        conflicts.push({ field: 'formerGroupNames', groupName: g, existing: r.activityStatus, incoming: g, reason: '現役の所属グループは旧所属に追加しない' });
        continue;
      }
      if (!merged.includes(g)) merged.push(g);
    }
    if (merged.length !== existingList.length) {
      return { upserts, conflicts, formerGroupNames: merged, notes };
    }
  }

  return { upserts, conflicts, notes };
}
