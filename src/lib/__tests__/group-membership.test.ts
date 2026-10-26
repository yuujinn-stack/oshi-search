import { describe, it, expect } from 'vitest';
import {
  buildGroupRoster,
  careerStatusLabel,
  currentMemberships,
  displayGroupOf,
  groupMembershipRecords,
  legacyMetaMirror,
  listGroupNames,
  membershipGroupNames,
  pastMemberships,
  personsInGroup,
  resolvePersonMemberships,
  validateMembershipInputs,
  type MembershipRecord,
} from '@/lib/group-membership';
import { planMembershipCsvRow, type MembershipCsvRow } from '@/lib/group-membership-csv';
import { buildPickerGroups, type OshiVodPickerPerson } from '@/lib/oshi-vod/picker';
import type { ActivityStatus } from '@/types/person';

// 本番データの形（persons.group_name / person_meta）をそのまま再現したもの
type Meta = { activityStatus?: ActivityStatus; joinedAt?: string; leftAt?: string; formerGroupNames?: string[]; careerStatus?: 'active' };
const persons = [
  { name: '永瀬廉', group: 'King & Prince', genre: 'アーティスト' },
  { name: '髙橋海人', group: 'King & Prince', genre: 'アーティスト' },
  { name: '神宮寺勇太', group: 'King & Prince', genre: 'アーティスト' },
  { name: '岸優太', group: 'King & Prince', genre: 'アーティスト' },
  { name: '岩橋玄樹', group: 'King & Prince', genre: 'アーティスト' },
  { name: '平野紫耀', group: 'King & Prince', genre: 'アーティスト' },
  // 所属履歴の行が無い人物（従来どおりの解釈になること）
  { name: '賀喜遥香', group: '乃木坂46', genre: '坂道' },
  { name: '白石麻衣', group: '乃木坂46', genre: '坂道' },
  { name: '森田ひかる', group: '櫻坂46', genre: '坂道' },
  { name: 'IKE', group: 'SPYAIR', genre: 'アーティスト' },
  { name: '松本若菜', group: '', genre: '俳優' },
];
const metas: Record<string, Meta> = {
  永瀬廉: { activityStatus: 'active', joinedAt: '2018-01-17' },
  髙橋海人: { activityStatus: 'active', joinedAt: '2018-01-17' },
  神宮寺勇太: { activityStatus: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2023-05-22' },
  岸優太: { activityStatus: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2023-05-22' },
  岩橋玄樹: { activityStatus: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2021-03-31' },
  平野紫耀: {
    activityStatus: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2023-05-22', careerStatus: 'active',
    formerGroupNames: ['BOYS AND MEN', 'Kin Kan', 'Mr.King vs Mr.Prince', 'Mr.KING', 'King & Prince'],
  },
  賀喜遥香: { activityStatus: 'active' },
  白石麻衣: { activityStatus: 'graduated', leftAt: '2020-10-28', formerGroupNames: ['乃木坂46'] },
  森田ひかる: { activityStatus: 'active', formerGroupNames: ['欅坂46'] },
  IKE: { activityStatus: 'withdrawn', formerGroupNames: ['SPYAIR'] },
};

const rec = (personName: string, groupName: string, activityStatus: ActivityStatus, joinedAt: string | null = null, leftAt: string | null = null): MembershipRecord =>
  ({ personName, groupName, activityStatus, joinedAt, leftAt });

// scripts/group-membership/apply-memberships.ts が登録する行
const records: MembershipRecord[] = [
  rec('平野紫耀', 'King & Prince', 'withdrawn', '2018-01-17', '2023-05-22'),
  rec('神宮寺勇太', 'King & Prince', 'withdrawn', '2018-01-17', '2023-05-22'),
  rec('岸優太', 'King & Prince', 'withdrawn', '2018-01-17', '2023-05-22'),
  rec('岩橋玄樹', 'King & Prince', 'withdrawn', '2018-01-17', '2021-03-31'),
  rec('永瀬廉', 'King & Prince', 'active', '2018-01-17'),
  rec('髙橋海人', 'King & Prince', 'active', '2018-01-17'),
  rec('平野紫耀', 'Number_i', 'active'),
  rec('神宮寺勇太', 'Number_i', 'active'),
  rec('岸優太', 'Number_i', 'active'),
];
const byPerson = groupMembershipRecords(records);
const NUMBER_I = ['平野紫耀', '神宮寺勇太', '岸優太'];

const isActive = (s: ActivityStatus | null) => !s || s === 'active' || s === 'hiatus';
function counts(group: string, recs = byPerson) {
  const { members } = buildGroupRoster(group, persons, metas, recs);
  return {
    active: members.filter((e) => isActive(e.membership.status)).map((e) => e.person.name),
    former: members.filter((e) => !isActive(e.membership.status)).map((e) => e.person.name),
  };
}

describe('グループの所属者（グループページ・検索の人数）', () => {
  it('King & Prince は現役2人・脱退4人', () => {
    const c = counts('King & Prince');
    expect(c.active).toEqual(['永瀬廉', '髙橋海人']);
    expect(c.former.sort()).toEqual(['平野紫耀', '岩橋玄樹', '岸優太', '神宮寺勇太'].sort());
  });

  it('Number_i は現役3人（persons.group は King & Prince のまま）', () => {
    const c = counts('Number_i');
    expect(c.active.sort()).toEqual([...NUMBER_I].sort());
    expect(c.former).toEqual([]);
    expect(personsInGroup('Number_i', persons, byPerson).map((p) => p.name).sort()).toEqual([...NUMBER_I].sort());
  });

  it('所属履歴の行が無いグループは従来（persons.group + activityStatus）と同じ', () => {
    for (const g of ['乃木坂46', '櫻坂46', 'SPYAIR']) {
      const legacy = persons.filter((p) => p.group === g).map((p) => p.name);
      expect(personsInGroup(g, persons, byPerson).map((p) => p.name)).toEqual(legacy);
    }
    expect(counts('乃木坂46')).toEqual({ active: ['賀喜遥香'], former: ['白石麻衣'] });
    // currentGroupName（TOOKAMI）は所属の判定に使わない＝従来どおり SPYAIR の元メンバーのみ
    expect(personsInGroup('TOOKAMI', persons, byPerson)).toEqual([]);
  });

  it('formerGroupNames にだけあるグループは formerFromList（従来の他グループから来た元メンバー）', () => {
    const r = buildGroupRoster('欅坂46', persons, metas, byPerson);
    expect(r.members).toEqual([]);
    expect(r.formerFromList.map((e) => e.person.name)).toEqual(['森田ひかる']);
  });

  it('グループ一覧に所属履歴だけのグループ（Number_i）が加わり、既存の並びは変わらない', () => {
    const legacy = [...new Set(persons.map((p) => p.group).filter(Boolean))];
    const names = listGroupNames(persons, byPerson);
    expect(names.slice(0, legacy.length)).toEqual(legacy);
    expect(names).toEqual([...legacy, 'Number_i']);
    // 行が無ければ従来と同じ
    expect(listGroupNames(persons, new Map())).toEqual(legacy);
  });

  it('同じ所属行が重複して入っていても人数は変わらない', () => {
    const dup = groupMembershipRecords([...records, ...records]);
    expect(counts('Number_i', dup).active).toHaveLength(3);
    expect(counts('King & Prince', dup)).toEqual(counts('King & Prince'));
  });
});

describe('人物の所属（人物ページ）', () => {
  it.each(NUMBER_I)('%s：現在の所属は Number_i、King & Prince は脱退として履歴に残る', (name) => {
    const p = persons.find((x) => x.name === name)!;
    const ms = resolvePersonMemberships(p, metas[name], byPerson.get(name));
    expect(displayGroupOf(p, byPerson.get(name))).toBe('Number_i');
    expect(currentMemberships(ms).map((m) => m.groupName)).toEqual(['Number_i']);
    const kp = pastMemberships(ms).find((m) => m.groupName === 'King & Prince')!;
    expect(kp).toMatchObject({ status: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2023-05-22', source: 'membership' });
    // Number_i の加入日は推測しない
    expect(ms.find((m) => m.groupName === 'Number_i')!.joinedAt).toBeUndefined();
    // 芸能活動全体の状態は「活動中」（脱退は King & Prince との所属だけ）
    expect(careerStatusLabel(undefined, ms)).toBe('活動中');
  });

  it('平野紫耀の前身ユニットは formerGroupNames のまま（グループの所属行にしない）', () => {
    const ms = resolvePersonMemberships(persons[5], metas['平野紫耀'], byPerson.get('平野紫耀'));
    expect(ms.filter((m) => m.source === 'former_list').map((m) => m.groupName))
      .toEqual(['BOYS AND MEN', 'Kin Kan', 'Mr.King vs Mr.Prince', 'Mr.KING']);
    expect(ms.filter((m) => m.groupName === 'King & Prince')).toHaveLength(1);
  });

  it('永瀬廉・髙橋海人は King & Prince の現役', () => {
    for (const name of ['永瀬廉', '髙橋海人']) {
      const p = persons.find((x) => x.name === name)!;
      expect(displayGroupOf(p, byPerson.get(name))).toBe('King & Prince');
      expect(currentMemberships(resolvePersonMemberships(p, metas[name], byPerson.get(name))).map((m) => m.groupName)).toEqual(['King & Prince']);
    }
  });

  it('所属履歴の行が無い人物は従来どおり（persons.group + person_meta）', () => {
    const p = persons.find((x) => x.name === '白石麻衣')!;
    const ms = resolvePersonMemberships(p, metas['白石麻衣'], undefined);
    expect(displayGroupOf(p, undefined)).toBe('乃木坂46');
    expect(ms).toEqual([{ groupName: '乃木坂46', status: 'graduated', leftAt: '2020-10-28', source: 'registered' }]);
    expect(currentMemberships(ms)).toEqual([]);
    // 状態未登録の芸能活動状態は推測しない
    expect(careerStatusLabel(undefined, ms)).toBeNull();
    expect(resolvePersonMemberships(persons[10], undefined, undefined)).toEqual([]);
  });

  it('検索の一致対象に移籍先のグループが入る', () => {
    expect(membershipGroupNames(persons[2], byPerson.get('神宮寺勇太'))).toEqual(['King & Prince', 'Number_i']);
    expect(membershipGroupNames(persons[6], undefined)).toEqual(['乃木坂46']);
  });

  it('person_meta の旧項目へ反映する値：登録グループ（King & Prince）の状態・日付だけ。currentGroupName は変えない', () => {
    // currentGroupName に移籍先を入れると商品の自動判定（product-membership-guard）が変わるため反映しない
    expect(legacyMetaMirror(persons[2], byPerson.get('神宮寺勇太')!)).toEqual({
      activityStatus: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2023-05-22',
    });
    expect(legacyMetaMirror(persons[0], byPerson.get('永瀬廉')!)).toEqual({ activityStatus: 'active', joinedAt: '2018-01-17' });
    // 所属行の日付が空でも旧項目の日付は消さない（返り値に含めない）
    expect(legacyMetaMirror(persons[0], [rec('永瀬廉', 'King & Prince', 'active')])).toEqual({ activityStatus: 'active' });
  });
});

describe('所属情報CSVの再取込（所属履歴がある人物）', () => {
  const plan = (name: string, row: Partial<MembershipCsvRow>, recs = byPerson) =>
    planMembershipCsvRow({
      personGroup: persons.find((p) => p.name === name)!.group,
      records: recs.get(name) ?? [],
      existingFormerGroupNames: metas[name]?.formerGroupNames,
      row: { groupName: '', activityStatus: '', joinedAt: '', leftAt: '', currentGroupName: '', formerGroupNames: '', ...row },
    });

  // King & Prince 時代の古いCSV（脱退前・currentGroupName に King & Prince）
  const oldKpRow = { groupName: 'King & Prince', activityStatus: 'active', joinedAt: '2018-01-17', currentGroupName: 'King & Prince', formerGroupNames: 'Mr.King vs Mr.Prince' };

  it.each(NUMBER_I)('%s：古い King & Prince のCSVを取り込んでも Number_i の現役のまま（脱退を現役に戻さない）', (name) => {
    const p = plan(name, oldKpRow);
    expect(p.upserts).toEqual([]);
    expect(p.conflicts.map((c) => c.field).sort()).toEqual(['activityStatus', 'currentGroupName']);
    // 取り込み後も所属は変わらない
    expect(counts('Number_i').active).toContain(name);
    expect(counts('King & Prince').former).toContain(name);
  });

  it('formerGroupNames は既存と合わせる（消さない）。現役のグループは旧所属に追加しない', () => {
    const p = plan('平野紫耀', { formerGroupNames: 'Number_i, Johnny\'s Jr.' });
    expect(p.formerGroupNames).toEqual(['BOYS AND MEN', 'Kin Kan', 'Mr.King vs Mr.Prince', 'Mr.KING', 'King & Prince', "Johnny's Jr."]);
    expect(p.conflicts).toEqual([expect.objectContaining({ field: 'formerGroupNames', groupName: 'Number_i' })]);
  });

  it('現在のCSV（脱退・同じ日付）は変更なし＝何度取り込んでも同じ', () => {
    const p = plan('岸優太', { groupName: 'King & Prince', activityStatus: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2023-05-22', currentGroupName: 'Number_i' });
    expect(p).toEqual({ upserts: [], conflicts: [], notes: [] });
  });

  it('空欄は既存の値を消さない。既存と異なる日付は上書きせず競合にする', () => {
    expect(plan('岩橋玄樹', { groupName: 'King & Prince' })).toEqual({ upserts: [], conflicts: [], notes: [] });
    const p = plan('岩橋玄樹', { groupName: 'King & Prince', leftAt: '2021-03' });
    expect(p.upserts).toEqual([]);
    expect(p.conflicts).toEqual([expect.objectContaining({ field: 'leftAt', existing: '2021-03-31', incoming: '2021-03' })]);
  });

  it('既存が空（NULL）の項目だけ埋める。2回目は変更なし', () => {
    const p1 = plan('神宮寺勇太', { groupName: 'Number_i', activityStatus: 'active', joinedAt: '2023-10-15' });
    expect(p1.upserts).toEqual([{ groupName: 'Number_i', activityStatus: 'active', joinedAt: '2023-10-15', leftAt: null, note: null }]);
    const after = groupMembershipRecords(records.map((r) =>
      r.personName === '神宮寺勇太' && r.groupName === 'Number_i' ? { ...r, joinedAt: '2023-10-15' } : r));
    expect(plan('神宮寺勇太', { groupName: 'Number_i', activityStatus: 'active', joinedAt: '2023-10-15' }, after).upserts).toEqual([]);
  });

  it('currentGroupName に所属履歴の無いグループが書かれていても所属行は作らない（確認待ち）', () => {
    const p = plan('永瀬廉', { currentGroupName: 'SixTONES' });
    expect(p.upserts).toEqual([]);
    expect(p.conflicts).toEqual([expect.objectContaining({ field: 'currentGroupName', groupName: 'SixTONES' })]);
  });

  it('現役の所属に脱退日は設定しない', () => {
    const p = plan('永瀬廉', { groupName: 'King & Prince', leftAt: '2030-01-01' });
    expect(p.upserts).toEqual([]);
    expect(p.conflicts[0]).toMatchObject({ field: 'leftAt', reason: '現役の所属に脱退日は設定しない' });
  });
});

describe('サブスク診断の人物選択（グループ分け）', () => {
  it('所属履歴がある人物は移籍先の現メンバー・元のグループの元メンバーの両方に入る', () => {
    const pickerPersons: OshiVodPickerPerson[] = [
      { name: '永瀬廉', group: 'King & Prince', aliases: [], isCurrent: true, memberships: [{ group: 'King & Prince', isCurrent: true }] },
      { name: '平野紫耀', group: 'Number_i', aliases: [], isCurrent: true, memberships: [{ group: 'Number_i', isCurrent: true }, { group: 'King & Prince', isCurrent: false }] },
      { name: '賀喜遥香', group: '乃木坂46', aliases: [], isCurrent: true },
    ];
    expect(buildPickerGroups(pickerPersons)).toEqual([
      { name: 'King & Prince', currentMembers: ['永瀬廉'], formerMembers: ['平野紫耀'] },
      { name: 'Number_i', currentMembers: ['平野紫耀'], formerMembers: [] },
      { name: '乃木坂46', currentMembers: ['賀喜遥香'], formerMembers: [] },
    ]);
  });
});

describe('所属編集の入力チェック', () => {
  it('不正な入力を拒否する', () => {
    expect(validateMembershipInputs([{ groupName: 'Number_i', activityStatus: 'active' }])).toBeNull();
    expect(validateMembershipInputs([{ groupName: 'King & Prince', activityStatus: 'withdrawn', joinedAt: '2018-01-17', leftAt: '2023-05-22' }])).toBeNull();
    expect(validateMembershipInputs([{ groupName: '', activityStatus: 'active' }])).toMatch(/空/);
    expect(validateMembershipInputs([{ groupName: 'A', activityStatus: 'active' }, { groupName: 'A', activityStatus: 'withdrawn' }])).toMatch(/重複/);
    expect(validateMembershipInputs([{ groupName: 'A', activityStatus: 'active', leftAt: '2023-05-22' }])).toMatch(/設定できません/);
    expect(validateMembershipInputs([{ groupName: 'A', activityStatus: 'withdrawn', leftAt: '2023/05/22' }])).toMatch(/YYYY/);
    expect(validateMembershipInputs([{ groupName: 'A', activityStatus: 'bogus' as ActivityStatus }])).toMatch(/不正/);
  });
});
