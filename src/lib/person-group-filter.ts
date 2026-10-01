/**
 * Instagram予約画面の人物選択で使う、グループでの絞り込み・一括選択（純粋関数）。
 * グループの候補はハードコードせず、人物データから作る。人物一覧に出す人物の条件（誰を表示するか）は変えない。
 *
 * 現役・卒業（元メンバー）の判定は、人物ごとの所属データ（person_meta）だけを使う（人物名・グループ名で決め打ちしない）：
 *   - group：人物登録時の所属グループ（卒業後もそのまま残っている）
 *   - currentGroupName：現在所属しているグループ（「卒業済みは空欄」が登録ルール）
 *   - formerGroupNames：過去に所属していたグループ（すべて）
 *   - activityStatus：active / graduated / withdrawn / hiatus / retired / unknown（登録グループでの状態）
 * グループGの「卒業・元メンバー」＝ G が formerGroupNames にある、または登録グループが G で
 *   activityStatus が graduated / withdrawn / retired。
 * グループGの「現役」＝ 元メンバーに当たらず、currentGroupName が G（currentGroupName が空なら登録グループが G）。
 *   currentGroupName が卒業後も残っている人物（activityStatus=graduated 等と矛盾）は、卒業側の情報を優先して元メンバー扱い。
 *   hiatus（活動休止）・unknown は卒業扱いにしない（勝手に除外しない）。
 */
import type { PersonOption } from '@/components/admin/PersonCombobox';

/** 「すべて」 */
export const GROUP_ALL = '';
/** 「グループなし」（登録グループも現在の所属グループも空の人物） */
export const GROUP_NONE = '__none__';

/** 登録グループでの所属が終わったことを表す activityStatus（既存の値のみ） */
const ENDED_STATUSES = new Set(['graduated', 'withdrawn', 'retired']);

function t(v: string | undefined): string {
  return (v ?? '').trim();
}

/** グループGの卒業・元メンバーか */
export function isFormerMember(p: PersonOption, g: string): boolean {
  if ((p.formerGroupNames ?? []).some((x) => t(x) === g)) return true;
  return t(p.group) === g && ENDED_STATUSES.has(p.activityStatus ?? '');
}

/** グループGの現役メンバーか */
export function isCurrentMember(p: PersonOption, g: string): boolean {
  if (!g || isFormerMember(p, g)) return false;
  const current = t(p.currentGroupName);
  return current ? current === g : t(p.group) === g;
}

/** グループGに所属したことがある（現役＋卒業・元メンバー） */
export function isAffiliated(p: PersonOption, g: string): boolean {
  return !!g && (t(p.group) === g || t(p.currentGroupName) === g || (p.formerGroupNames ?? []).some((x) => t(x) === g));
}

/** グループなし（登録グループも現在の所属グループも空。俳優など） */
export function hasNoGroup(p: PersonOption): boolean {
  return !t(p.group) && !t(p.currentGroupName);
}

export interface GroupOption {
  value: string;
  label: string;
  /** 現役の人数 */
  currentCount: number;
  /** 現役＋卒業・元メンバーの人数 */
  allCount: number;
}

/**
 * グループの選択肢（人物データにあるグループ名から重複なしで作る）。現役の人数が多い順→全体の人数→名前順。
 * グループなしの人物がいれば最後に「グループなし」。
 */
export function buildGroupOptions(persons: readonly PersonOption[]): GroupOption[] {
  const names = new Set<string>();
  for (const p of persons) {
    for (const g of [p.group, p.currentGroupName, ...(p.formerGroupNames ?? [])]) if (t(g)) names.add(t(g));
  }
  const options = [...names].map((g) => ({
    value: g,
    label: g,
    currentCount: persons.filter((p) => isCurrentMember(p, g)).length,
    allCount: persons.filter((p) => isAffiliated(p, g)).length,
  }));
  options.sort((a, b) => b.currentCount - a.currentCount || b.allCount - a.allCount || a.label.localeCompare(b.label, 'ja'));
  const none = persons.filter(hasNoGroup).length;
  return none > 0 ? [...options, { value: GROUP_NONE, label: 'グループなし', currentCount: none, allCount: none }] : options;
}

/** 検索語の判定（人物名・グループ名・別名。従来の検索に、現グループ名・過去の所属グループ名を加えたもの） */
export function matchesQuery(p: PersonOption, q: string): boolean {
  const lq = q.trim().toLowerCase();
  if (!lq) return true;
  return (
    p.name.toLowerCase().includes(lq) ||
    (p.group ?? '').toLowerCase().includes(lq) ||
    (p.currentGroupName ?? '').toLowerCase().includes(lq) ||
    (p.formerGroupNames ?? []).some((g) => g.toLowerCase().includes(lq)) ||
    (p.aliases ?? []).some((a) => a.toLowerCase().includes(lq))
  );
}

/** グループ条件（includeFormer=false なら現役のみ、true なら卒業・元メンバーも含む） */
export function matchesGroup(p: PersonOption, group: string, includeFormer = false): boolean {
  if (group === GROUP_ALL) return true;
  if (group === GROUP_NONE) return hasNoGroup(p);
  return includeFormer ? isAffiliated(p, group) : isCurrentMember(p, group);
}

/** グループ条件＋検索条件の両方に一致する人物（人物一覧の並び順のまま） */
export function filterPersons(persons: readonly PersonOption[], group: string, query: string, includeFormer = false): PersonOption[] {
  return persons.filter((p) => matchesGroup(p, group, includeFormer) && matchesQuery(p, query));
}

/**
 * 表示中（条件に一致する人物）をまとめて選択する。すでに選択している人物はそのまま残し（条件外の人物も解除しない）、
 * 未選択の人物だけを一覧の並び順で末尾に追加する。上限（maxSelected）があればそこで止める。
 * 戻り値の added は実際に追加した人数、skipped は上限のため追加できなかった人数。
 */
export function selectAllMatching(
  selected: readonly string[],
  matching: readonly PersonOption[],
  maxSelected?: number,
): { next: string[]; added: number; skipped: number } {
  const set = new Set(selected);
  const next = [...selected];
  let added = 0;
  let skipped = 0;
  for (const p of matching) {
    if (set.has(p.name)) continue;
    if (maxSelected !== undefined && next.length >= maxSelected) {
      skipped++;
      continue;
    }
    next.push(p.name);
    set.add(p.name);
    added++;
  }
  return { next, added, skipped };
}
