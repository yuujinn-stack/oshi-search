// 人物とグループの所属（複数所属・所属履歴）を解釈する純粋関数。
// サーバー・クライアントの両方から import するため、DB には依存しない（取得は group-membership-store.ts）。
//
// 所属の情報源（優先順）
//   1. person_group_memberships の行（source: 'membership'）… グループごとの所属状態・加入日・脱退日
//   2. persons.group_name（source: 'registered'）… 1 の行が無いグループだけ。状態・日付は person_meta の
//      activityStatus / joinedAt / leftAt（従来の解釈。行が無い人物の表示は従来と同じになる）
//   3. person_meta.formerGroupNames（source: 'former_list'）… 1・2 に無いグループ。状態・日付は不明
//
// 1 の行がある人物だけが「グループごとの所属状態」を持つ。脱退等の状態は、そのグループとの所属だけに適用し、
// 芸能活動全体の状態（person_meta.careerStatus）とは混同しない。
// person_meta.currentGroupName は従来どおり旧フィールドとして残し、ここでは所属の判定に使わない
// （行が無い人物の所属判定を従来から変えないため）。所属履歴の保存時にも currentGroupName は書き換えない。
import type { ActivityStatus, CareerStatus } from '@/types/person';

export const MEMBERSHIP_STATUSES: readonly ActivityStatus[] = [
  'active', 'graduated', 'withdrawn', 'hiatus', 'retired', 'unknown',
];

/** person_group_memberships の1行 */
export interface MembershipRecord {
  personName: string;
  groupName: string;
  activityStatus: ActivityStatus;
  joinedAt: string | null;
  leftAt: string | null;
  note?: string | null;
}

export type MembershipSource = 'membership' | 'registered' | 'former_list';

export interface ResolvedMembership {
  groupName: string;
  /** null = 状態が登録されていない（registered で activityStatus 未設定、former_list） */
  status: ActivityStatus | null;
  joinedAt?: string;
  leftAt?: string;
  source: MembershipSource;
}

interface PersonLike { name: string; group: string }
interface MetaLike {
  activityStatus?: ActivityStatus;
  joinedAt?: string;
  leftAt?: string;
  formerGroupNames?: string[];
  careerStatus?: CareerStatus;
}

const FORMER_STATUSES = new Set<ActivityStatus>(['graduated', 'withdrawn', 'retired']);

export function isValidMembershipStatus(v: unknown): v is ActivityStatus {
  return typeof v === 'string' && (MEMBERSHIP_STATUSES as readonly string[]).includes(v);
}

/** 卒業・脱退・引退（そのグループの元メンバー） */
export function isFormerStatus(status: ActivityStatus | null | undefined): boolean {
  return !!status && FORMER_STATUSES.has(status);
}

/**
 * そのグループの現在のメンバーか。
 * former_list は元メンバー。registered で状態未設定・unknown は従来の表示（グループページで現役側に数える）に合わせて現在扱い。
 */
export function isCurrentMembership(m: ResolvedMembership): boolean {
  if (m.source === 'former_list') return false;
  return !isFormerStatus(m.status);
}

export function groupMembershipRecords(records: MembershipRecord[]): Map<string, MembershipRecord[]> {
  const map = new Map<string, MembershipRecord[]>();
  for (const r of records) {
    const list = map.get(r.personName);
    if (list) list.push(r);
    else map.set(r.personName, [r]);
  }
  return map;
}

function compareRecords(a: MembershipRecord, b: MembershipRecord): number {
  // 現在の所属 → 過去の所属。同じ区分の中は加入日の新しい順（不明は後ろ）→ グループ名
  const ca = isFormerStatus(a.activityStatus) ? 1 : 0;
  const cb = isFormerStatus(b.activityStatus) ? 1 : 0;
  if (ca !== cb) return ca - cb;
  const ja = a.joinedAt ?? '';
  const jb = b.joinedAt ?? '';
  if (ja !== jb) return ja < jb ? 1 : -1;
  return a.groupName.localeCompare(b.groupName, 'ja');
}

export function resolvePersonMemberships(
  person: PersonLike,
  meta: MetaLike | undefined,
  records: MembershipRecord[] | undefined,
): ResolvedMembership[] {
  const result: ResolvedMembership[] = [];
  const covered = new Set<string>();

  for (const r of [...(records ?? [])].sort(compareRecords)) {
    if (!r.groupName || covered.has(r.groupName)) continue;
    covered.add(r.groupName);
    result.push({
      groupName: r.groupName,
      status: r.activityStatus,
      ...(r.joinedAt ? { joinedAt: r.joinedAt } : {}),
      ...(r.leftAt ? { leftAt: r.leftAt } : {}),
      source: 'membership',
    });
  }

  const registered = person.group?.trim();
  if (registered && !covered.has(registered)) {
    covered.add(registered);
    result.push({
      groupName: registered,
      status: meta?.activityStatus ?? null,
      ...(meta?.joinedAt ? { joinedAt: meta.joinedAt } : {}),
      ...(meta?.leftAt ? { leftAt: meta.leftAt } : {}),
      source: 'registered',
    });
  }

  for (const g of meta?.formerGroupNames ?? []) {
    const name = g.trim();
    if (!name || covered.has(name)) continue;
    covered.add(name);
    result.push({ groupName: name, status: null, source: 'former_list' });
  }

  return result;
}

export function hasExplicitMemberships(records: MembershipRecord[] | undefined): boolean {
  return (records?.length ?? 0) > 0;
}

export function currentMemberships(ms: ResolvedMembership[]): ResolvedMembership[] {
  return ms.filter(isCurrentMembership);
}

export function pastMemberships(ms: ResolvedMembership[]): ResolvedMembership[] {
  return ms.filter((m) => !isCurrentMembership(m));
}

/**
 * 表示の代表グループ（タイトル・パンくず・ヒーロー背景）。
 * 所属履歴の行がある人物は現在の所属を優先し、無ければ従来どおり persons.group。
 */
export function displayGroupOf(
  person: PersonLike,
  records: MembershipRecord[] | undefined,
): string {
  if (hasExplicitMemberships(records)) {
    const current = [...records!].sort(compareRecords).find((r) => !isFormerStatus(r.activityStatus));
    if (current) return current.groupName;
  }
  return person.group ?? '';
}

/**
 * グループ G に所属（現在・過去）する人物か（former_list は含めない）。
 * persons.group が G、または所属履歴の行に G がある。
 */
export function isMemberOfGroup(
  person: PersonLike,
  groupName: string,
  records: MembershipRecord[] | undefined,
): boolean {
  if (!groupName) return false;
  if (person.group === groupName) return true;
  return (records ?? []).some((r) => r.groupName === groupName);
}

/** グループ G の所属者（現在・過去。former_list は含めない）。persons の並び順を保つ */
export function personsInGroup<P extends PersonLike>(
  groupName: string,
  persons: P[],
  recordsByPerson: Map<string, MembershipRecord[]>,
): P[] {
  return persons.filter((p) => isMemberOfGroup(p, groupName, recordsByPerson.get(p.name)));
}

/**
 * 公開グループ一覧の名前（トップ・検索・サイトマップ・関連グループ）。
 * persons.group の重複なし一覧（従来の並び）に、所属履歴の行にだけ出てくるグループを続ける。
 * 行は表示対象の人物（persons）のものだけを使う（未公開人物だけのグループは出さない）。
 */
export function listGroupNames(
  persons: PersonLike[],
  recordsByPerson: Map<string, MembershipRecord[]>,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of persons) {
    if (p.group && !seen.has(p.group)) { seen.add(p.group); names.push(p.group); }
  }
  for (const p of persons) {
    for (const r of recordsByPerson.get(p.name) ?? []) {
      if (r.groupName && !seen.has(r.groupName)) { seen.add(r.groupName); names.push(r.groupName); }
    }
  }
  return names;
}

/** 人物が所属するグループ名（現在・過去。検索の一致判定用。former_list は含めない） */
export function membershipGroupNames(
  person: PersonLike,
  records: MembershipRecord[] | undefined,
): string[] {
  const names = new Set<string>();
  if (person.group) names.add(person.group);
  for (const r of records ?? []) if (r.groupName) names.add(r.groupName);
  return [...names];
}

export interface GroupRosterEntry<P> {
  person: P;
  membership: ResolvedMembership;
}

/**
 * グループ G の所属者一覧（グループページ・検索のメンバー数）。
 * members: 所属履歴の行 or persons.group で G に所属する人物（その所属の状態付き）
 * formerFromList: formerGroupNames にだけ G がある人物（従来の「他グループから来た元メンバー」）
 */
export function buildGroupRoster<P extends PersonLike>(
  groupName: string,
  persons: P[],
  metaMap: Record<string, MetaLike | undefined>,
  recordsByPerson: Map<string, MembershipRecord[]>,
): { members: GroupRosterEntry<P>[]; formerFromList: GroupRosterEntry<P>[] } {
  const members: GroupRosterEntry<P>[] = [];
  const formerFromList: GroupRosterEntry<P>[] = [];
  for (const p of persons) {
    const ms = resolvePersonMemberships(p, metaMap[p.name], recordsByPerson.get(p.name));
    const m = ms.find((x) => x.groupName === groupName);
    if (!m) continue;
    if (m.source === 'former_list') formerFromList.push({ person: p, membership: m });
    else members.push({ person: p, membership: m });
  }
  return { members, formerFromList };
}

const CAREER_LABEL: Record<CareerStatus, string> = {
  active: '活動中',
  inactive: '活動休止',
  retired: '引退',
  deceased: '故人',
  unknown: '不明',
};

/**
 * 芸能活動全体の状態ラベル（所属ごとの状態とは別）。
 * careerStatus が登録されていればそれを使い、無ければ現在の所属（現役）がある場合だけ「活動中」。
 * どちらも無ければ null（推測しない）。
 */
export function careerStatusLabel(
  careerStatus: CareerStatus | undefined,
  ms: ResolvedMembership[],
): string | null {
  if (careerStatus && careerStatus !== 'unknown') return CAREER_LABEL[careerStatus];
  if (ms.some((m) => m.source === 'membership' && m.status === 'active')) return CAREER_LABEL.active;
  return null;
}

/**
 * 所属履歴の行の更新後に person_meta の旧フィールドへ反映する値。
 * 旧フィールド（activityStatus / joinedAt / leftAt）は persons.group についての値のため、persons.group の所属行が
 * あればその状態・日付を反映する（日付は空なら変更しない＝既存の値を消さない）。
 * currentGroupName は反映しない（商品の自動判定〔product-membership-guard〕が currentGroupName を
 * 「脱退したグループ」として扱うため、移籍先を入れると商品判定が変わってしまう）。
 * 返り値に含まれないフィールドは変更しない。
 */
export function legacyMetaMirror(
  person: PersonLike,
  records: MembershipRecord[],
): { activityStatus?: ActivityStatus; joinedAt?: string; leftAt?: string } {
  const out: { activityStatus?: ActivityStatus; joinedAt?: string; leftAt?: string } = {};
  const reg = records.find((r) => r.groupName === person.group);
  if (reg) {
    out.activityStatus = reg.activityStatus;
    if (reg.joinedAt) out.joinedAt = reg.joinedAt;
    if (reg.leftAt) out.leftAt = reg.leftAt;
  }
  return out;
}

/** 所属の加入日・脱退日として受け付ける形式（YYYY / YYYY-MM / YYYY-MM-DD） */
export function isValidMembershipDate(v: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v);
}

/** 所属編集の入力（API・画面で共通） */
export interface MembershipInputLike {
  groupName: string;
  activityStatus: ActivityStatus;
  joinedAt?: string | null;
  leftAt?: string | null;
  note?: string | null;
}

/** 入力の検証。エラーがあれば日本語のメッセージを返す */
export function validateMembershipInputs(inputs: MembershipInputLike[]): string | null {
  const seen = new Set<string>();
  for (const m of inputs) {
    const g = m.groupName?.trim();
    if (!g) return 'グループ名が空の行があります';
    if (seen.has(g)) return `${g} が重複しています`;
    seen.add(g);
    if (!isValidMembershipStatus(m.activityStatus)) return `${g}：所属状態が不正です`;
    for (const [label, v] of [['加入日', m.joinedAt], ['脱退・卒業日', m.leftAt]] as const) {
      if (v && v.trim() && !isValidMembershipDate(v.trim())) return `${g}：${label}は YYYY-MM-DD / YYYY-MM / YYYY で入力してください`;
    }
    if ((m.activityStatus === 'active' || m.activityStatus === 'hiatus') && m.leftAt?.trim()) {
      return `${g}：現役・休止中の所属に脱退・卒業日は設定できません`;
    }
  }
  return null;
}

