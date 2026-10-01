import { describe, it, expect } from 'vitest';
import {
  GROUP_ALL, GROUP_NONE, isCurrentMember, isFormerMember, isAffiliated, buildGroupOptions, filterPersons, selectAllMatching,
} from '@/lib/person-group-filter';
import type { PersonOption } from '@/components/admin/PersonCombobox';

// 実データにある所属情報の形をそのまま再現したもの
const persons: PersonOption[] = [
  // 現役（currentGroupName あり・active）
  { name: '賀喜遥香', group: '乃木坂46', currentGroupName: '乃木坂46', activityStatus: 'active' },
  { name: '井上和', group: '乃木坂46', currentGroupName: '乃木坂46', activityStatus: 'active' },
  // 卒業（currentGroupName 空・graduated・過去Gに乃木坂46）
  { name: '白石麻衣', group: '乃木坂46', activityStatus: 'graduated', formerGroupNames: ['乃木坂46'] },
  // 卒業だが currentGroupName が残っている（データの不整合）
  { name: '久保史緒里', group: '乃木坂46', currentGroupName: '乃木坂46', activityStatus: 'graduated', formerGroupNames: ['乃木坂46'] },
  { name: '吉田綾乃クリスティー', group: '乃木坂46', currentGroupName: '乃木坂46', activityStatus: 'graduated' },
  // 改名前グループの元メンバー（現・櫻坂46）
  { name: '森田ひかる', group: '櫻坂46', currentGroupName: '櫻坂46', activityStatus: 'active', formerGroupNames: ['欅坂46'] },
  // currentGroupName が未入力の現役グループ（Snow Man 等）
  { name: '目黒蓮', group: 'Snow Man', activityStatus: 'active' },
  // 別グループへ移った人物（登録はSPYAIR・現在はTOOKAMI・SPYAIRは脱退）
  { name: 'IKE', group: 'SPYAIR', currentGroupName: 'TOOKAMI', activityStatus: 'withdrawn', formerGroupNames: ['SPYAIR'] },
  // 活動休止（卒業扱いにしない）
  { name: '休止メンバー', group: '乃木坂46', currentGroupName: '乃木坂46', activityStatus: 'hiatus' },
  // グループなし（俳優など）
  { name: '松本若菜', activityStatus: 'unknown' },
  { name: '北川景子' },
];
const names = (ps: PersonOption[]) => ps.map((p) => p.name);

describe('現役・卒業（元メンバー）の判定（person_meta の所属データだけを使う）', () => {
  it('currentGroupName が乃木坂46・active は現役', () => {
    expect(isCurrentMember(persons[0], '乃木坂46')).toBe(true);
  });
  it('卒業（graduated・過去Gに乃木坂46）は元メンバー', () => {
    expect(isCurrentMember(persons[2], '乃木坂46')).toBe(false);
    expect(isFormerMember(persons[2], '乃木坂46')).toBe(true);
  });
  it('currentGroupName が残っていても graduated なら元メンバー（卒業側の情報を優先）', () => {
    expect(isCurrentMember(persons[3], '乃木坂46')).toBe(false);
    expect(isCurrentMember(persons[4], '乃木坂46')).toBe(false);
    expect(isAffiliated(persons[4], '乃木坂46')).toBe(true);
  });
  it('改名前のグループ（欅坂46）は元メンバー、現グループ（櫻坂46）では現役', () => {
    expect(isCurrentMember(persons[5], '欅坂46')).toBe(false);
    expect(isAffiliated(persons[5], '欅坂46')).toBe(true);
    expect(isCurrentMember(persons[5], '櫻坂46')).toBe(true);
  });
  it('currentGroupName が未入力でも、登録グループが Snow Man・active なら現役', () => {
    expect(isCurrentMember(persons[6], 'Snow Man')).toBe(true);
  });
  it('別グループへ移った人物：移籍先では現役、元のグループでは元メンバー', () => {
    expect(isCurrentMember(persons[7], 'TOOKAMI')).toBe(true);
    expect(isCurrentMember(persons[7], 'SPYAIR')).toBe(false);
    expect(isAffiliated(persons[7], 'SPYAIR')).toBe(true);
  });
  it('活動休止（hiatus）は卒業扱いにしない', () => {
    expect(isCurrentMember(persons[8], '乃木坂46')).toBe(true);
  });
});

describe('グループの候補（人物データから作る）', () => {
  it('過去の所属グループも候補に入り、現役人数と全体人数を持つ。グループなしは最後', () => {
    const opts = buildGroupOptions(persons);
    expect(opts.find((o) => o.value === '乃木坂46')).toMatchObject({ currentCount: 3, allCount: 6 });
    expect(opts.find((o) => o.value === '欅坂46')).toMatchObject({ currentCount: 0, allCount: 1 });
    expect(opts.find((o) => o.value === 'Snow Man')).toMatchObject({ currentCount: 1, allCount: 1 });
    expect(opts.at(-1)).toMatchObject({ value: GROUP_NONE, label: 'グループなし', allCount: 2 });
  });
});

describe('絞り込み（グループ＋現役/元メンバー＋検索）', () => {
  it('乃木坂46・現役のみ（既定）', () => {
    expect(names(filterPersons(persons, '乃木坂46', ''))).toEqual(['賀喜遥香', '井上和', '休止メンバー']);
  });
  it('乃木坂46・卒業・元メンバーも含む', () => {
    expect(names(filterPersons(persons, '乃木坂46', '', true))).toEqual(['賀喜遥香', '井上和', '白石麻衣', '久保史緒里', '吉田綾乃クリスティー', '休止メンバー']);
  });
  it('グループ＋検索：現役のみでは「白石」は0人、含むONなら白石麻衣', () => {
    expect(names(filterPersons(persons, '乃木坂46', '白石'))).toEqual([]);
    expect(names(filterPersons(persons, '乃木坂46', '白石', true))).toEqual(['白石麻衣']);
  });
  it('「すべて」は全員（グループなしの人物も消えない）', () => {
    expect(filterPersons(persons, GROUP_ALL, '')).toHaveLength(persons.length);
    expect(names(filterPersons(persons, GROUP_ALL, '松本'))).toEqual(['松本若菜']);
  });
  it('グループなし', () => {
    expect(names(filterPersons(persons, GROUP_NONE, ''))).toEqual(['松本若菜', '北川景子']);
  });
});

describe('表示中をすべて選択（選択済みは維持）', () => {
  it('現役だけ一括選択 → 元メンバー込みに切り替えて追加 → 現役のみに戻しても選択は残る', () => {
    const step1 = selectAllMatching([], filterPersons(persons, '乃木坂46', '')).next;
    expect(step1).toEqual(['賀喜遥香', '井上和', '休止メンバー']);
    const step2 = selectAllMatching(step1, filterPersons(persons, '乃木坂46', '', true)).next;
    expect(step2).toEqual(['賀喜遥香', '井上和', '休止メンバー', '白石麻衣', '久保史緒里', '吉田綾乃クリスティー']);
    // 絞り込みを現役のみに戻しても、selectAllMatching は選択を解除しない（選択状態は呼び出し側が保持）
    expect(selectAllMatching(step2, filterPersons(persons, '乃木坂46', '')).next).toEqual(step2);
  });
  it('別グループへ移って追加しても、先に選んだ人物はそのまま', () => {
    const r = selectAllMatching(['賀喜遥香'], filterPersons(persons, 'Snow Man', ''));
    expect(r.next).toEqual(['賀喜遥香', '目黒蓮']);
  });
  it('上限（1週間分の人数など）を超えない', () => {
    const r = selectAllMatching(['目黒蓮'], filterPersons(persons, '乃木坂46', '', true), 3);
    expect(r).toMatchObject({ next: ['目黒蓮', '賀喜遥香', '井上和'], added: 2, skipped: 4 });
  });
});
