// 診断用の人物複数選択UI（OshiVodPersonPicker）に渡すデータの型と純粋関数。
// DB非依存（'use client' からも import 可）。
import type { ActivityStatus } from '@/types/person';
import { OSHI_VOD_MAX_PERSONS } from './params';

export interface OshiVodPickerPerson {
  name: string;
  group: string;
  /** 検索用の別名（表示・識別子には使わない） */
  aliases: string[];
  /** 現役メンバーか（グループページの「現メンバー」と同じ判定: active / hiatus / 未設定） */
  isCurrent: boolean;
  /**
   * グループごとの所属（所属履歴 person_group_memberships がある人物だけ）。指定時はグループ分けに
   * group / isCurrent の代わりにこちらを使う（移籍先グループにも、元のグループの元メンバーにも入る）。
   */
  memberships?: { group: string; isCurrent: boolean }[];
}

export interface OshiVodPickerGroup {
  name: string;
  /** 現役メンバー（選択順の既定） */
  currentMembers: string[];
  /** 卒業・脱退等のメンバー（個別選択のみ） */
  formerMembers: string[];
}

/**
 * グループページ（/groups/[groupSlug]）の現メンバー判定と同じ条件。
 * activityStatus 未設定は active 扱い、休止中（hiatus）も現メンバーに含める。
 */
export function isCurrentMemberStatus(status: ActivityStatus | undefined): boolean {
  const s = status ?? 'active';
  return s === 'active' || s === 'hiatus';
}

/** グループ全員（現メンバー）を一括で診断できるか */
export function canSelectWholeGroup(currentMemberCount: number): boolean {
  return currentMemberCount > 0 && currentMemberCount <= OSHI_VOD_MAX_PERSONS;
}

export function buildPickerGroups(persons: OshiVodPickerPerson[]): OshiVodPickerGroup[] {
  const map = new Map<string, OshiVodPickerGroup>();
  for (const p of persons) {
    for (const m of p.memberships ?? [{ group: p.group, isCurrent: p.isCurrent }]) {
      if (!m.group) continue;
      let g = map.get(m.group);
      if (!g) {
        g = { name: m.group, currentMembers: [], formerMembers: [] };
        map.set(m.group, g);
      }
      (m.isCurrent ? g.currentMembers : g.formerMembers).push(p.name);
    }
  }
  return [...map.values()];
}

/** NFKC + 小文字化（全角英数・記号の表記ゆれ吸収。例: ＝LOVE / =LOVE） */
export function normalizeSearchText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export interface PickerSuggestion {
  kind: 'person' | 'group';
  /** person: 人物名 / group: グループ名 */
  value: string;
  sublabel?: string;
}

/** 検索語に部分一致する人物（名前・別名）・グループの候補（人物を優先） */
export function searchPickerSuggestions(
  query: string,
  persons: OshiVodPickerPerson[],
  groups: OshiVodPickerGroup[],
  limit = 8,
): PickerSuggestion[] {
  const q = normalizeSearchText(query);
  if (!q) return [];
  const out: PickerSuggestion[] = [];
  const groupHits = groups.filter((g) => normalizeSearchText(g.name).includes(q));
  for (const g of groupHits.slice(0, 2)) {
    out.push({ kind: 'group', value: g.name, sublabel: `${g.currentMembers.length}人` });
  }
  for (const p of persons) {
    if (out.length >= limit) break;
    const alias = p.aliases.find((a) => normalizeSearchText(a).includes(q));
    if (normalizeSearchText(p.name).includes(q) || alias) {
      out.push({ kind: 'person', value: p.name, sublabel: alias && !normalizeSearchText(p.name).includes(q) ? `${alias}・${p.group}` : p.group || undefined });
    }
  }
  return out.slice(0, limit);
}
