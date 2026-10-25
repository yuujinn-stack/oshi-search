import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

vi.mock('server-only', () => ({}));
// image-response.ts が読み込む DB・フォント関連（このテストでは使わない）
vi.mock('@/lib/oshi-vod/data', () => ({ getOshiVodKnownPersons: vi.fn(), loadOshiVodDiagnosis: vi.fn() }));
vi.mock('@/server/instagram-post/fonts/font-loader', () => ({ getNotoSansJpBoldFontData: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));

import { buildOshiVodImageElement } from '@/server/oshi-vod/result-image';
import { isCanonicalImageQuery, isOverOshiVodImageRateLimit, OSHI_VOD_IMAGE_RATE_LIMIT_PER_MINUTE } from '@/server/oshi-vod/image-response';
import { buildOshiVodImagePath, buildOshiVodOgImagePath, parseImageSize } from '../oshi-vod/params';
import { buildOshiVodResultSocialMetadata } from '../oshi-vod/og-meta';
import { OSHI_VOD_DEFAULT_SHARE_VARIANT, OSHI_VOD_SHARE_VARIANTS, parseOshiVodShareVariant } from '../oshi-vod/share-variant';
import { buildSharedResultUrl, parseShareAttribution, OSHI_VOD_SHARE_VARIANT_PARAM } from '../oshi-vod/share';
import { parseOshiVodParams } from '../oshi-vod/params';
import type { OshiVodImageData } from '../oshi-vod/image-data';

/** 要素ツリーの文字だけを出現順に取り出す（関数コンポーネントは展開する） */
function collectText(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (typeof el.type === 'function') return collectText((el.type as (p: unknown) => ReactNode)(el.props), out);
    return collectText(el.props.children, out);
  }
  return out;
}

/** 文字が text の要素の style（関数コンポーネントは展開する） */
function findStyle(node: ReactNode, text: string): Record<string, unknown> | null {
  return findParent(node, text)?.self ?? null;
}

/** 文字が text の要素と、その親の最初の子の style（cool のサービス名の左にあるブランド色の帯） */
function findParent(node: ReactNode, text: string, parentFirst: Record<string, unknown> | null = null): { self: Record<string, unknown>; sibling: Record<string, unknown> | null } | null {
  if (Array.isArray(node)) {
    const first = node.find((n) => isValidElement(n)) as ReactElement<{ style?: Record<string, unknown> }> | undefined;
    for (const n of node) { const r = findParent(n, text, first?.props.style ?? null); if (r) return r; }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode; style?: Record<string, unknown> }>;
  if (typeof el.type === 'function') return findParent((el.type as (p: unknown) => ReactNode)(el.props), text, parentFirst);
  if (el.props.children === text) return { self: el.props.style ?? {}, sibling: parentFirst };
  return findParent(el.props.children, text, null);
}

const DATA: OshiVodImageData = {
  personNames: ['A', 'B', 'C'],
  top: { services: [{ service: 'unext', displayName: 'U-NEXT' }], tied: false, paidCount: 32, coverage: '74%', price: '月額2,189円（税込）' },
  paidTotal: 43,
  registered: 154,
  free: 12,
  pair: { services: [{ service: 'unext', displayName: 'U-NEXT' }, { service: 'hulu', displayName: 'Hulu' }], unionCount: 39, coverage: '91%' },
};

describe('oshi-vod シェア画像のデザイン（cool / cute）', () => {
  it('デザインの解析（不正値・未指定は既定）', () => {
    expect(parseOshiVodShareVariant('cute')).toBe('cute');
    expect(parseOshiVodShareVariant('cool')).toBe('cool');
    expect(parseOshiVodShareVariant(null)).toBe(OSHI_VOD_DEFAULT_SHARE_VARIANT);
    expect(parseOshiVodShareVariant('xxx')).toBe(OSHI_VOD_DEFAULT_SHARE_VARIANT);
    expect(parseOshiVodShareVariant(['cute', 'cool'])).toBe('cute');
  });

  it('画像URL：既定デザインは従来と同じURL、それ以外は v を付ける', () => {
    expect(buildOshiVodImagePath(['A'])).toBe('/api/oshi-vod/image?p=A');
    expect(buildOshiVodImagePath(['A'], 'feed', 'cool')).toBe('/api/oshi-vod/image?p=A');
    expect(buildOshiVodImagePath(['A'], 'feed', 'cute')).toBe('/api/oshi-vod/image?p=A&v=cute');
    expect(buildOshiVodImagePath(['A'], 'story', 'cute')).toBe('/api/oshi-vod/image?p=A&size=story&v=cute');
  });

  it('両デザインとも、全サイズに必要な情報（推し名・結果・作品数・カバー率・料金・CTA・推しサーチ名・URL）を載せる', () => {
    // レイアウト・飾りの文字（FOR・COVERAGE・♡ 等）はデザインごとに違うため、文字の完全一致ではなく必須情報で確認する
    for (const v of OSHI_VOD_SHARE_VARIANTS) {
      for (const size of ['feed', 'story', 'og'] as const) {
        const text = collectText(buildOshiVodImageElement(DATA, size, v)).join('|');
        for (const must of ['A', 'B', 'C', 'U-NEXT', '推しの作品数 1位', '32', '/ 43作品', '74%', 'カバー率', '月額2,189円（税込）', '推しサーチ', 'oshi-search.jp/oshi-vod', 'あなたの推しでも調べてみて']) {
          expect(text, `${v}/${size}: ${must}`).toContain(must);
        }
        expect(text.includes('推しに合うサブスク診断') || text.includes('推しに合う|サブスク診断'), `${v}/${size}: 診断名`).toBe(true);
      }
      // 縦長は見出し・根拠・2サービスまで載せる（OG は縮小・正方形の切り抜きで表示されるため結果と誘導に絞る）
      for (const size of ['feed', 'story'] as const) {
        const text = collectText(buildOshiVodImageElement(DATA, size, v)).join('|');
        // 推し名の見出し：cool はクレジット表記（FOR）、cute はラベル（わたしの推し）
        expect(text).toContain(v === 'cool' ? 'FOR' : 'わたしの推し');
        expect(text).toContain('有料サブスクで見放題の推し作品 43作品で比較');
        expect(text).toContain('2サービスなら');
        expect(text).toContain('U-NEXT ＋ Hulu 39作品（91%）');
      }
      // 1位が無いとき・同率のとき
      for (const size of ['feed', 'story', 'og'] as const) {
        expect(collectText(buildOshiVodImageElement({ ...DATA, top: null, pair: null }, size, v)).join('|')).toContain('有料サブスクで見放題の作品は確認できませんでした');
        const tied = { ...DATA, top: { ...DATA.top!, tied: true, price: null, services: [{ service: 'unext', displayName: 'U-NEXT' }, { service: 'hulu', displayName: 'Hulu' }] } };
        const t = collectText(buildOshiVodImageElement(tied, size, v)).join('|');
        expect(t).toContain('推しの作品数 同率1位');
        expect(t).toContain('Hulu');
      }
    }
  });

  it('かっこいい・可愛いは別のレイアウト（色違いではない）', () => {
    const cool = collectText(buildOshiVodImageElement(DATA, 'feed', 'cool')).join('|');
    const cute = collectText(buildOshiVodImageElement(DATA, 'feed', 'cute')).join('|');
    expect(cool).not.toBe(cute);
    expect(cool).toContain('FOR');
    expect(cute).toContain('♡ わたしの推し ♡');
  });

  it('配色が登録されていないサービスは色を推測せず、デザインの色で描く（登録済みはブランド色のまま）', () => {
    const nogi: OshiVodImageData = { ...DATA, top: { ...DATA.top!, services: [{ service: 'のぎ動画', displayName: 'のぎ動画' }] }, pair: null };
    // cool：サービス名の左の縦帯。未登録は黄色、U-NEXT は登録済みの色
    expect(findParent(buildOshiVodImageElement(nogi, 'feed', 'cool'), 'のぎ動画')?.sibling?.backgroundColor).toBe('#FEE34F');
    expect(findParent(buildOshiVodImageElement(DATA, 'feed', 'cool'), 'U-NEXT')?.sibling?.backgroundColor).toBe('#0D0D0D');
    // cute：サービス名のシール。未登録は紺、U-NEXT は登録済みの色
    expect(findStyle(buildOshiVodImageElement(nogi, 'feed', 'cute'), 'のぎ動画')?.backgroundColor).toBe('#1A2147');
    expect(findStyle(buildOshiVodImageElement(DATA, 'feed', 'cute'), 'U-NEXT')?.backgroundColor).toBe('#0D0D0D');
    // 既定の灰色（#374151）はどこにも使わない
    for (const v of OSHI_VOD_SHARE_VARIANTS) {
      expect(JSON.stringify(buildOshiVodImageElement(nogi, 'feed', v))).not.toContain('#374151');
    }
  });

  it('OG画像のパスは /api/ の外（robots.txt でクロール禁止のため）・サイズは og も受け付ける', () => {
    expect(buildOshiVodOgImagePath(['A', 'B'])).toBe('/oshi-vod/og?p=A&p=B');
    expect(buildOshiVodOgImagePath(['A'], 'cute')).toBe('/oshi-vod/og?p=A&v=cute');
    expect(buildOshiVodImagePath(['A'], 'og', 'cute')).toBe('/api/oshi-vod/image?p=A&size=og&v=cute');
    expect(parseImageSize('og')).toBe('og');
  });
});

describe('oshi-vod 結果画像の入力の正規化・アクセス上限', () => {
  const q = (s: string) => new URLSearchParams(s);
  const shape = { names: ['A', 'B'], size: 'feed' as const, variant: 'cool' as const };

  it('正規形だけを受け付ける（既定値の明示・重複・未知のキー・存在しない人物は正規形へ転送）', () => {
    expect(isCanonicalImageQuery(q('p=A&p=B'), shape, false)).toBe(true);
    expect(isCanonicalImageQuery(q('p=A&p=B&v=cool'), shape, false)).toBe(false);
    expect(isCanonicalImageQuery(q('p=A&p=B&size=feed'), shape, false)).toBe(false);
    expect(isCanonicalImageQuery(q('p=A&p=B&utm_source=x'), shape, false)).toBe(false);
    expect(isCanonicalImageQuery(q('p=A&p=A&p=B'), shape, false)).toBe(false);
    expect(isCanonicalImageQuery(q('p=A&p=X&p=B'), shape, false)).toBe(false);
    expect(isCanonicalImageQuery(q('p=A&p=B&size=story&v=cute'), { ...shape, size: 'story', variant: 'cute' }, false)).toBe(true);
    // /oshi-vod/og は size を受け付けない
    expect(isCanonicalImageQuery(q('p=A&p=B&v=cute'), { ...shape, size: 'og', variant: 'cute' }, true)).toBe(true);
    expect(isCanonicalImageQuery(q('p=A&p=B&size=og&v=cute'), { ...shape, size: 'og', variant: 'cute' }, true)).toBe(false);
  });

  it('IPごと1分あたりの上限（Redis なし・失敗時は制限しない）', async () => {
    const counts = new Map<string, number>();
    const store = {
      incr: async (k: string) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; },
      expire: async () => 1,
    };
    const now = 1_700_000_000_000;
    for (let i = 0; i < OSHI_VOD_IMAGE_RATE_LIMIT_PER_MINUTE; i++) {
      expect(await isOverOshiVodImageRateLimit('1.1.1.1', store, now)).toBe(false);
    }
    expect(await isOverOshiVodImageRateLimit('1.1.1.1', store, now)).toBe(true);
    expect(await isOverOshiVodImageRateLimit('2.2.2.2', store, now)).toBe(false);
    expect(await isOverOshiVodImageRateLimit('1.1.1.1', store, now + 60_000)).toBe(false);
    expect(await isOverOshiVodImageRateLimit('1.1.1.1', null, now)).toBe(false);
    const broken = { incr: async () => { throw new Error('down'); }, expire: async () => 1 };
    expect(await isOverOshiVodImageRateLimit('1.1.1.1', broken, now)).toBe(false);
  });
});

describe('oshi-vod 結果URLの X・LINE カード', () => {
  it('結果と共有元のデザインのカード画像・共有URLを指定する', () => {
    const m = buildOshiVodResultSocialMetadata({
      names: ['A', 'B'], variant: 'cute', siteOrigin: 'https://oshi-search.jp', description: 'D', baseOpenGraph: { type: 'website' },
    });
    const og = m.openGraph as { url: string; title: string; images: { url: string; width: number; height: number }[]; type: string };
    expect(og.type).toBe('website');
    expect(og.title).toBe('A・Bに合うサブスク診断結果');
    expect(og.url).toBe('https://oshi-search.jp/oshi-vod?p=A&p=B&sv=cute');
    expect(og.images[0]).toMatchObject({ url: '/oshi-vod/og?p=A&p=B&v=cute', width: 1200, height: 630 });
    const tw = m.twitter as { card: string; images: { url: string }[] };
    expect(tw.card).toBe('summary_large_image');
    expect(tw.images[0].url).toBe('/oshi-vod/og?p=A&p=B&v=cute');
    const cool = buildOshiVodResultSocialMetadata({ names: ['A'], variant: 'cool', siteOrigin: 'https://oshi-search.jp', description: 'D', baseOpenGraph: {} });
    expect((cool.openGraph as { url: string }).url).toBe('https://oshi-search.jp/oshi-vod?p=A');
    expect((cool.openGraph as { images: { url: string }[] }).images[0].url).toBe('/oshi-vod/og?p=A');
  });
});

describe('oshi-vod 共有リンク経由の計測パラメータ', () => {
  it('共有URLに sv / sm を付ける', () => {
    expect(buildSharedResultUrl('https://oshi-search.jp/oshi-vod?p=A', { variant: 'cute', method: 'x' }))
      .toBe('https://oshi-search.jp/oshi-vod?p=A&sv=cute&sm=x');
    expect(buildSharedResultUrl('https://oshi-search.jp/oshi-vod', { variant: 'cool', method: 'line' }))
      .toBe('https://oshi-search.jp/oshi-vod?sv=cool&sm=line');
  });

  it('訪問時の判定（デザイン不明なら共有経由にしない・方法不明は copy）', () => {
    expect(parseShareAttribution({ sv: 'cute', sm: 'line' })).toEqual({ variant: 'cute', method: 'line' });
    expect(parseShareAttribution({ sv: 'cool', sm: 'zzz' })).toEqual({ variant: 'cool', method: 'copy' });
    expect(parseShareAttribution({ sv: 'zzz', sm: 'x' })).toBeNull();
    expect(parseShareAttribution({ p: 'A' })).toBeNull();
  });

  it('sv / sm は診断に使わない（人物の解析結果が変わらない）', () => {
    const plain = parseOshiVodParams({ p: ['A', 'B'] });
    const shared = parseOshiVodParams({ p: ['A', 'B'], [OSHI_VOD_SHARE_VARIANT_PARAM]: 'cute', sm: 'x' });
    expect(shared).toEqual(plain);
  });
});
