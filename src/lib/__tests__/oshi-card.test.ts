import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/oshi-card/data', () => ({ loadOshiCardPerson: vi.fn() }));
vi.mock('@/lib/oshi-vod/data', () => ({ getOshiVodKnownPersons: vi.fn(), loadOshiVodDiagnosis: vi.fn() }));
vi.mock('@/server/instagram-post/fonts/font-loader', () => ({ getNotoSansJpBoldFontData: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));

import {
  OSHI_CARD_PHRASES,
  buildOshiCardEditPath,
  buildOshiCardImagePath,
  buildOshiCardOgImagePath,
  buildOshiCardResultPath,
  buildOshiCardSharedUrl,
  oshiCardPhraseText,
  parseOshiCardParams,
  type OshiCardSelection,
} from '../oshi-card/params';
import { buildOshiCardCandidates, buildOshiCardShareText, resolveOshiCardWorks, textUnits, truncateUnits } from '../oshi-card/core';
import { buildOshiCardSocialMetadata } from '../oshi-card/og-meta';
import { buildOshiCardImageElement, type OshiCardImageData } from '@/server/oshi-card/card-image';
import { isCanonicalCardQuery } from '@/server/oshi-card/image-response';
import { isOverRenderRateLimit } from '@/server/share-image/rate-limit';
import type { WorkRecord } from '@/types/work';

function work(id: string, title: string, type: WorkRecord['type'], year?: number, extra: Partial<WorkRecord> = {}): WorkRecord {
  return { id, personName: 'A', title, normalizedTitle: title, type, source: 'tmdb', confidenceScore: 1, status: 'auto_published', createdAt: 0, updatedAt: 0, releaseYear: year, ...extra } as WorkRecord;
}

function collectText(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, out)); return out; }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (typeof el.type === 'function') return collectText((el.type as (p: unknown) => ReactNode)(el.props), out);
    return collectText(el.props.children, out);
  }
  return out;
}

const SEL: OshiCardSelection = { person: '目黒蓮', workIds: ['w1', 'w2'], variant: 'cool', phrase: 'fukyo' };

describe('推し布教カード：URL', () => {
  it('解析：人物1人・作品は重複と空を除いて最大3件・指定順、v・ph は許可値のみ', () => {
    const p = parseOshiCardParams({ p: ' 目黒蓮 ', w: ['b', 'a', 'b', '', 'c', 'd'], v: 'cute', ph: 'numa', sm: 'line', from: 'person' });
    expect(p.person).toBe('目黒蓮');
    expect(p.workIds).toEqual(['b', 'a', 'c']);
    expect(p.workOverflow).toBe(true);
    expect(p.variant).toBe('cute');
    expect(p.phrase).toBe('numa');
    expect(p.shareMethod).toBe('line');
    expect(p.from).toBe('person');
    const q = parseOshiCardParams({ p: 'x'.repeat(61), v: 'evil', ph: '<script>', sm: 'mail', from: 'spam' });
    expect(q.person).toBeNull();
    expect(q.variant).toBe('cool');
    expect(q.phrase).toBe('fukyo');
    expect(q.shareMethod).toBeNull();
    expect(q.from).toBeNull();
  });

  it('組み立て：既定値は省略、順序はそのまま、共有URLには sm を付ける', () => {
    expect(buildOshiCardResultPath(SEL)).toBe('/oshi-card?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w1&w=w2');
    expect(buildOshiCardResultPath({ ...SEL, workIds: ['w2', 'w1'], variant: 'cute', phrase: 'numa' })).toBe('/oshi-card?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w2&w=w1&v=cute&ph=numa');
    expect(buildOshiCardImagePath(SEL, 'story')).toBe('/api/oshi-card/image?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w1&w=w2&size=story');
    expect(buildOshiCardOgImagePath(SEL)).toBe('/oshi-card/og?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w1&w=w2');
    expect(buildOshiCardSharedUrl('https://oshi-search.jp', SEL, 'x')).toBe('https://oshi-search.jp/oshi-card?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w1&w=w2&sm=x');
    expect(buildOshiCardEditPath('目黒蓮', { from: 'person' })).toBe('/oshi-card?p=%E7%9B%AE%E9%BB%92%E8%93%AE&from=person');
    expect(buildOshiCardEditPath('目黒蓮', { selection: { workIds: ['w1'], variant: 'cute', phrase: 'fukyo' } })).toBe('/oshi-card?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w1&v=cute&edit=1');
    // 往復しても同じ内容になる（URLから再現できる）
    const back = parseOshiCardParams(Object.fromEntries(['p', 'w', 'v', 'ph'].map((k) => [k, new URLSearchParams(buildOshiCardResultPath({ ...SEL, workIds: ['w3', 'w1', 'w2'], variant: 'cute', phrase: 'again' }).split('?')[1]).getAll(k)])));
    expect(back).toMatchObject({ person: '目黒蓮', workIds: ['w3', 'w1', 'w2'], variant: 'cute', phrase: 'again' });
  });

  it('ひとことは定型フレーズだけ（自由入力なし）', () => {
    expect(OSHI_CARD_PHRASES.length).toBeGreaterThanOrEqual(3);
    expect(oshiCardPhraseText('fukyo')).toBe('私の推しを布教します');
  });
});

describe('推し布教カード：作品', () => {
  const works = [
    work('w-old', '古い作品', 'movie', 2010),
    work('w-new', '新しいドラマ', 'tv', 2024),
    work('w-new', '新しいドラマ（重複行）', 'tv', 2024),
    work('w-none', '年なし', 'variety'),
    work('w-alias', '統合元', 'movie', 2020, { canonicalWorkId: 'w-canon' }),
    work('w-empty', '  ', 'movie', 2022),
  ];
  const cands = buildOshiCardCandidates(works);

  it('候補：その人物の公開作品だけ・id の重複と空の作品名を除き、公開年の新しい順。分類は既存の表示分類、リンクは作品ページ', () => {
    expect(cands.map((c) => c.id)).toEqual(['w-new', 'w-alias', 'w-old', 'w-none']);
    expect(cands[0]).toMatchObject({ title: '新しいドラマ', typeLabel: 'ドラマ', year: 2024, url: '/work/w-new' });
    expect(cands.find((c) => c.id === 'w-alias')?.url).toBe('/work/w-canon');
    expect(cands.find((c) => c.id === 'w-none')?.year).toBeNull();
  });

  it('検証：存在しない・他の人物の id は除き、指定順のまま最大3件', () => {
    expect(resolveOshiCardWorks(['w-old', 'nobody', 'w-new'], cands)).toEqual({ works: [cands[2], cands[0]], invalidIds: ['nobody'] });
    expect(resolveOshiCardWorks(['x', 'y'], cands).works).toEqual([]);
    expect(resolveOshiCardWorks(['w-new'], cands).works.map((w) => w.id)).toEqual(['w-new']);
    expect(resolveOshiCardWorks(['w-new', 'w-alias', 'w-old', 'w-none'], cands).works).toHaveLength(3);
  });

  it('共有文・長い作品名の切り詰め（サロゲートペアを壊さない）', () => {
    expect(buildOshiCardShareText('目黒蓮', [{ title: 'A' }, { title: 'B' }])).toBe('目黒蓮の布教カードを作りました！おすすめは「A」「B」。あなたの推しでも作ってみて');
    const long = 'うちの執事が言うことには〜長いサブタイトルが入る作品名のテスト用の文字列〜';
    const t = truncateUnits(long, 12);
    expect(t.endsWith('…')).toBe(true);
    expect(textUnits(t)).toBeLessThanOrEqual(12);
    expect(truncateUnits('短い', 12)).toBe('短い');
    expect(truncateUnits('😀😀😀😀😀😀😀😀😀😀😀😀😀😀', 5)).not.toMatch(/\uD83D$/);
  });
});

describe('推し布教カード：画像', () => {
  const data = (n: number, title = '作品'): OshiCardImageData => ({
    person: '目黒蓮', group: 'Snow Man', phrase: '私の推しを布教します',
    works: Array.from({ length: n }, (_, i) => ({ title: `${title}${i + 1}`, typeLabel: 'ドラマ', year: 2020 + i })),
  });

  it('両デザイン・全サイズに、推し名・ひとこと・作品（番号つき・指定順）・推しサーチ名・URL・誘導を載せる', () => {
    for (const v of ['cool', 'cute'] as const) for (const size of ['feed', 'story', 'og'] as const) for (const n of [1, 3]) {
      const text = collectText(buildOshiCardImageElement(data(n), size, v)).join('|');
      for (const must of ['目黒蓮', '私の推しを布教します', '推しサーチ', 'oshi-search.jp/oshi-card', 'あなたの推しでも作ってみて']) expect(text, `${v}/${size}/${n}: ${must}`).toContain(must);
      for (let i = 1; i <= n; i++) expect(text).toContain(`作品${i}`);
      expect(text.indexOf('作品1')).toBeLessThan(n > 1 ? text.indexOf(`作品${n}`) : Infinity);
      if (size !== 'og') {
        expect(text).toContain('公式の順位ではありません');
        expect(text).toContain('ドラマ・2020');
      }
    }
    expect(collectText(buildOshiCardImageElement(data(3), 'feed', 'cool')).join('|')).toContain('03');
  });

  it('長めの作品名は文字を小さくして全文を出し、「…」は付けない', () => {
    const t = '30-DELUX ACTION PLAY MUSICAL THEATER featuring 宇宙Six『のべつまくなし』';
    const d: OshiCardImageData = { ...data(1), works: [{ title: t, typeLabel: '舞台・ミュージカル', year: 2019 }] };
    for (const v of ['cool', 'cute'] as const) for (const size of ['feed', 'story', 'og'] as const) {
      const text = collectText(buildOshiCardImageElement(d, size, v)).join('|');
      expect(text, `${v}/${size}`).toContain(t);
      expect(text).not.toContain(`${t}…`);
    }
  });

  it('長い作品名は「…」で切り詰める（レイアウトを崩さない）', () => {
    const long = data(1, 'とても長い作品名'.repeat(10));
    for (const v of ['cool', 'cute'] as const) for (const size of ['feed', 'og'] as const) {
      const text = collectText(buildOshiCardImageElement(long, size, v)).join('|');
      expect(text).toContain('…');
      expect(text).not.toContain('とても長い作品名'.repeat(10));
    }
  });
});

describe('推し布教カード：入力の正規化・アクセス上限・OG', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('正規形だけを受け付ける', () => {
    expect(isCanonicalCardQuery(q('p=A&w=1&w=2'), { ...SEL, person: 'A', workIds: ['1', '2'] }, 'feed', false)).toBe(true);
    expect(isCanonicalCardQuery(q('p=A&w=2&w=1'), { ...SEL, person: 'A', workIds: ['1', '2'] }, 'feed', false)).toBe(false);
    expect(isCanonicalCardQuery(q('p=A&w=1&v=cool'), { ...SEL, person: 'A', workIds: ['1'] }, 'feed', false)).toBe(false);
    expect(isCanonicalCardQuery(q('p=A&w=1&ph=fukyo'), { ...SEL, person: 'A', workIds: ['1'] }, 'feed', false)).toBe(false);
    expect(isCanonicalCardQuery(q('p=A&w=1&utm=x'), { ...SEL, person: 'A', workIds: ['1'] }, 'feed', false)).toBe(false);
    expect(isCanonicalCardQuery(q('p=A&w=1&v=cute&ph=numa&size=story'), { person: 'A', workIds: ['1'], variant: 'cute', phrase: 'numa' }, 'story', false)).toBe(true);
    expect(isCanonicalCardQuery(q('p=A&w=1&size=og'), { ...SEL, person: 'A', workIds: ['1'] }, 'og', true)).toBe(false);
  });

  it('IP ごと1分あたりの上限（Redis なし・失敗時は制限しない）', async () => {
    const counts = new Map<string, number>();
    const store = { incr: async (k: string) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n; }, expire: async () => 1 };
    for (let i = 0; i < 3; i++) expect(await isOverRenderRateLimit('t', 'ip', 3, store, 0)).toBe(false);
    expect(await isOverRenderRateLimit('t', 'ip', 3, store, 0)).toBe(true);
    expect(await isOverRenderRateLimit('t', 'ip', 3, store, 60_000)).toBe(false);
    expect(await isOverRenderRateLimit('t', 'ip', 3, null, 0)).toBe(false);
    expect(await isOverRenderRateLimit('t', 'ip', 3, { incr: async () => { throw new Error('x'); }, expire: async () => 1 }, 0)).toBe(false);
  });

  it('カードのURLの X・LINE カード：そのカードの OG 画像・共有URL', () => {
    const m = buildOshiCardSocialMetadata({ selection: { ...SEL, variant: 'cute' }, titles: ['A', 'B'], siteOrigin: 'https://oshi-search.jp', baseOpenGraph: { type: 'website' } });
    const og = m.openGraph as { title: string; url: string; images: { url: string; width: number; height: number }[] };
    expect(og.title).toBe('目黒蓮の布教カード｜推しサーチ');
    expect(og.url).toBe('https://oshi-search.jp/oshi-card?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w1&w=w2&v=cute');
    expect(og.images[0]).toMatchObject({ url: '/oshi-card/og?p=%E7%9B%AE%E9%BB%92%E8%93%AE&w=w1&w=w2&v=cute', width: 1200, height: 630 });
    expect((m.twitter as { card: string }).card).toBe('summary_large_image');
  });
});
