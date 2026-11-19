import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// next/font はビルド時の変換が必要なため、テストではクラス名だけを返す
vi.mock('next/font/google', () => ({ Noto_Sans_JP: () => ({ variable: 'font-d1-var', className: 'font-d1' }) }));
// アフィリエイト枠（DBを読むサーバーコンポーネント）は代わりの表示（fallback）だけを描く
vi.mock('@/components/site/AffiliateSlot', () => ({ default: ({ fallback }: { fallback?: React.ReactNode }) => fallback ?? null }));

import {
  DEFAULT_WORK_IMAGE_DISPLAY_MODE,
  formatD1Meta,
  getD1TitleSize,
  getD1TitleWeightedLength,
  isWorkImageDisplayMode,
  resolveWorkVisual,
  resolveWorkVisualFromUrl,
} from '@/lib/work-image-display';
import WorkD1Visual from '@/components/work-visual/WorkD1Visual';
import WorkCard from '@/components/WorkCard';
import VodWorkCard from '@/components/VodWorkCard';
import StreamingNowSection from '@/components/site/StreamingNowSection';
import type { WorkRecord } from '@/types/work';
import type { VodPageWork } from '@/lib/vod-page';

const TMDB = 'https://image.tmdb.org/t/p/w500/abc.jpg';
const OG = 'https://example.com/og.jpg';
const MANUAL = 'https://example.com/manual.jpg';

function work(over: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: 'w1',
    personName: '山田太郎',
    title: 'テスト作品',
    normalizedTitle: 'テスト作品',
    type: 'tv',
    source: 'tmdb',
    releaseYear: 2024,
    posterUrl: TMDB,
    confidenceScore: 0,
    status: 'auto_published',
    vodProviders: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('表示方式の値', () => {
  it('既定値は従来画像表示（デプロイしただけでは見た目が変わらない）', () => {
    expect(DEFAULT_WORK_IMAGE_DISPLAY_MODE).toBe('legacy');
  });
  it('d1 / legacy 以外は不正', () => {
    expect(isWorkImageDisplayMode('d1')).toBe(true);
    expect(isWorkImageDisplayMode('legacy')).toBe(true);
    for (const v of ['D1', '', null, undefined, 1, 'official']) expect(isWorkImageDisplayMode(v)).toBe(false);
  });
});

describe('resolveWorkVisual', () => {
  it('legacy は従来の優先順位（手動 > TMDb > OG）の画像をそのまま使う', () => {
    expect(resolveWorkVisual({ manualImageUrl: MANUAL, posterUrl: TMDB, ogImageUrl: OG }, 'legacy')).toEqual({ kind: 'image', url: MANUAL, licensed: false });
    expect(resolveWorkVisual({ posterUrl: TMDB, ogImageUrl: OG }, 'legacy')).toEqual({ kind: 'image', url: TMDB, licensed: false });
    expect(resolveWorkVisual({ ogImageUrl: 'https://example.com/a.jpg?x=1&amp;y=2' }, 'legacy')).toEqual({ kind: 'image', url: 'https://example.com/a.jpg?x=1&y=2', licensed: false });
    expect(resolveWorkVisual({}, 'legacy')).toEqual({ kind: 'none' });
  });
  it('d1 は従来の画像URLを返さない（画像の有無に関係なく D-1）', () => {
    expect(resolveWorkVisual({ manualImageUrl: MANUAL, posterUrl: TMDB, ogImageUrl: OG }, 'd1')).toEqual({ kind: 'd1' });
    expect(resolveWorkVisual({}, 'd1')).toEqual({ kind: 'd1' });
    expect(resolveWorkVisualFromUrl(TMDB, 'd1')).toEqual({ kind: 'd1' });
  });
  it('将来用：許諾済みの公式画像は D-1 表示中でも優先する（不正なURLは無視）', () => {
    expect(resolveWorkVisual({ posterUrl: TMDB, licensedImageUrl: 'https://official.example.jp/key.jpg' }, 'd1'))
      .toEqual({ kind: 'image', url: 'https://official.example.jp/key.jpg', licensed: true });
    expect(resolveWorkVisual({ posterUrl: TMDB, licensedImageUrl: 'javascript:alert(1)' }, 'd1')).toEqual({ kind: 'd1' });
    expect(resolveWorkVisualFromUrl(TMDB, 'd1', 'https://official.example.jp/key.jpg').kind).toBe('image');
  });
  it('resolveWorkVisualFromUrl の legacy は渡したURLをそのまま使う', () => {
    expect(resolveWorkVisualFromUrl(TMDB, 'legacy')).toEqual({ kind: 'image', url: TMDB, licensed: false });
    expect(resolveWorkVisualFromUrl(undefined, 'legacy')).toEqual({ kind: 'none' });
    expect(resolveWorkVisualFromUrl('', 'legacy')).toEqual({ kind: 'none' });
  });
});

describe('D-1 のタイトルの大きさ・上部の表示', () => {
  it('短い・長い・英語・記号混じりで段階的に小さくなる', () => {
    expect(getD1TitleSize('海')).toBe('xl');
    expect(getD1TitleSize('ドラゴン桜')).toBe('xl');
    expect(getD1TitleSize('silent')).toBe('xl'); // 半角6文字 = 3.3
    expect(getD1TitleSize('君の名前で僕を呼んで')).toBe('m');
    expect(getD1TitleSize('【推し活】Re:スタート!! ～第2章～ #A&B')).toBe('s');
    expect(getD1TitleSize('The Extraordinarily Long Adventures of Somebody Unforgettable')).toBe('xs');
    expect(getD1TitleSize('君の名前で僕を呼んで、そしてまた明日の朝に会いに行くための長い長い物語 〜特別編・完全版〜')).toBe('xxs');
    expect(getD1TitleSize('あ'.repeat(80))).toBe('min');
  });
  it('半角は全角の約半分として数える（絵文字・サロゲートペアも1文字）', () => {
    expect(getD1TitleWeightedLength('ABCD')).toBe(2.2);
    expect(getD1TitleWeightedLength('あいう')).toBe(3);
    expect(getD1TitleWeightedLength('🎬作品')).toBe(3);
    expect(getD1TitleWeightedLength('  海  ')).toBe(1);
  });
  it('公開年・種類が不明な場合はその項目を出さない', () => {
    expect(formatD1Meta('ドラマ', 2024)).toBe('ドラマ · 2024');
    expect(formatD1Meta('ドラマ', undefined)).toBe('ドラマ');
    expect(formatD1Meta(undefined, 2024)).toBe('2024');
    expect(formatD1Meta('', 0)).toBe('');
    expect(formatD1Meta(null, null)).toBe('');
  });
});

describe('WorkD1Visual', () => {
  it('作品名を全文 HTML テキストで描き、OSHI SEARCH は読み上げない', () => {
    const long = '君の名前で僕を呼んで、そしてまた明日の朝に会いに行くための長い長い物語 〜特別編・完全版〜';
    const html = renderToStaticMarkup(<WorkD1Visual title={long} typeLabel="ドラマ" releaseYear={2021} />);
    expect(html).toContain(long);
    expect(html).toMatch(/ドラマ<\/span><span class="work-d1__meta-part">· 2021/);
    expect(html).toContain('data-size="xxs"');
    expect(html).toMatch(/<span class="work-d1__brand" aria-hidden="true">OSHI SEARCH<\/span>/);
    expect(html).not.toContain('<img');
  });
  it('記号を含む作品名もエスケープして表示する', () => {
    const html = renderToStaticMarkup(<WorkD1Visual title={'<b>A&B</b> "x"'} />);
    expect(html).toContain('&lt;b&gt;A&amp;B&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });
  it('compact は作品名を描かない（横にある作品名と重複させない）', () => {
    const html = renderToStaticMarkup(<WorkD1Visual title="秘密の作品名" typeLabel="映画" variant="compact" />);
    expect(html).not.toContain('秘密の作品名');
    expect(html).toContain('映画');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('WorkCard（人物・グループページの作品カード）', () => {
  it('引数なし（従来画像表示）は従来どおり画像とカード下の作品名を表示する', () => {
    const html = renderToStaticMarkup(<WorkCard work={work()} />);
    expect(html).toContain(`src="${TMDB}"`);
    expect(html).toContain('work-card-title');
    expect(html).not.toContain('work-d1');
  });
  it('D-1 では従来画像を読み込まず、作品名はカード内に1回だけ', () => {
    const w = work({ manualImageUrl: MANUAL, ogImageUrl: OG, roleName: '主人公' });
    const html = renderToStaticMarkup(<WorkCard work={w} imageMode="d1" />);
    expect(html).not.toContain('<img');
    for (const u of [TMDB, MANUAL, OG]) expect(html).not.toContain(`src="${u}"`);
    expect(html.split('テスト作品').length - 1).toBe(1);
    expect(html).not.toContain('work-card-title');
    expect(html).toContain('>ドラマ</span><span class="work-d1__meta-part">· 2024<');
    expect(html).toContain('役: 主人公');
    expect(html).toContain('作品詳細 →');
  });
  it('D-1 は画像のない作品・公開年不明の作品にも使う', () => {
    const html = renderToStaticMarkup(<WorkCard work={work({ posterUrl: undefined, releaseYear: undefined })} imageMode="d1" />);
    expect(html).toContain('work-d1');
    expect(html).not.toContain('画像なし');
    expect(html).not.toContain('2024');
  });
  it('配信サービスのロゴは D-1 でも従来どおり表示する', () => {
    const w = work({
      vodProviders: [{ providerId: 8, providerName: 'Netflix', logoPath: '/netflix.jpg', type: 'flatrate', source: 'tmdb_watch_provider', countryCode: 'JP' } as NonNullable<WorkRecord['vodProviders']>[number]],
    });
    const legacy = renderToStaticMarkup(<WorkCard work={w} />);
    const d1 = renderToStaticMarkup(<WorkCard work={w} imageMode="d1" />);
    expect(d1).toContain('Netflix');
    expect(d1).toContain('配信中');
    // ロゴの描画は従来と同じ（作品画像ではないため D-1 の対象外）
    const logo = (s: string) => s.match(/<img[^>]*netflix[^>]*>/i)?.[0] ?? null;
    expect(logo(d1)).toBe(logo(legacy));
  });
});

describe('VodWorkCard（/vod・推しのサブスク診断）', () => {
  const vw: VodPageWork = {
    workId: 'w1', title: 'VOD作品', releaseYear: 2020, displayTypeLabel: '映画', displayTypeIcon: '🎬',
    posterUrl: TMDB, availabilityType: 'flatrate', detailUrl: '/work/w1', mainCastNames: ['山田太郎'], totalCastCount: 1,
  };
  it('従来は画像あり、D-1 は画像なしで作品名1回・見放題・出演者を表示', () => {
    expect(renderToStaticMarkup(<VodWorkCard work={vw} />)).toContain(`src="${TMDB}"`);
    const html = renderToStaticMarkup(<VodWorkCard work={vw} imageMode="d1" />);
    expect(html).not.toContain('<img');
    expect(html.split('VOD作品').length - 1).toBe(1);
    expect(html).toContain('>映画</span><span class="work-d1__meta-part">· 2020<');
    expect(html).toContain('見放題');
    expect(html).toContain('山田太郎');
  });
});

describe('StreamingNowSection（人物ページ「今すぐ見られる作品」）', () => {
  it('D-1 では小さなサムネイルに作品名を描かず、横の作品名だけを残す', () => {
    const w = work({
      vodProviders: [{ providerId: 8, providerName: 'Netflix', type: 'flatrate', source: 'tmdb_watch_provider', countryCode: 'JP' } as NonNullable<WorkRecord['vodProviders']>[number]],
    });
    const html = renderToStaticMarkup(<StreamingNowSection works={[w]} terminatedSlugs={new Set()} imageMode="d1" />);
    expect(html).not.toContain(`src="${TMDB}"`);
    expect(html).toContain('work-d1--compact');
    expect(html.split('テスト作品').length - 1).toBe(1);
    const legacy = renderToStaticMarkup(<StreamingNowSection works={[w]} terminatedSlugs={new Set()} />);
    expect(legacy).toContain(`src="${TMDB}"`);
  });
});
