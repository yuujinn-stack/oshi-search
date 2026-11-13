import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/oshi-card/data', () => ({ loadOshiCardPerson: vi.fn() }));
vi.mock('@/lib/oshi-vod/data', () => ({ getOshiVodKnownPersons: vi.fn(), loadOshiVodDiagnosis: vi.fn() }));
vi.mock('@/server/instagram-post/fonts/font-loader', () => ({ getNotoSansJpBoldFontData: vi.fn(() => new ArrayBuffer(8)) }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('next/og', () => ({ ImageResponse: class extends Response { constructor(_el: unknown, init: { width: number; height: number; headers?: Record<string, string> }) { super('png', { status: 200, headers: { ...(init.headers ?? {}), 'x-size': `${init.width}x${init.height}` } }); } } }));

import { NextRequest } from 'next/server';
import {
  buildOshiCardEditPath,
  buildOshiCardImagePath,
  buildOshiCardResultPath,
  oshiCardImageDimensions,
  oshiCardMinWorks,
  parseOshiCardParams,
  type OshiCardSelection,
} from '../oshi-card/params';
import {
  OSHI_CARD_DEFAULT_NUMA,
  OSHI_CARD_DEFAULT_POWER,
  OSHI_CARD_DEFAULT_TCG,
  OSHI_CARD_DEFAULT_TRAIT,
  oshiCardTcgDraftFrom,
  oshiCardTcgFromDraft,
  sanitizeOshiCardPower,
  sanitizeOshiCardText,
} from '../oshi-card/tcg';
import { buildOshiCardShareText } from '../oshi-card/core';
import { buildOshiCardSocialMetadata } from '../oshi-card/og-meta';
import { loadOshiCardPerson } from '../oshi-card/data';
import { buildTcgCardImageElement, layoutTcgName, ssrAccentOf, type OshiCardTcgImageData } from '@/server/oshi-card/tcg-card-image';
import { oshiCardColor } from '@/lib/oshi-card/tcg';
import { emWidth } from '@/server/oshi-card/card-image';
import { isCanonicalCardQuery, respondOshiCardImage } from '@/server/oshi-card/image-response';

function collectText(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, out)); return out; }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode; 'aria-label'?: string }>;
    if (typeof el.type === 'function') return collectText((el.type as (p: unknown) => ReactNode)(el.props), out);
    // A の名前は SVG の輪郭で描き、元の文字列は aria-label に残す
    if (el.type === 'svg' && typeof el.props['aria-label'] === 'string') out.push(el.props['aria-label']);
    return collectText(el.props.children, out);
  }
  return out;
}

const P = encodeURIComponent('目黒蓮');

describe('トレカ風：自由入力の検証', () => {
  it('制御文字・改行を除き、空白をまとめ、文字数を制限する（サロゲートペアを壊さない）', () => {
    expect(sanitizeOshiCardText('  笑顔の\n\t破壊力​  ', 18)).toBe('笑顔の 破壊力');
    expect(sanitizeOshiCardText('あ'.repeat(30), 18)).toBe('あ'.repeat(18));
    expect(sanitizeOshiCardText('😀'.repeat(30), 5)).toBe('😀'.repeat(5));
    expect(sanitizeOshiCardText('   ', 18)).toBeNull();
    expect(sanitizeOshiCardText(undefined, 18)).toBeNull();
  });

  it('URL・メールアドレス・@ID・電話番号のような文字列は受け付けない', () => {
    for (const bad of ['https://example.com', 'www.example', 'example.com', '見てね example.jp', '@my_account', 'a@gmail.com', '090-1234-5678']) {
      expect(sanitizeOshiCardText(bad, 30), bad).toBeNull();
    }
    expect(sanitizeOshiCardText('FRUITS ZIPPER', 20)).toBe('FRUITS ZIPPER');
    expect(sanitizeOshiCardText('Number_i', 20)).toBe('Number_i');
  });

  it('推し力は 0〜99999 の整数（不正は null）', () => {
    expect(sanitizeOshiCardPower('120')).toBe(120);
    expect(sanitizeOshiCardPower('0')).toBe(0);
    expect(sanitizeOshiCardPower('999999')).toBe(99999);
    expect(sanitizeOshiCardPower('-1')).toBeNull();
    expect(sanitizeOshiCardPower('1e5')).toBeNull();
    expect(sanitizeOshiCardPower('')).toBeNull();
  });

  it('入力中の値 → カードの値：空・不正は既定値、人物名と同じ名前は省略', () => {
    const t = oshiCardTcgFromDraft({ name: '目黒蓮', trait: '', numa: 'https://x.com', power: 'abc', color: 'blue' }, '目黒蓮');
    expect(t).toEqual({ name: null, trait: OSHI_CARD_DEFAULT_TRAIT, numa: OSHI_CARD_DEFAULT_NUMA, power: OSHI_CARD_DEFAULT_POWER, color: 'blue' });
    expect(oshiCardTcgFromDraft(oshiCardTcgDraftFrom({ ...OSHI_CARD_DEFAULT_TCG, name: 'めめ' }), '目黒蓮').name).toBe('めめ');
  });
});

describe('トレカ風：URL', () => {
  const SEL: OshiCardSelection = { person: '目黒蓮', workIds: ['w1'], variant: 'ssr', phrase: 'fukyo' };

  it('既定値は省略し、カスタマイズは nm・tr・np・pw・c の順で載せる（往復で同じ内容）', () => {
    expect(buildOshiCardResultPath(SEL)).toBe(`/oshi-card?p=${P}&w=w1&v=ssr`);
    // SSR は既定色（紫）を明示したときだけ c=purple を残す（省略＝従来の見た目、明示＝紫のアクセント）。ベーシックの既定色（ピンク）は従来どおり省略
    expect(buildOshiCardResultPath({ ...SEL, tcg: { ...OSHI_CARD_DEFAULT_TCG, color: null } })).toBe(`/oshi-card?p=${P}&w=w1&v=ssr`);
    expect(buildOshiCardResultPath({ ...SEL, tcg: { ...OSHI_CARD_DEFAULT_TCG, color: 'purple' } })).toBe(`/oshi-card?p=${P}&w=w1&v=ssr&c=purple`);
    expect(buildOshiCardResultPath({ ...SEL, variant: 'basic', tcg: { ...OSHI_CARD_DEFAULT_TCG, color: 'pink' } })).toBe(`/oshi-card?p=${P}&w=w1&v=basic`);
    const sel: OshiCardSelection = { ...SEL, workIds: [], tcg: { name: 'めめ', trait: '努力の天才', numa: '声が良すぎる', power: 120, color: 'pink' } };
    const path = buildOshiCardResultPath(sel);
    expect(path).toBe(`/oshi-card?p=${P}&v=ssr&nm=${encodeURIComponent('めめ')}&tr=${encodeURIComponent('努力の天才')}&np=${encodeURIComponent('声が良すぎる')}&pw=120&c=pink`);
    const sp = new URLSearchParams(path.split('?')[1]);
    const back = parseOshiCardParams(Object.fromEntries(['p', 'w', 'v', 'ph', 'nm', 'tr', 'np', 'pw', 'c'].map((k) => [k, sp.getAll(k)])));
    expect(back.variant).toBe('ssr');
    expect(back.workIds).toEqual([]);
    expect(back.tcg).toEqual(sel.tcg);
    expect(buildOshiCardEditPath('目黒蓮', { selection: { workIds: [], variant: 'legend', phrase: 'fukyo', tcg: sel.tcg } })).toContain('&nm=');
  });

  it('ノーマル・デコには、カスタマイズを載せない（従来のURLのまま）', () => {
    expect(buildOshiCardResultPath({ ...SEL, variant: 'cute', tcg: { name: 'めめ', trait: 'x', numa: 'y', power: 1, color: 'red' } })).toBe(`/oshi-card?p=${P}&w=w1&v=cute`);
  });

  it('不正なデザイン・色は既定値', () => {
    const p = parseOshiCardParams({ p: '目黒蓮', v: 'ur', c: 'gold', pw: 'x', nm: '目黒蓮' });
    expect(p.variant).toBe('cool');
    expect(p.tcg).toEqual(OSHI_CARD_DEFAULT_TCG);
  });

  it('作品数の下限：トレカ風は0件、ほかは1件。画像の大きさはトレカ風の feed だけ 1260×1760（63:88）', () => {
    expect(oshiCardMinWorks('basic')).toBe(0);
    expect(oshiCardMinWorks('cool')).toBe(1);
    expect(oshiCardImageDimensions('feed', 'legend')).toEqual({ width: 1260, height: 1760 });
    expect(1260 / 1760).toBeCloseTo(63 / 88, 5);
    expect(oshiCardImageDimensions('feed', 'cute')).toEqual({ width: 1080, height: 1350 });
    expect(oshiCardImageDimensions('story', 'ssr')).toEqual({ width: 1080, height: 1920 });
    expect(oshiCardImageDimensions('og', 'basic')).toEqual({ width: 1200, height: 630 });
  });

  it('正規形：カスタマイズは既定値なら省略・正規化した値で1つずつ。トレカ風以外ではキー自体を受け付けない', () => {
    const q = (s: string) => new URLSearchParams(s);
    const tcg = { name: 'めめ', trait: OSHI_CARD_DEFAULT_TRAIT, numa: OSHI_CARD_DEFAULT_NUMA, power: 5, color: null };
    const sel: OshiCardSelection = { ...SEL, tcg };
    expect(isCanonicalCardQuery(q('p=目黒蓮&w=w1&v=ssr&nm=めめ&pw=5'), sel, 'feed', false)).toBe(true);
    expect(isCanonicalCardQuery(q('p=目黒蓮&w=w1&v=ssr&nm=めめ&pw=5&c=purple'), sel, 'feed', false)).toBe(false);
    // 紫を明示した SSR は c=purple が正規形（省略した URL とは別のカード）
    expect(isCanonicalCardQuery(q('p=目黒蓮&w=w1&v=ssr&nm=めめ&pw=5&c=purple'), { ...sel, tcg: { ...tcg, color: 'purple' } }, 'feed', false)).toBe(true);
    expect(isCanonicalCardQuery(q('p=目黒蓮&w=w1&v=ssr&nm=めめ&pw=05'), sel, 'feed', false)).toBe(false);
    expect(isCanonicalCardQuery(q(`p=目黒蓮&w=w1&v=ssr&nm=めめ&pw=5&tr=${OSHI_CARD_DEFAULT_TRAIT}`), sel, 'feed', false)).toBe(false);
    expect(isCanonicalCardQuery(q('p=目黒蓮&w=w1&v=cute&nm=めめ'), { ...SEL, variant: 'cute' }, 'feed', false)).toBe(false);
  });

  it('作品なしの共有文・OG の説明文', () => {
    expect(buildOshiCardShareText('目黒蓮', [])).toBe('目黒蓮の布教カードを作りました！あなたの推しでも作ってみて');
    const m = buildOshiCardSocialMetadata({ selection: { ...SEL, workIds: [] }, titles: [], siteOrigin: 'https://oshi-search.jp', baseOpenGraph: {} });
    expect((m.openGraph as { description: string }).description).not.toContain('おすすめ作品：');
    expect((m.openGraph as { images: { url: string }[] }).images[0].url).toBe(`/oshi-card/og?p=${P}&v=ssr`);
  });
});

describe('トレカ風：名前の行分け', () => {
  it('短い名前は1行で大きく、長い名前は空白・文字種の切れ目で2行に分け、幅を超えない', () => {
    const W = 1000;
    for (const name of ['目黒蓮', '佐野勇斗', '山中柔太朗', '櫻坂46', 'FRUITS ZIPPER', '吉田綾乃クリスティー', 'Number_i', 'なにわ男子', 'あ'.repeat(20)]) {
      const { lines, font } = layoutTcgName(name, W, 290, 78, 500);
      expect(lines.join(lines.length > 1 && name.includes(' ') ? ' ' : ''), name).toBe(name);
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(font).toBeGreaterThanOrEqual(78);
      for (const l of lines) expect(emWidth(l) * font, `${name}:${l}`).toBeLessThanOrEqual(W);
      expect(font * (lines.length * 1.12 + 0.3)).toBeLessThanOrEqual(500 + 1);
    }
    expect(layoutTcgName('目黒蓮', 1000, 290, 78).lines).toEqual(['目黒蓮']);
    expect(layoutTcgName('FRUITS ZIPPER', 1000, 290, 78).lines).toEqual(['FRUITS', 'ZIPPER']);
    expect(layoutTcgName('吉田綾乃クリスティー', 1000, 290, 78).lines).toEqual(['吉田綾乃', 'クリスティー']);
  });
});

describe('トレカ風：画像', () => {
  const data = (n: number, over: Partial<OshiCardTcgImageData> = {}): OshiCardTcgImageData => ({
    person: '目黒蓮', group: 'Snow Man', name: 'めめ', phrase: '私の推しを布教します', trait: '努力の天才', numa: '声が良すぎる', power: 12345, color: null,
    works: Array.from({ length: n }, (_, i) => ({ title: `作品${i + 1}`, typeLabel: 'ドラマ', year: 2020 + i })),
    ...over,
  });

  it('3デザイン・全サイズ・作品0〜3件で、名前・人物名・特性・沼ポイント・推し力・作品（指定順）・推しサーチ・注記を載せる', () => {
    for (const v of ['basic', 'ssr', 'legend'] as const) for (const size of ['feed', 'story', 'og'] as const) for (const n of [0, 1, 2, 3]) {
      const text = collectText(buildTcgCardImageElement(data(n), size, v)).join('|');
      for (const must of ['めめ', '目黒蓮', 'Snow Man', '特性', '努力の天才', '沼ポイント', '声が良すぎる', '推し力', '12,345', 'おすすめ出演作品', '推しサーチ', 'oshi-search.jp/oshi-card', '公式の評価・順位ではありません']) {
        expect(text, `${v}/${size}/${n}: ${must}`).toContain(must);
      }
      // ひとこと（定型フレーズ）はレジェンドに載せる。A（ベーシック）・B（SSR）は参考デザインに合わせて載せない
      if (v === 'basic' || v === 'ssr') expect(text).not.toContain('私の推しを布教します');
      else expect(text, `${v}/${size}/${n}: phrase`).toContain('私の推しを布教します');
      for (let i = 1; i <= n; i++) expect(text).toContain(`作品${i}`);
      if (n > 1) expect(text.indexOf('作品1')).toBeLessThan(text.indexOf(`作品${n}`));
      if (n === 0) expect(text).toContain('出演作品は推しサーチでチェック');
    }
  });

  it('A・B の SVG の中に文字を置かない（Satori は SVG 内の <title> 等の文字も描いてしまうため。v7 で名前の一部が左上に出た不具合の再発防止）', () => {
    const svgTexts: string[] = [];
    const walk = (node: ReactNode, inSvg: boolean): void => {
      if (node === null || node === undefined || typeof node === 'boolean') return;
      if (typeof node === 'string' || typeof node === 'number') { if (inSvg) svgTexts.push(String(node)); return; }
      if (Array.isArray(node)) { node.forEach((n) => walk(n, inSvg)); return; }
      if (isValidElement(node)) {
        const el = node as ReactElement<{ children?: ReactNode }>;
        if (typeof el.type === 'function') { walk((el.type as (p: unknown) => ReactNode)(el.props), inSvg); return; }
        walk(el.props.children, inSvg || el.type === 'svg');
      }
    };
    for (const name of ['目黒蓮', 'めめ', '吉田綾乃クリスティー', 'Alexandra Christina']) {
      for (const size of ['feed', 'story', 'og'] as const) for (const v of ['basic', 'ssr'] as const) walk(buildTcgCardImageElement(data(3, { name }), size, v), false);
    }
    expect(svgTexts).toEqual([]);
  });

  it('レアリティ表示（SSR は右上に「SSR」）・全色で描画できる', () => {
    expect(collectText(buildTcgCardImageElement(data(1), 'feed', 'ssr')).join('|')).toContain('SSR');
    expect(collectText(buildTcgCardImageElement(data(1), 'feed', 'legend')).join('|')).toContain('LEGEND');
    for (const c of ['pink', 'red', 'sky', 'blue', 'purple', 'yellow', 'green', 'orange', 'white', 'black'] as const) {
      for (const v of ['basic', 'ssr', 'legend'] as const) expect(() => collectText(buildTcgCardImageElement(data(2, { color: c }), 'feed', v))).not.toThrow();
    }
  });

  // 描画した要素ツリーに出てくる色（fill・stroke・style の文字列）を集める
  const colorsIn = (node: ReactNode, out = new Set<string>()): Set<string> => {
    if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
    if (Array.isArray(node)) { node.forEach((n) => colorsIn(n, out)); return out; }
    if (isValidElement(node)) {
      const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
      if (typeof el.type === 'function') return colorsIn((el.type as (p: unknown) => ReactNode)(el.props), out);
      for (const [key, val] of Object.entries(el.props)) {
        if (key === 'children') continue;
        const text = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
        for (const m of text.matchAll(/#[0-9A-Fa-f]{6}\b/g)) out.add(m[0].toUpperCase());
      }
      return colorsIn(el.props.children, out);
    }
    return out;
  };

  it('SSR の推し色：省略（既存の共有URL）は従来どおり（アクセントなし）、選んだ10色（紫の明示を含む）は名前の縁取り・宝石などに色が入り、すべて見た目が異なる', () => {
    expect(ssrAccentOf(oshiCardColor('purple'), false)).toBeNull();
    expect(ssrAccentOf(oshiCardColor('purple'), true)).not.toBeNull();
    const ids = ['pink', 'red', 'sky', 'blue', 'purple', 'yellow', 'green', 'orange', 'white', 'black'] as const;
    const signatures = new Set<string>();
    for (const c of ids) {
      const used = colorsIn(buildTcgCardImageElement(data(2, { color: c }), 'feed', 'ssr'));
      const acc = ssrAccentOf(oshiCardColor(c), true);
      expect(acc).not.toBeNull();
      if (acc) for (const col of [acc.ring, acc.glow, acc.glow2, acc.orbit, acc.base, acc.deep, acc.gemBg]) expect(used.has(col.toUpperCase())).toBe(true);
      signatures.add([...used].sort().join(','));
    }
    // 省略（既定）は10色のどれとも違う（＝紫を明示したカードとも別）
    signatures.add([...colorsIn(buildTcgCardImageElement(data(2, { color: null }), 'feed', 'ssr'))].sort().join(','));
    expect(signatures.size).toBe(ids.length + 1);
  });

  it('SSR の赤とオレンジ・ピンクと赤など近い色も、名前の縁取り・発光・光の輪の色がそれぞれ異なる（特性のカプセルも推し色）', () => {
    const pairs = [['red', 'orange'], ['red', 'pink'], ['sky', 'blue'], ['blue', 'purple'], ['yellow', 'orange'], ['white', 'black']] as const;
    for (const [a, b] of pairs) {
      const x = ssrAccentOf(oshiCardColor(a), true)!;
      const y = ssrAccentOf(oshiCardColor(b), true)!;
      for (const key of ['ring', 'glow', 'glow2', 'orbit'] as const) expect(x[key]).not.toBe(y[key]);
      expect(x.capsule).not.toEqual(y.capsule);
    }
  });

  it('ベーシックの白はピンクと見分けられる色（白銀）、黄色は名前の縁を濃い色にする', () => {
    const basic = (c: 'pink' | 'white' | 'yellow') => colorsIn(buildTcgCardImageElement(data(2, { color: c }), 'feed', 'basic'));
    const white = basic('white');
    expect(white.has('#AEB7CC')).toBe(true);
    expect(white.has('#E58BB0')).toBe(false);
    expect(basic('yellow').has('#A86A00')).toBe(true);
  });
});

describe('トレカ風：画像API', () => {
  const person = { name: '目黒蓮', group: 'Snow Man', candidates: [{ id: 'w1', title: '作品1', displayType: 'drama', typeLabel: 'ドラマ', year: 2020, url: '/work/w1' }] };
  beforeEach(() => { vi.mocked(loadOshiCardPerson).mockResolvedValue(person as never); });
  const get = (qs: string) => respondOshiCardImage(new NextRequest(`https://oshi-search.jp/api/oshi-card/image?${qs}`), { buildPath: (sel, size) => buildOshiCardImagePath(sel, size) });

  it('トレカ風は作品0件でも 200（1260×1760）、ノーマルは 400。指定した作品が全部無効なら 400', async () => {
    const ok = await get(`p=${P}&v=ssr`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-size')).toBe('1260x1760');
    expect((await get(`p=${P}`)).status).toBe(400);
    expect((await get(`p=${P}&w=nobody&v=basic`)).status).toBe(400);
    expect((await get(`p=${P}&w=w1&v=ssr&size=story`)).headers.get('x-size')).toBe('1080x1920');
  });

  it('正規形でなければ 308（既定値の明示・人物名と同じ名前・URLのような文字列は取り除く）', async () => {
    const res = await get(`p=${P}&w=w1&v=basic&nm=${P}&tr=${encodeURIComponent('https://spam.example.com')}&pw=9999&c=pink`);
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get('location')!).search).toBe(`?p=${P}&w=w1&v=basic`);
  });
});

describe('公開中のデザイン（レジェンドは未公開）', () => {
  it('cool・cute・basic・ssr だけを受け付け、legend は既定のデザインとして扱う', async () => {
    const { OSHI_CARD_VARIANTS, isOshiCardVariant, parseOshiCardVariant, OSHI_CARD_DEFAULT_VARIANT } = await import('@/lib/oshi-card/params');
    expect([...OSHI_CARD_VARIANTS]).toEqual(['cool', 'cute', 'basic', 'ssr']);
    for (const v of ['cool', 'cute', 'basic', 'ssr']) expect(parseOshiCardVariant(v)).toBe(v);
    expect(isOshiCardVariant('legend')).toBe(false);
    expect(parseOshiCardVariant('legend')).toBe(OSHI_CARD_DEFAULT_VARIANT);
  });

  it('デザインの選択肢にレジェンドを出さない', async () => {
    const { OSHI_CARD_VARIANT_OPTIONS } = await import('@/components/oshi-card/OshiCardVariantToggle');
    expect(OSHI_CARD_VARIANT_OPTIONS.map((o) => o.value)).toEqual(['cool', 'cute', 'basic', 'ssr']);
    expect(OSHI_CARD_VARIANT_OPTIONS.map((o) => o.label)).toEqual(['ノーマル', 'デコ', 'ベーシック', 'SSR']);
  });

  it('画像API：v=legend は既定のデザインの正規 URL へ 308（レジェンドの画像は作らない）', async () => {
    vi.mocked(loadOshiCardPerson).mockResolvedValue({ name: '目黒蓮', group: 'Snow Man', candidates: [{ id: 'w1', title: '作品1', displayType: 'drama', typeLabel: 'ドラマ', year: 2020, url: '/work/w1' }] } as never);
    const res = await respondOshiCardImage(new NextRequest(`https://oshi-search.jp/api/oshi-card/image?p=${encodeURIComponent('目黒蓮')}&w=w1&v=legend`), { buildPath: (sel, size) => buildOshiCardImagePath(sel, size) });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).not.toContain('v=');
  });
});
