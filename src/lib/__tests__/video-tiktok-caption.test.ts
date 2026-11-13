import { describe, expect, it } from 'vitest';
import { buildTiktokPostText, hasLinkWording, TIKTOK_CAPTION_CTA, withTiktokPostText } from '../video-tiktok-caption';

// 本番の完了ジョブの投稿文（2026-11-13 時点）をもとにした例
const MEDIA_GROUP = 'Aぇ! group推し もう使ってる？\n\nプロフィールのリンクからチェック！\n※サイトの検索・診断は無料。配信サービス・商品・外部サービスの利用は各サービスの料金がかかる場合があります。\n\n#推しサーチ #推し活\n';
const FOLLOW = '平野紫耀、この2作品の役柄を比べてみた\n\n出演作・配信情報は推しサーチで👇\nhttps://oshi-search.jp/person/%E5%B9%B3%E9%87%8E\n\n#平野紫耀 #推しサーチ #推し活\n';
const SITE = '使っているサブスクから作品を探してみた｜U-NEXT・小栗旬\n\n実際の推しサーチの画面で検索してみました。\nあなたの推しも、プロフィールのリンクから検索してみてね！\n\n#推しサーチ #推し活\n';
const CARD = '目黒蓮の布教カード、作ってみました✨\n\nおすすめは「silent」\n\n無料・登録不要。プロフィールのリンクから作れます。\n\n#目黒蓮 #SnowMan #推しサーチ #布教カード #推し活\n';
const LEGACY_TIKTOK = '二宮和也の出演作をチェック🎬\n『VIVANT 第2シーズン』などの出演作品をまとめて確認できます。\n続きはプロフィールのリンクから。\n#二宮和也 #推し活';
const LEGACY_DEFAULT = '目黒蓮推しは、待って。\n出演作品も配信情報も、プロフィールのリンクからまとめてチェックできます🔗\n\n#目黒蓮 #推し活 #推しサーチ\n';

const count = (t: string) => t.split(TIKTOK_CAPTION_CTA).length - 1;

describe('buildTiktokPostText（TikTok 用投稿文）', () => {
  it('総合紹介（グループ）: リンクの誘導を CTA に置き換え、タイトル・注記・ハッシュタグは残す', () => {
    const t = buildTiktokPostText({ default: MEDIA_GROUP })!;
    expect(hasLinkWording(t)).toBe(false);
    expect(count(t)).toBe(1);
    expect(t).toContain('Aぇ! group推し もう使ってる？');
    expect(t).toContain('※サイトの検索・診断は無料');
    expect(t).toMatch(/#推しサーチ #推し活\n$/);
  });

  it('フォロー獲得: URL の行と直前の「〜で👇」をまとめて CTA に', () => {
    const t = buildTiktokPostText({ default: FOLLOW })!;
    expect(t).toBe(`平野紫耀、この2作品の役柄を比べてみた\n\n${TIKTOK_CAPTION_CTA}\n\n#平野紫耀 #推しサーチ #推し活\n`);
  });

  it('サイト誘導: 「プロフィールのリンクから検索してみてね」を CTA に', () => {
    const t = buildTiktokPostText({ default: SITE })!;
    expect(t).toContain('実際の推しサーチの画面で検索してみました。');
    expect(hasLinkWording(t)).toBe(false);
    expect(count(t)).toBe(1);
  });

  it('推し布教カード: 「無料・登録不要。」は残し、リンクの文だけ CTA に', () => {
    const t = buildTiktokPostText({ default: CARD })!;
    expect(t).toContain(`無料・登録不要。\n${TIKTOK_CAPTION_CTA}`);
    expect(t).toContain('おすすめは「silent」');
    expect(hasLinkWording(t)).toBe(false);
  });

  it('TikTok 用の投稿文がある（まず見る3作など）: それを元にし、「続きはプロフィールのリンクから。」を CTA に', () => {
    const t = buildTiktokPostText({ default: LEGACY_DEFAULT, tiktok: LEGACY_TIKTOK })!;
    expect(t).toBe(`二宮和也の出演作をチェック🎬\n『VIVANT 第2シーズン』などの出演作品をまとめて確認できます。\n${TIKTOK_CAPTION_CTA}\n#二宮和也 #推し活\n`);
  });

  it('内容のある文は「推しサーチで」に言い換え、CTA はハッシュタグの前に1回だけ足す', () => {
    const t = buildTiktokPostText({ default: LEGACY_DEFAULT })!;
    expect(t).toContain('出演作品も配信情報も、推しサーチでまとめてチェックできます🔍');
    expect(hasLinkWording(t)).toBe(false);
    expect(count(t)).toBe(1);
    expect(t.indexOf(TIKTOK_CAPTION_CTA)).toBeLessThan(t.indexOf('#目黒蓮'));
  });

  it('リンクの文言が無い文章にも CTA を1回だけ足す・すでにある CTA は二重にしない', () => {
    const t = buildTiktokPostText({ default: 'タイトル\n\n本文です。\n\n#推し活' })!;
    expect(t).toBe(`タイトル\n\n本文です。\n\n${TIKTOK_CAPTION_CTA}\n\n#推し活\n`);
    expect(count(buildTiktokPostText({ default: t })!)).toBe(1);
  });

  it('元の投稿文が無ければ null', () => {
    expect(buildTiktokPostText(null)).toBeNull();
    expect(buildTiktokPostText({ default: null, tiktok: null })).toBeNull();
  });
});

describe('withTiktokPostText（管理画面の投稿文タブ）', () => {
  it('TikTok だけ差し替え、共通・Instagram・Threads・X の投稿文はそのまま', () => {
    const src = { default: MEDIA_GROUP, instagram: 'IG用\n#推し活', tiktok: null, threads: 'th', x: 'x' };
    const out = withTiktokPostText(src);
    expect(out.default).toBe(src.default);
    expect(out.instagram).toBe(src.instagram);
    expect(out.threads).toBe('th');
    expect(out.x).toBe('x');
    expect(out.tiktok).toContain(TIKTOK_CAPTION_CTA);
    expect(src.tiktok).toBeNull(); // 元のオブジェクトは変えない
  });
});
