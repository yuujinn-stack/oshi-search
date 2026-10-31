import { describe, expect, it } from 'vitest';
import {
  buildSonkamoLines,
  buildSonkamoTitle,
  checkSonkamoLines,
  parseSonkamoScriptTemplate,
  resolveSonkamoNameKana,
} from '../video-sonkamo-script';
import { getInstagramCaption } from '../video-instagram-caption';

// Worker（oshi-video-maker の buildSonkamoScriptTemplateReport）が送る雛形と同じ形
const REPORT = {
  version: 1,
  nameToken: '{name}',
  nameKanaToken: '{nameKana}',
  moraPerSecond: 10,
  honorifics: ['', 'くん', 'ちゃん', 'さん'],
  lines: [
    { id: '01-hook', slotSeconds: 2.9, person: { text: '{name}推してる人！このサイト使ってないの、損かも！', kana: '{nameKana}おしてるひと！このさいとつかってないの、そんかも！' }, group: { text: '{name}推してる人！このサイト使ってないの、損かも！', kana: '{nameKana}おしてるひと！このさいとつかってないの、そんかも！' } },
    { id: '02-works', slotSeconds: 2.9, person: { text: '出演作品が、まとめて探せて、', kana: 'しゅつえんさくひんが、まとめてさがせて、' }, group: { text: 'メンバーの出演作品が、まとめて探せて、', kana: 'メンバーのしゅつえんさくひんが、まとめてさがせて、' } },
  ],
  fixedReadings: { 目黒蓮: 'めぐろれん' },
};

describe('推し活で損してるかも？の原稿（管理画面）', () => {
  it('Worker の雛形を受け取り、形が違えば null', () => {
    expect(parseSonkamoScriptTemplate(REPORT)?.lines).toHaveLength(2);
    expect(parseSonkamoScriptTemplate({ ...REPORT, version: 2 })).toBeNull();
    expect(parseSonkamoScriptTemplate({ ...REPORT, lines: [{ id: 'x' }] })).toBeNull();
    expect(parseSonkamoScriptTemplate(null)).toBeNull();
  });

  it('名前の読み: 固定辞書 → 登録読み → ひらがな・カタカナの名前。無ければ null（推測しない）', () => {
    const t = parseSonkamoScriptTemplate(REPORT)!;
    expect(resolveSonkamoNameKana('目黒蓮', t, { 目黒蓮: 'ちがう' })).toEqual({ kana: 'めぐろれん', source: 'fixed' });
    expect(resolveSonkamoNameKana('M!LK', t, { 'M!LK': 'みるく' })).toEqual({ kana: 'みるく', source: 'registered' });
    expect(resolveSonkamoNameKana('モナキ', t, {})).toEqual({ kana: 'モナキ', source: 'kana' });
    expect(resolveSonkamoNameKana('M!LK', t, {})).toBeNull();
  });

  it('原稿: グループは「メンバーの」、人物は敬称つき。読み未登録は読みに表示名が残り、警告になる', () => {
    const t = parseSonkamoScriptTemplate(REPORT)!;
    const g = buildSonkamoLines(t, 'group', 'M!LK', 'みるく', '');
    expect(g.map((l) => l.text)).toEqual(['M!LK推してる人！このサイト使ってないの、損かも！', 'メンバーの出演作品が、まとめて探せて、']);
    expect(g[0].kana).toBe('みるくおしてるひと！このさいとつかってないの、そんかも！');
    expect(checkSonkamoLines(t, g).every((c) => !c.overlong && c.nonReadable.length === 0)).toBe(true);
    const p = buildSonkamoLines(t, 'person', '佐野勇斗', 'さのはやと', 'くん');
    expect(p[0].text).toBe('佐野勇斗くん推してる人！このサイト使ってないの、損かも！');
    expect(p[1].text).toBe('出演作品が、まとめて探せて、');
    const unknown = buildSonkamoLines(t, 'group', 'M!LK', null, '');
    expect(checkSonkamoLines(t, unknown)[0].nonReadable).toEqual(['M', 'LK']);
  });

  it('長すぎる文を見積もりで検出する', () => {
    const t = parseSonkamoScriptTemplate(REPORT)!;
    const long = buildSonkamoLines(t, 'group', '長い', 'ながいながいながいながいなまえのぐるーぷ', '');
    expect(checkSonkamoLines(t, long)[0].overlong).toBe(true);
  });

  it('タイトルと Instagram 投稿文（記号を含む名前はハッシュタグにしない）', () => {
    expect(buildSonkamoTitle('M!LK')).toBe('M!LK推し、これ知らないと損かも？');
    const caption = getInstagramCaption('oshi-sonkamo-v1', { name: 'M!LK', groupName: null })!;
    expect(caption.startsWith('M!LK推し、これ知らないと損かも？')).toBe(true);
    expect(caption).toContain('#推しサーチ');
    expect(caption).not.toContain('#M');
    expect(getInstagramCaption('oshi-sonkamo-v1', { name: '佐野勇斗', groupName: 'M!LK' })).toContain('#佐野勇斗');
  });
});
