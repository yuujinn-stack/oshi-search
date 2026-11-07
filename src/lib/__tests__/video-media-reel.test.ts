import { describe, expect, it } from 'vitest';
import reports from './fixtures/media-script-reports.json';
import {
  MEDIA_GROUP_TOKEN,
    MEDIA_TEMPLATE_CATEGORY,
  MEDIA_TEMPLATE_IDS,
  isMediaGroupTemplateId,
  isMediaTemplateId,
  parseMediaScriptReport,
  renderMediaScript,
} from '@/lib/video-media-reel';
import { OSHI_MEDIA_INPUT_KIND, TEMPLATE_INPUT_KINDS, TemplateInputError, isOshiMediaInput, parseOshiMediaInput, parseTemplateInput } from '@/lib/video-template-input';

// fixtures/media-script-reports.json は oshi-video-maker の buildMediaScriptReport が実際に出す報告（10種類）。
// Worker の報告をこの画面のコードが読めること・グループ名の差し込み・入力の検証を確かめる

describe('推しサーチ総合紹介動画（10種類）', () => {
  it('Worker の報告（10種類）をすべて読め、ID・順番・グループ版の区別が一致する', () => {
    const parsed = reports.map((r) => parseMediaScriptReport(r));
    expect(parsed.every((p) => p !== null)).toBe(true);
    expect(parsed.map((p) => p!.templateId)).toEqual([...MEDIA_TEMPLATE_IDS]);
    expect(parsed.filter((p) => p!.selectionMode === 'group').map((p) => p!.templateId)).toEqual(['OSHI_GROUP_05', 'OSHI_GROUP_10']);
    for (const p of parsed) {
      expect(isMediaTemplateId(p!.templateId)).toBe(true);
      expect(isMediaGroupTemplateId(p!.templateId)).toBe(p!.selectionMode === 'group');
      expect(p!.lines.length).toBeGreaterThanOrEqual(3);
      // 一般版の台本にはグループ名の差し込みが無い
      if (p!.selectionMode === 'none') expect(p!.lines.some((l) => l.text.includes(MEDIA_GROUP_TOKEN))).toBe(false);
    }
  });

  it('形が違う報告・テンプレートの種類と合わない報告は読まない', () => {
    const r = reports[0];
    expect(parseMediaScriptReport(null)).toBeNull();
    expect(parseMediaScriptReport({ ...r, version: 2 })).toBeNull();
    expect(parseMediaScriptReport({ ...r, templateId: 'site_person_search' })).toBeNull();
    expect(parseMediaScriptReport({ ...r, selectionMode: 'group' })).toBeNull();
    expect(parseMediaScriptReport({ ...r, lines: r.lines.slice(0, 2) })).toBeNull();
    expect(parseMediaScriptReport({ ...r, lines: [{ ...r.lines[0], kana: '' }, ...r.lines.slice(1)] })).toBeNull();
  });

  it('No.1 の台本は原本のまま表示され、読み台本は1文1行', () => {
    const p = renderMediaScript(parseMediaScriptReport(reports[0])!, null, null);
    expect(p.lines[0].text).toBe('推し活してる人のために、神サイト作りました！');
    expect(p.kanaText.split('\n')).toHaveLength(p.lines.length);
    expect(p.scriptText.split('\n')).toHaveLength(p.lines.length);
    expect(p.groupReadingMissing).toBe(false);
  });

  it('グループ版は選んだグループ名に置き換え、読みがあれば読み台本は読みにする（残りのトークンなし）', () => {
    const r = parseMediaScriptReport(reports[4])!;
    const p = renderMediaScript(r, 'Snow Man', 'すのーまん');
    expect(p.name).toBe('Snow Man推し向け・総合紹介');
    expect(p.lines[0].text).toBe('Snow Man推しの人、このサイトもう使ってる？');
    expect(p.lines[0].kana).toBe('すのーまんおしのひと、このサイトもうつかってる？');
    expect([p.name, p.title, p.scriptText, p.kanaText, ...p.lines.map((l) => l.overlay)].some((t) => t.includes('{{'))).toBe(false);
    expect(p.groupReadingMissing).toBe(false);
    // 読みが分からないときはグループ名のまま入れ、確認を促す
    const q = renderMediaScript(r, 'Snow Man', null);
    expect(q.lines[0].kana.startsWith('Snow Man')).toBe(true);
    expect(q.groupReadingMissing).toBe(true);
  });

  it('入力の種類 oshi-media-reel を受け付け、グループ名・CapCut 音声だけを正規化する（台本は受け取らない）', () => {
    expect(TEMPLATE_INPUT_KINDS).toContain(OSHI_MEDIA_INPUT_KIND);
    const general = parseTemplateInput(OSHI_MEDIA_INPUT_KIND, { version: 1, templateCategory: MEDIA_TEMPLATE_CATEGORY, groupName: null, lines: [{ id: '01-x', text: '改ざん', kana: 'かいざん' }] });
    expect(general).toEqual({ version: 1, templateCategory: MEDIA_TEMPLATE_CATEGORY, groupName: null });
    expect(isOshiMediaInput(general)).toBe(true);
    expect(parseOshiMediaInput({ groupName: ' M!LK ' }).groupName).toBe('M!LK');
    const voiced = parseOshiMediaInput({ version: 1, groupName: null, audio: { sourceJobId: '11111111-2222-4333-8444-555555555555', wavUrl: 'https://abc.public.blob.vercel-storage.com/video-jobs/11111111-2222-4333-8444-555555555555/capcut-x.wav', srtUrl: 'https://abc.public.blob.vercel-storage.com/video-jobs/11111111-2222-4333-8444-555555555555/capcut-x.srt' } });
    expect(voiced.audio?.sourceJobId).toBe('11111111-2222-4333-8444-555555555555');
    expect(() => parseOshiMediaInput(null)).toThrow(TemplateInputError);
    expect(() => parseOshiMediaInput({ version: 2 })).toThrow(TemplateInputError);
    expect(() => parseOshiMediaInput({ templateCategory: 'site_referral' })).toThrow(TemplateInputError);
    expect(() => parseOshiMediaInput({ groupName: 'a/b' })).toThrow(TemplateInputError);
    expect(() => parseOshiMediaInput({ groupName: 123 })).toThrow(TemplateInputError);
  });
});
