import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import reports from './fixtures/media-script-reports.json';
import MediaReelPicker from '@/app/admin/video-maker/MediaReelPicker';
import {
  isMediaGroupTemplateId,
  isMediaTemplateId,
  mediaJobPersonName,
  mediaScriptReadsGroupName,
  parseMediaScriptReport,
  renderMediaScript,
} from '@/lib/video-media-reel';

// OSHI_GROUP_09: OSHI_GENERAL_09「これまだ知らないの？」を複製したグループ版（Worker の派生テンプレート）。
// グループは OSHI_GROUP_05・10 と同じ一覧から選ぶ。ナレーション・読み台本は OSHI_GENERAL_09 と同じで、グループ名は入らない。
const groups = [
  { name: 'M!LK', members: ['佐野勇斗'] },
  { name: 'Snow Man', members: ['目黒蓮'] },
  { name: 'Aぇ! group', members: ['正門良規'] },
];
const idx = (id: string) => reports.findIndex((r) => r.templateId === id);
const html = (id: string, groupName: string | null) =>
  renderToStaticMarkup(<MediaReelPicker mediaScript={reports[idx(id)]} groups={groups} fixedReadings={{}} value={{ groupName }} onChange={() => {}} />);

describe('OSHI_GROUP_09（グループ版・このサイトまだ知らないの？）', () => {
  it('管理画面が知っているグループ版のテンプレート。ジョブの person_name は選んだグループ名', () => {
    expect(isMediaTemplateId('OSHI_GROUP_09')).toBe(true);
    expect(isMediaGroupTemplateId('OSHI_GROUP_09')).toBe(true);
    expect(isMediaGroupTemplateId('OSHI_GENERAL_09')).toBe(false);
    expect(mediaJobPersonName('OSHI_GROUP_09', 'Snow Man')).toBe('Snow Man');
  });

  it('Worker の報告を読める。台本・読みは OSHI_GENERAL_09 と同じで、冒頭の表示文字だけ「このサイトまだ知らないの？」', () => {
    const a = parseMediaScriptReport(reports[idx('OSHI_GENERAL_09')])!;
    const b = parseMediaScriptReport(reports[idx('OSHI_GROUP_09')])!;
    expect(b.selectionMode).toBe('group');
    expect(b.lines.map((l) => [l.text, l.kana])).toEqual(a.lines.map((l) => [l.text, l.kana]));
    expect(b.lines[0].overlay).toBe('このサイトまだ知らないの？');
    expect(b.lines.slice(1).map((l) => l.overlay)).toEqual(a.lines.slice(1).map((l) => l.overlay));
    expect(mediaScriptReadsGroupName(b)).toBe(false);
    // グループを選んでも、台本・読み台本は同じ（グループ名は入らない）
    const p = renderMediaScript(b, 'Snow Man', null);
    expect(p.scriptText).toBe(renderMediaScript(a, null, null).scriptText);
    expect(p.kanaText).not.toContain('Snow Man');
    expect(p.groupReadingMissing).toBe(false);
  });

  it('グループの一覧選択（OSHI_GROUP_05・10 と同じ）を出し、グループ名の読みの欄は出さない（ナレーションにグループ名がないため）', () => {
    const h = html('OSHI_GROUP_09', 'Snow Man');
    expect(h).toContain('vm-media-group');
    expect(h).toContain('Snow Man');
    expect(h).toContain('vm-media-group-screens-only');
    expect(h).not.toContain('vm-media-group-reading');
    expect(h).toContain('このサイトまだ知らないの？');
    expect(html('OSHI_GROUP_09', null)).toContain('グループが未選択のため生成できません');
  });

  it('OSHI_GROUP_05・10 は従来どおりグループ名の読みの欄を出す。一般版の OSHI_GENERAL_09 はグループ選択なし', () => {
    for (const id of ['OSHI_GROUP_05', 'OSHI_GROUP_10']) {
      const h = html(id, 'Snow Man');
      expect(h).toContain('vm-media-group-reading');
      expect(h).not.toContain('vm-media-group-screens-only');
    }
    expect(html('OSHI_GENERAL_09', null)).not.toContain('vm-media-group');
  });
});
