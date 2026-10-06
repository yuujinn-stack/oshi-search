import { describe, expect, it } from 'vitest';
import { checkReadingInput, countScriptStatuses, groupUnresolvedReadings, kanaOnlyAliases } from '../video-first3-script';

describe('まず見る3作の台本準備（管理画面）', () => {
  it('同じ未登録語が複数人物にあっても1件にまとめ、使用人物を集める', () => {
    const groups = groupUnresolvedReadings([
      { personName: '目黒蓮', unresolvedReadings: [{ kind: 'work', text: '海のはじまり' }] },
      { personName: 'A', unresolvedReadings: [{ kind: 'work', text: '海のはじまり' }, { kind: 'work', text: 'ウソ婚' }] },
      { personName: 'B', unresolvedReadings: [{ kind: 'work', text: 'ウソ婚' }, { kind: 'work', text: 'ウソ婚' }] },
      { personName: 'C', unresolvedReadings: [{ kind: 'work', text: '海のはじまり' }] },
      { personName: 'D' },
    ]);
    expect(groups.map((g) => g.text)).toEqual(['海のはじまり', 'ウソ婚']);
    expect(groups[0].persons).toEqual(['目黒蓮', 'A', 'C']);
    expect(groups[1].persons).toEqual(['A', 'B']);
  });

  it('台本の準備状態を数える（scriptStatusの無い他テンプレートの報告は数えない）', () => {
    const c = countScriptStatuses([
      { personName: 'a', scriptStatus: 'ready_script' },
      { personName: 'b', scriptStatus: 'needs_reading' },
      { personName: 'c', scriptStatus: 'needs_reading' },
      { personName: 'd', scriptStatus: 'insufficient_works' },
      { personName: 'e' },
    ]);
    expect(c).toEqual({ all: 4, ready_script: 1, needs_reading: 2, insufficient_works: 1, pending: 0, error: 0 });
  });

  it('読みはひらがな・カタカナだけ受け付ける（漢字・英字・数字は不可）', () => {
    expect(checkReadingInput('海のはじまり', ' うみの  はじまり ')).toEqual({ ok: true, sourceText: '海のはじまり', reading: 'うみの はじまり' });
    expect(checkReadingInput('Gメン', 'ジーメン').ok).toBe(true);
    expect(checkReadingInput('Gメン', 'Gめん').ok).toBe(false);
    expect(checkReadingInput('10回切って', '10かい').ok).toBe(false);
    expect(checkReadingInput('海', '海').ok).toBe(false);
    expect(checkReadingInput('', 'うみ').ok).toBe(false);
  });

  it('人物名の読みの候補は別名のうちひらがな・カタカナだけ（愛称も混ざるため候補止まり。英字・漢字は除く）', () => {
    expect(kanaOnlyAliases([['まつだいらりこ', 'りこぴ', 'Riko', '松平'], ['りこぴ'], null])).toEqual(['まつだいらりこ', 'りこぴ']);
  });
});
