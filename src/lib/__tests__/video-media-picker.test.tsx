import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import reports from './fixtures/media-script-reports.json';
import MediaReelPicker, { EMPTY_MEDIA_PICK, effectiveMediaGroup, mediaPickReady, mediaTemplateInput } from '@/app/admin/video-maker/MediaReelPicker';
import { parseMediaScriptReport } from '@/lib/video-media-reel';

// 管理画面「推しサーチ総合紹介動画（10種類）」の台本表示・グループ選択（Worker の実際の報告で描画する）
const groups = [
  { name: 'M!LK', members: ['佐野勇斗'] },
  { name: 'Snow Man', members: ['目黒蓮'] },
];
const html = (i: number, groupName: string | null = null, readings: Record<string, string> = {}) =>
  renderToStaticMarkup(<MediaReelPicker mediaScript={reports[i]} groups={groups} fixedReadings={readings} value={{ groupName }} onChange={() => {}} />);

describe('MediaReelPicker', () => {
  it('No.1: 台本（字幕・画面の文字）と読み台本を表示し、コピーできる。グループ欄は出さない', () => {
    const h = html(0);
    expect(h).toContain('推し活してる人のために、神サイト作りました！');
    expect(h).toContain('おしかつしてるひとのために');
    expect(h).toContain('台本をコピー');
    expect(h).toContain('読み台本をコピー');
    expect(h).not.toContain('vm-media-group');
  });

  it('グループ版: 最初は未選択（例の M!LK を自動で選ばない）。選んだグループで台本が変わる', () => {
    const n = html(4, null, { 'M!LK': 'みるく' });
    expect(n).toContain('vm-media-group');
    expect(n).toContain('クリックしてグループを選ぶ');
    expect(n).not.toContain('M!LK推しの人');
    expect(n).toContain('グループが未選択のため生成できません');
    const h = html(4, 'M!LK', { 'M!LK': 'みるく' });
    expect(h).toContain('M!LK推しの人、このサイトもう使ってる？');
    expect(h).toContain('みるくおしのひと');
    const s = html(4, 'Snow Man', { 'Snow Man': 'すのーまん' });
    expect(s).toContain('Snow Man推しの人、このサイトもう使ってる？');
    expect(s).toContain('すのーまんおしのひと');
    expect(s).not.toContain('M!LK推しの人');
  });

  it('グループ版: 未登録・空のグループでは読み台本をコピーできず、生成もできない', () => {
    const h = html(9, '未登録グループ');
    expect(h).toContain('登録済みのグループにありません');
    expect(h).not.toContain('読み台本をコピー');
    const r = parseMediaScriptReport(reports[9]);
    expect(mediaPickReady({ groupName: '未登録グループ' }, r, groups)).toBe(false);
    expect(mediaPickReady({ groupName: '' }, r, groups)).toBe(false);
    // 未選択では生成できない（例のグループを自動で使わない）。一覧から選んだ正式名称だけで生成できる
    expect(mediaPickReady(EMPTY_MEDIA_PICK, r, groups)).toBe(false);
    expect(effectiveMediaGroup(EMPTY_MEDIA_PICK, r, groups)).toBe('');
    expect(mediaPickReady({ groupName: 'Snow Man' }, r, groups)).toBe(true);
    expect(mediaPickReady({ groupName: 'snow man' }, r, groups)).toBe(false);
    expect(effectiveMediaGroup({ groupName: 'Snow Man' }, r, groups)).toBe('Snow Man');
    expect(mediaTemplateInput('Snow Man', 'group')).toEqual({ version: 1, templateCategory: 'oshi_media', groupName: 'Snow Man' });
    expect(mediaTemplateInput('Snow Man', 'none').groupName).toBeNull();
  });

  it('Worker の台本が届いていないときは生成できない旨を出す', () => {
    const h = renderToStaticMarkup(<MediaReelPicker mediaScript={undefined} groups={groups} fixedReadings={{}} value={EMPTY_MEDIA_PICK} onChange={() => {}} />);
    expect(h).toContain('台本がまだ届いていません');
    expect(mediaPickReady(EMPTY_MEDIA_PICK, null, groups)).toBe(false);
  });
});
