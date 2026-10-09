import { describe, it, expect } from 'vitest';
import {
  buildPickerGroups,
  canSelectWholeGroup,
  isCurrentMemberStatus,
  normalizeSearchText,
  searchPickerSuggestions,
  type OshiVodPickerPerson,
} from '../oshi-vod/picker';

const persons: OshiVodPickerPerson[] = [
  { name: '目黒蓮', group: 'Snow Man', aliases: ['めめ'], isCurrent: true },
  { name: 'ラウール', group: 'Snow Man', aliases: [], isCurrent: true },
  { name: '卒業メンバー', group: 'Snow Man', aliases: [], isCurrent: false },
  { name: '大谷映美里', group: '＝LOVE', aliases: [], isCurrent: true },
  { name: 'ソロ', group: '', aliases: [], isCurrent: true },
];

describe('oshi-vod picker', () => {
  it('現メンバー判定はグループページと同じ（未設定=active・hiatus含む）', () => {
    expect(isCurrentMemberStatus(undefined)).toBe(true);
    expect(isCurrentMemberStatus('active')).toBe(true);
    expect(isCurrentMemberStatus('hiatus')).toBe(true);
    expect(isCurrentMemberStatus('graduated')).toBe(false);
    expect(isCurrentMemberStatus('withdrawn')).toBe(false);
    expect(isCurrentMemberStatus('unknown')).toBe(false);
  });

  it('グループ全員選択は12人以下のみ', () => {
    expect(canSelectWholeGroup(12)).toBe(true);
    expect(canSelectWholeGroup(13)).toBe(false);
    expect(canSelectWholeGroup(0)).toBe(false);
  });

  it('グループ構築（現/元メンバーを分ける・グループなしは除外）', () => {
    const groups = buildPickerGroups(persons);
    expect(groups.map((g) => g.name)).toEqual(['Snow Man', '＝LOVE']);
    expect(groups[0].currentMembers).toEqual(['目黒蓮', 'ラウール']);
    expect(groups[0].formerMembers).toEqual(['卒業メンバー']);
  });

  it('検索: 名前・別名・グループ名（全角半角の表記ゆれを吸収）', () => {
    const groups = buildPickerGroups(persons);
    expect(normalizeSearchText('＝ＬＯＶＥ')).toBe('=love');
    expect(searchPickerSuggestions('=love', persons, groups)[0]).toEqual({ kind: 'group', value: '＝LOVE', sublabel: '1人' });
    expect(searchPickerSuggestions('めめ', persons, groups)).toEqual([{ kind: 'person', value: '目黒蓮', sublabel: 'めめ・Snow Man' }]);
    expect(searchPickerSuggestions('ラウ', persons, groups)[0].value).toBe('ラウール');
    expect(searchPickerSuggestions('', persons, groups)).toEqual([]);
  });
});
