import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import reports from './fixtures/media-script-reports.json';
import MediaReelPicker from '@/app/admin/video-maker/MediaReelPicker';
import { parseMediaScriptReport, renderMediaScript, resolveMediaGroupReading } from '@/lib/video-media-reel';

// 推しサーチ総合紹介動画のグループ版（OSHI_GROUP_05・OSHI_GROUP_10）のグループ名の読み。
// 2026-11-09: Aぇ! group の読みが管理画面（読み未登録→表記のまま）と Worker（辞書の誤った読み）で食い違い、正しい CapCut 音声が拒否された。
// 管理画面も Worker と同じ順番（登録した読み → 固定辞書 → Worker のグループ名の辞書）で読みを決め、読みを登録できるようにした。
const groups = [
  { name: 'Aぇ! group', members: ['小島健'] },
  { name: 'M!LK', members: ['佐野勇斗'] },
  { name: 'モナキ', members: ['メンバー'] },
  { name: '超特急', members: ['リョウガ'] },
];
const withDict = (i: number, groupReadings: unknown) => ({ ...(reports[i] as Record<string, unknown>), groupReadings });

describe('parseMediaScriptReport: Worker のグループ名の読み辞書', () => {
  it('グループ版は読み辞書を受け取る（読みとして使えない値は捨てる）。古い Worker（辞書なし）は空', () => {
    const r = parseMediaScriptReport(withDict(4, { 'Aぇ! group': 'ええグループ', 超特急: 'ちょうとっきゅう', 悪い: 'abc', 数字: 46 }))!;
    expect(r.groupReadings).toEqual({ 'Aぇ! group': 'ええグループ', 超特急: 'ちょうとっきゅう' });
    expect(parseMediaScriptReport(reports[4])!.groupReadings).toEqual({});
    expect(parseMediaScriptReport(withDict(0, { x: 'えっくす' }))!.groupReadings).toEqual({});
  });
});

describe('resolveMediaGroupReading（Worker と同じ順番）', () => {
  const dict = { 'Aぇ! group': 'ええグループ', 'M!LK': 'みるく' };
  it('登録した読み → 固定辞書 → グループ名の辞書 → かなだけの名前 → なし', () => {
    expect(resolveMediaGroupReading('Aぇ! group', { registered: { 'Aぇ! group': 'えーぐるーぷ' }, groupReadings: dict })).toEqual({ reading: 'えーぐるーぷ', source: 'registered' });
    expect(resolveMediaGroupReading('M!LK', { registered: {}, fixed: { 'M!LK': 'ミルク' }, groupReadings: dict })).toEqual({ reading: 'ミルク', source: 'fixed' });
    expect(resolveMediaGroupReading('Aぇ! group', { registered: null, groupReadings: dict })).toEqual({ reading: 'ええグループ', source: 'dictionary' });
    expect(resolveMediaGroupReading('モナキ', {})).toEqual({ reading: 'モナキ', source: 'kana' });
    expect(resolveMediaGroupReading('超特急', { registered: {} })).toBeNull();
    expect(resolveMediaGroupReading('  ', {})).toBeNull();
  });

  it('読み台本: Aぇ! group は「ええグループ」で、表示の台本はグループ名のまま（OSHI_GROUP_05・10）', () => {
    for (const i of [4, 9]) {
      const r = parseMediaScriptReport(withDict(i, dict))!;
      const p = renderMediaScript(r, 'Aぇ! group', resolveMediaGroupReading('Aぇ! group', { groupReadings: r.groupReadings })!.reading);
      expect(p.kanaText).toContain('ええグループおし');
      expect(p.kanaText).not.toContain('Aぇ! group');
      expect(p.scriptText).toContain('Aぇ! group推し');
      expect(p.groupReadingMissing).toBe(false);
    }
  });
});

describe('MediaReelPicker: グループ名の読みの表示・登録欄', () => {
  const html = (i: number, groupName: string | null, report: unknown = reports[i]) =>
    renderToStaticMarkup(<MediaReelPicker mediaScript={report} groups={groups} fixedReadings={{}} value={{ groupName }} onChange={() => {}} />);

  it('グループを選ぶと読みの欄を出す（OSHI_GROUP_05・10）。未選択・一般版では出さない', () => {
    for (const i of [4, 9]) {
      const h = html(i, 'Aぇ! group', withDict(i, { 'Aぇ! group': 'ええグループ' }));
      expect(h).toContain('vm-media-group-reading');
      expect(h).toContain('グループ名の読み');
      // 登録した読みを読み込むまでは「読み込み中」（登録した読みが辞書より優先されるため、確定表示は読み込み後）
      expect(h).toContain('登録済みの読みを読み込み中');
      expect(h).toContain('ええグループおし');
      expect(h).toContain('読みを登録');
      expect(html(i, null)).not.toContain('vm-media-group-reading');
    }
    expect(html(0, null)).not.toContain('vm-media-group-reading');
  });

  it('読みが分からないグループは未登録と表示し、読み台本の注意で登録を案内する', () => {
    const h = html(4, '超特急');
    expect(h).toContain('vm-media-group-reading');
    expect(h).toContain('読みが未登録のため');
  });
});
