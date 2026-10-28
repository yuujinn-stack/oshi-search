import { describe, expect, it } from 'vitest';
import { checkReadingInput, countScriptStatuses, groupUnresolvedReadings, kanaOnlyAliases, normalizeFirst3Title, first3CandidateExclusion, countWorkBuckets, daysSinceFirst3Check, staleFirst3Works } from '../video-first3-script';

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

describe('normalizeFirst3Title（oshi-video-maker の normalizeFirst3Title と同じ判定）', () => {
  it('表記揺れ・先頭の「劇場版」は同じ作品、語が違えば別作品', () => {
    expect(normalizeFirst3Title('君が トクベツ')).toBe(normalizeFirst3Title('君がトクベツ'));
    expect(normalizeFirst3Title('ＳＰＹ×ＦＡＭＩＬＹ')).toBe(normalizeFirst3Title('spy family'));
    expect(normalizeFirst3Title('リベンジ・スパイ')).toBe(normalizeFirst3Title('リベンジスパイ'));
    expect(normalizeFirst3Title('劇場版 君がトクベツ')).toBe(normalizeFirst3Title('君がトクベツ'));
    expect(normalizeFirst3Title('民王R')).not.toBe(normalizeFirst3Title('民王'));
    expect(normalizeFirst3Title('ヤンキー君と科学ガール')).not.toBe(normalizeFirst3Title('ヤンキー君と科学ガール2'));
    expect(normalizeFirst3Title('記号だけ!?')).not.toBe('');
  });
});

describe('first3CandidateExclusion（oshi-video-maker の orderFirst3Candidates と同じ条件）', () => {
  const c = (kind: string, role: string | null, streaming = true) => first3CandidateExclusion({ kind, role, streaming });
  it('本人出演・ゲスト・配信中でない・役の無いドラマは対象外、それ以外は対象', () => {
    expect(c('映画', 'Self (Naniwa Danshi)')).toBe('本人出演・ゲスト等');
    expect(c('ドラマ', '本人（SixTONES）')).toBe('本人出演・ゲスト等');
    expect(c('ドラマ', '林田裕紀（第1話ゲスト）')).toBe('本人出演・ゲスト等');
    expect(c('ドラマ', null)).toBe('役の表示がないドラマ（音楽・トーク番組等）');
    expect(c('映画', '役名', false)).toBe('配信中ではない');
    expect(c('舞台・ミュージカル', '役名')).toBe('まず見る3作の対象外の種別');
    // 番組・ライブ等（追加の候補）: 本人出演は可、ゲスト等・配信中でないものは不可
    expect(c('ライブ・コンサート', 'Self (Naniwa Danshi)')).toBeNull();
    expect(c('バラエティ', null)).toBeNull();
    expect(c('バラエティ', 'ゲスト')).toBe('ゲスト出演等');
    expect(c('アイドル番組', null, false)).toBe('配信中ではない');
    expect(c('映画', null)).toBeNull();
    expect(c('ドラマ', 'Kouta Kirigaya')).toBeNull();
    expect(c('ドラマ', '神崎幸一（主演）')).toBeNull();
  });
});

describe('countWorkBuckets（作品数ごとの人数）', () => {
  it('3作品以上・2・1・0作品・不明を数える（他テンプレートは数えない）', () => {
    expect(
      countWorkBuckets([
        { personName: 'a', scriptStatus: 'ready_script' },
        { personName: 'b', scriptStatus: 'needs_reading' },
        { personName: 'c', scriptStatus: 'insufficient_works', eligibleCount: 2 },
        { personName: 'd', scriptStatus: 'insufficient_works', eligibleCount: 1 },
        { personName: 'e', scriptStatus: 'insufficient_works', eligibleCount: 0 },
        { personName: 'f', scriptStatus: 'insufficient_works' },
        { personName: 'g', scriptStatus: 'pending' },
        { personName: 'h' },
      ]),
    ).toEqual({ three: 2, two: 1, one: 1, zero: 1, unknown: 2 });
  });
});

describe('daysSinceFirst3Check（配信の確認日からの日数。日本時間）', () => {
  it('作品ページの表記から日数を出す。読めなければnull', () => {
    expect(daysSinceFirst3Check('2026年7月29日', new Date('2026-10-27T03:00:00Z'))).toBe(90);
    expect(daysSinceFirst3Check('2026年10月27日', new Date('2026-10-26T16:00:00Z'))).toBe(0); // 日本時間では10/27
    expect(daysSinceFirst3Check(null)).toBeNull();
    expect(daysSinceFirst3Check('不明')).toBeNull();
  });
});

describe('staleFirst3Works（配信の再確認が必要な作品）', () => {
  it('確認から90日以上の作品だけ（確認日が読めない作品は含めない）', () => {
    const now = new Date('2026-10-28T03:00:00Z');
    expect(
      staleFirst3Works([{ title: 'A', checkedAt: '2026年7月29日' }, { title: 'B', checkedAt: '2026年10月1日' }, { title: 'C', checkedAt: null }], now),
    ).toEqual([{ slot: 1, title: 'A', days: 91 }]);
    expect(staleFirst3Works(null, now)).toEqual([]);
  });
});
