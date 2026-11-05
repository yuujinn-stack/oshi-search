import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { checkAdTag, AD_TAG_MAX_LENGTH } from '@/lib/oshikatsu-affiliate/ad-tag';
import { pickPublicAdCreative, getAdStatus, type AdDecisionCreative } from '@/lib/oshikatsu-affiliate/core';
import { parseCreativeInput, parseServiceInput } from '@/lib/oshikatsu-affiliate/input';
import { OSHIKATSU_AFFILIATE_PRESETS, OSHIKATSU_PAGE_SERVICE_KEYS } from '@/lib/oshikatsu-affiliate/constants';
import { GOODS_MAKING_SERVICES } from '@/lib/oshikatsu-services/goods-making';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

// A8.net「通常広告」タグと同じ構造のテスト用タグ（a8mat の値は架空）
const A8_TEXT = `<a href="https://px.a8.net/svt/ejp?a8mat=TEST0000+000000+0000+000000" rel="nofollow">推しグッズを作るなら</a>
<img border="0" width="1" height="1" src="https://www13.a8.net/0.gif?a8mat=TEST0000+000000+0000+000000" alt="">`;
const A8_BANNER = `<a href="https://px.a8.net/svt/ejp?a8mat=TEST0000+000000+0000+111111" rel="nofollow">
<img border="0" width="300" height="250" alt="" src="https://www24.a8.net/svt/bgt?aid=000000000000&wid=001&eno=01&mid=s00000000000000&mc=1"></a>
<img border="0" width="1" height="1" src="https://www10.a8.net/0.gif?a8mat=TEST0000+000000+0000+111111" alt="">`;

describe('広告タグの安全確認（checkAdTag）', () => {
  test('A8.netの通常広告タグ（テキスト・バナー）は通る', () => {
    const t = checkAdTag('a8', A8_TEXT);
    expect(t).toMatchObject({ ok: true, linkCount: 1, imageCount: 1, hasTrackingPixel: true });
    const b = checkAdTag('a8', A8_BANNER);
    expect(b).toMatchObject({ ok: true, linkCount: 1, imageCount: 2, hasTrackingPixel: true });
  });

  test('&amp; を含むURL・自己終了タグ・target=_blank も通る', () => {
    const html = A8_TEXT.replace('rel="nofollow"', 'rel="nofollow" target="_blank"').replace('alt="">', 'alt="" />')
      .replace('a8mat=TEST0000+000000+0000+000000"', 'a8mat=TEST0000+000000+0000+000000&amp;x=1"');
    expect(checkAdTag('a8', html).ok).toBe(true);
  });

  test.each([
    ['script', `${A8_TEXT}<script>alert(1)</script>`],
    ['iframe', `${A8_TEXT}<iframe src="https://px.a8.net/"></iframe>`],
    ['style 要素', `${A8_TEXT}<style>a{}</style>`],
    ['コメント', `${A8_TEXT}<!-- x -->`],
    ['onclick 属性', A8_TEXT.replace('rel="nofollow"', 'rel="nofollow" onclick="alert(1)"')],
    ['onerror 属性', A8_TEXT.replace('alt="">', 'alt="" onerror="alert(1)">')],
    ['style 属性', A8_TEXT.replace('rel="nofollow"', 'rel="nofollow" style="display:none"')],
    ['javascript: リンク', A8_TEXT.replace(/href="[^"]+"/, 'href="javascript:alert(1)"')],
    ['他ドメインのリンク', A8_TEXT.replace('px.a8.net', 'evil.example.com')],
    ['a8.net に似せたドメイン', A8_TEXT.replace('px.a8.net', 'px.a8.net.evil.com')],
    ['ユーザー情報で偽装したURL', A8_TEXT.replace('https://px.a8.net/', 'https://px.a8.net@evil.com/')],
    ['http のリンク', A8_TEXT.replace('https://px.a8.net', 'http://px.a8.net')],
    ['文字参照で隠したURL', A8_TEXT.replace('https://px.a8.net', 'https&#58;//px.a8.net')],
    ['ドメイン部分に文字参照', A8_TEXT.replace('https://px.a8.net/', 'https://px.a8.net&period;evil.com/')],
    ['クエリ内の数値文字参照', A8_TEXT.replace('a8mat=TEST0000+000000+0000+000000"', 'a8mat=X&#38;y=1"')],
    ['他ドメインの画像', A8_BANNER.replace('www24.a8.net', 'images.example.com')],
    ['計測用1×1画像が無い', A8_TEXT.split('\n')[0]],
    ['閉じていない a', A8_TEXT.replace('</a>', '')],
    ['a の入れ子', A8_TEXT.replace('推しグッズを作るなら', '<a href="https://px.a8.net/x">x</a>')],
    ['許可外の rel', A8_TEXT.replace('rel="nofollow"', 'rel="opener"')],
    ['数字でない width', A8_BANNER.replace('width="300"', 'width="100%"')],
    ['同じ属性が2回', A8_TEXT.replace('rel="nofollow"', 'rel="nofollow" rel="nofollow"')],
    ['リンクが無い', '<img border="0" width="1" height="1" src="https://www13.a8.net/0.gif?a8mat=X" alt="">'],
    ['空', '   '],
  ])('不可: %s', (_label, html) => {
    const r = checkAdTag('a8', html);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('長すぎるタグ・未対応のASPは不可', () => {
    expect(checkAdTag('a8', A8_TEXT + ' '.repeat(AD_TAG_MAX_LENGTH)).ok).toBe(false);
    expect(checkAdTag('unknown_asp', A8_TEXT).ok).toBe(false);
  });
});

const creative = (over: Partial<AdDecisionCreative> = {}): AdDecisionCreative => ({
  id: 1, kind: 'text', adHtml: A8_TEXT, isActive: true, sortOrder: 0, createdAt: 1, ...over,
});
const approved = { partnershipStatus: 'approved', isAdEnabled: true, aspId: 'a8' };

describe('公開ページに広告を出すかの判定（pickPublicAdCreative）', () => {
  test('承認済み・広告有効・安全確認OKのときだけ、登録したタグを1文字も変えずに返す', () => {
    const picked = pickPublicAdCreative(approved, [creative()]);
    expect(picked?.adHtml).toBe(A8_TEXT);
    expect(getAdStatus(approved, [creative()])).toBe('live');
  });

  test('審査中・否認・終了・広告無効・素材なし・素材無効は広告を出さない（通常リンクのまま）', () => {
    for (const st of ['pending', 'rejected', 'ended']) {
      expect(pickPublicAdCreative({ ...approved, partnershipStatus: st }, [creative()])).toBeNull();
    }
    expect(pickPublicAdCreative({ ...approved, isAdEnabled: false }, [creative()])).toBeNull();
    expect(pickPublicAdCreative(approved, [])).toBeNull();
    expect(pickPublicAdCreative(approved, [creative({ isActive: false })])).toBeNull();
    expect(getAdStatus({ ...approved, isAdEnabled: false }, [creative()])).toBe('disabled');
    expect(getAdStatus({ ...approved, partnershipStatus: 'pending' }, [creative()])).toBe('not_approved');
    expect(getAdStatus(approved, [])).toBe('no_creative');
  });

  test('安全確認に通らない素材は表示せず、次の素材を使う。表示順の小さいものが優先', () => {
    const bad = creative({ id: 1, sortOrder: 0, adHtml: `${A8_TEXT}<script></script>` });
    const second = creative({ id: 2, sortOrder: 5, adHtml: A8_BANNER });
    const third = creative({ id: 3, sortOrder: 1, adHtml: A8_TEXT });
    expect(pickPublicAdCreative(approved, [bad, second, third])?.creativeId).toBe(3);
    expect(pickPublicAdCreative(approved, [bad])).toBeNull();
  });
});

describe('管理APIの入力チェック', () => {
  const base = {
    serviceKey: 'cherish_palette', serviceName: 'Cherish Palette', category: 'goods_making', aspId: 'a8',
    programId: 's00000000000000', officialUrl: 'https://cherish-palette.jp/', partnershipStatus: 'approved', note: '',
  };

  test('新規登録は広告を有効にして送っても、必ず広告無効で登録する', () => {
    const r = parseServiceInput({ ...base, isAdEnabled: true }, 'create');
    expect(r.ok && r.value.isAdEnabled).toBe(false);
  });

  test('不正なサービスキー・ジャンル・ASP・提携状態・URLは保存しない', () => {
    expect(parseServiceInput({ ...base, serviceKey: 'Bad Key' }, 'create').ok).toBe(false);
    expect(parseServiceInput({ ...base, category: 'vod' }, 'create').ok).toBe(false);
    expect(parseServiceInput({ ...base, aspId: 'other' }, 'create').ok).toBe(false);
    expect(parseServiceInput({ ...base, partnershipStatus: 'active' }, 'create').ok).toBe(false);
    expect(parseServiceInput({ ...base, officialUrl: 'javascript:alert(1)' }, 'create').ok).toBe(false);
  });

  test('更新は送った項目だけを返す（広告の有効・無効だけの切り替えができる）', () => {
    const r = parseServiceInput({ isAdEnabled: true }, 'update');
    expect(r).toEqual({ ok: true, value: { isAdEnabled: true } });
  });

  test('広告タグは受け取ったまま（前後の空白・改行も含めて）保存し、安全確認NGのタグは保存しない', () => {
    const raw = `\n${A8_BANNER}\n`;
    const ok = parseCreativeInput({ name: 'バナー', kind: 'banner', adHtml: raw }, 'a8', 'create');
    expect(ok.ok && ok.value.adHtml).toBe(raw);
    expect(ok.ok && ok.value.isActive).toBe(true);
    expect(parseCreativeInput({ name: 'x', kind: 'text', adHtml: `${A8_TEXT}<script></script>` }, 'a8', 'create').ok).toBe(false);
    expect(parseCreativeInput({ name: 'x', kind: 'text', adHtml: A8_TEXT }, 'other', 'create').ok).toBe(false);
  });
});

describe('初期案件・掲載先', () => {
  test('初期案件は Cherish Palette（承認済み）・しまうまプラス（審査中）。プログラムIDはリポジトリに書かない', () => {
    expect(OSHIKATSU_AFFILIATE_PRESETS.map((p) => [p.serviceKey, p.partnershipStatus])).toEqual([
      ['cherish_palette', 'approved'],
      ['shimauma_plus', 'pending'],
    ]);
    for (const f of ['src/lib/oshikatsu-affiliate/constants.ts', 'src/app/admin/affiliates/OshikatsuAffiliateManager.tsx']) {
      expect(read(f)).not.toMatch(/s0000000?\d{6,}/);
    }
  });

  test('グッズ制作比較ページの全サービスが広告の掲載先として登録されている', () => {
    expect([...(OSHIKATSU_PAGE_SERVICE_KEYS.goods_making ?? [])].sort()).toEqual(GOODS_MAKING_SERVICES.map((s) => s.id).sort());
  });
});

describe('導線・既存機能', () => {
  test('比較ページはDBの広告タグを読み、ISR＋管理画面からの再生成で反映する', () => {
    const page = read('src/app/oshikatsu/goods-making/page.tsx');
    expect(page).toContain('getPublicOshikatsuAds(');
    expect(page).toMatch(/export const revalidate = \d+;/);
    expect(page).toContain('<OshikatsuAdTag');
    // 広告が無いサービスは従来どおり公式サイトボタン
    expect(page).toContain('の公式サイトを見る ↗');
  });

  test('広告タグの表示コンポーネントはタグを加工しない（そのまま innerHTML に渡す）', () => {
    const src = read('src/components/oshikatsu/OshikatsuAdTag.tsx');
    expect(src).toContain('dangerouslySetInnerHTML={{ __html: html }}');
    expect(src).not.toMatch(/\.replace\(|DOMParser|querySelector|from 'next\/link'/);
  });

  test('管理画面に VOD配信・推し活サービス のタブがあり、VOD側は既存の AffiliateManager をそのまま使う', () => {
    const page = read('src/app/admin/affiliates/page.tsx');
    expect(page).toContain('アフィリエイト広告管理');
    expect(page).toContain("label: 'VOD配信'");
    expect(page).toContain("label: '推し活サービス'");
    expect(page).toContain('<AffiliateManager initialPrograms={programs} />');
  });

  test('管理APIはすべて /api/admin 配下（src/proxy.ts の管理者認証の対象）', () => {
    expect(read('src/proxy.ts')).toContain("pathname.startsWith('/api/admin')");
  });

  test('db-init で推し活サービス用のテーブルを作成する（VOD用テーブルとは別）', () => {
    const init = read('src/app/api/admin/db-init/route.ts');
    expect(init).toContain('CREATE TABLE IF NOT EXISTS oshikatsu_affiliate_services');
    expect(init).toContain('CREATE TABLE IF NOT EXISTS oshikatsu_affiliate_creatives');
    expect(init).toContain('is_ad_enabled       BOOLEAN NOT NULL DEFAULT FALSE');
  });
});
