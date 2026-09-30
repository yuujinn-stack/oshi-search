import 'server-only';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { getPublishedWorks } from '@/lib/work-store';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { deduplicateProviders, isConfirmedVodAvailability, normalizeProviderName, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { getDisplayWorkType } from '@/lib/work-display-type';
import { getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import { getAllDisplayOrders } from '@/lib/product-order-store';
import { getPersonMeta } from '@/lib/person-meta';
import { calcDisplayTier, calcDisplayScore, type PersonDisplayContext } from '@/lib/product-display-score';
import type { WorkRecord } from '@/types/work';
import type { VodProvider } from '@/types/vod';
import type { ProductCategory, RakutenItem } from '@/types/rakuten';
import { isUsableCanvaImageUrl } from '../../../../tools/canva-instagram/work-selection';
import { isYouTubeProvider } from '../build-post-search-flow';
import { PersonNotFoundError } from '../person-data';

/**
 * 推しサーチの人物ページ（src/app/person/[slug]/page.tsx）と同じ手順で、
 * 出演作品・配信中の作品・配信サービス・関連商品を集計する。Preview専用テンプレート（F〜I）用。読み取り専用。
 *
 * 人物ページの該当ロジック（getStreamingProviders・商品の verdict 判定・classifyProduct・DISPLAY_SECTIONS・
 * applyDisplayOrder・sortUsedProducts）は page.tsx 内のローカル関数で export されておらず、
 * page.tsx は変更しない方針のため、ここに同じ処理を写している。
 * 人物ページ側のロジックを変更した場合は、ここも合わせて更新すること（数字がサイト表示とずれないように）。
 */

// ─── VOD（page.tsx の getStreamingProviders と同一：見放題・無料・広告付きのみ） ───
function getStreamingProviders(work: WorkRecord, terminatedSlugs: Set<string>): VodProvider[] {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  ).filter((p) => ['flatrate', 'free', 'ads'].includes(p.type));
}

// ─── 商品（page.tsx の classifyProduct / DISPLAY_SECTIONS / 並び替えと同一） ───────
const BOOK_TITLE_KEYWORDS: string[] = [
  '写真集', 'フォトブック',
  'PHOTOBOOK', 'Photobook', 'photobook', 'PHOTO BOOK', 'Photo Book',
  'BOOK', 'BOOKS',
  '書籍', '単行本', '雑誌', 'ムック', 'ガイド', 'コミック', '楽譜', '小説',
  '図鑑', '絵本', 'エッセイ',
  '乃木撮', '日向撮', '櫻撮',
  'B.L.T.', 'BRODY', 'EX大衆', 'anan', 'アップトゥボーイ', 'UTB',
  'Platinum FLASH', 'BUBKA', '東京カレンダー', 'TRIANGLE',
];

function classifyProduct(title: string, adminCat: ProductCategory): string {
  if (adminCat === 'CD') return 'CD';
  if (adminCat === 'Blu-ray・DVD') return 'Blu-ray・DVD';
  for (const kw of BOOK_TITLE_KEYWORDS) {
    if (title.includes(kw)) return '写真集・書籍';
  }
  return 'グッズ';
}

export type ProductSectionLabel = '写真集・書籍' | 'CD' | 'Blu-ray・DVD' | 'グッズ';

const DISPLAY_SECTIONS: { label: ProductSectionLabel; sources: ProductCategory[]; usedKeywords: string[] }[] = [
  {
    label: '写真集・書籍',
    sources: ['写真集', '本・雑誌'],
    usedKeywords: [
      '写真集', 'フォトブック', 'PHOTOBOOK', 'Photobook', 'BOOK', 'BOOKS',
      '書籍', '単行本', '雑誌', 'ムック', 'ガイド', 'コミック', '小説', '楽譜',
      '乃木撮', '日向撮', '櫻撮', 'B.L.T.', 'BRODY', 'EX大衆', 'anan',
    ],
  },
  { label: 'CD', sources: ['CD'], usedKeywords: ['CD', 'シングル', 'アルバム', 'ALBUM', 'SINGLE', 'ベストアルバム'] },
  { label: 'Blu-ray・DVD', sources: ['Blu-ray・DVD'], usedKeywords: ['DVD', 'Blu-ray', 'ブルーレイ', 'ライブ', 'コンサート', 'ツアー'] },
  {
    label: 'グッズ',
    sources: ['グッズ'],
    usedKeywords: [
      'アクリルスタンド', 'アクスタ', '缶バッジ', '生写真', 'キーホルダー',
      'タオル', 'Tシャツ', 'ペンライト', 'クリアファイル', 'ステッカー',
      'ぬいぐるみ', 'キーチェーン', 'うちわ', 'ストラップ', 'ブロマイド',
      'グッズ', 'カレンダー', 'ポスター', 'トレカ', 'フィギュア',
    ],
  },
];

const NEW_PRODUCT_CATS: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD'];

function sortUsedProducts(products: RakutenItem[], ctx: PersonDisplayContext): RakutenItem[] {
  return [...products].sort((a, b) => {
    const ta = calcDisplayTier(a, ctx);
    const tb = calcDisplayTier(b, ctx);
    if (ta !== tb) return ta - tb;
    const sa = calcDisplayScore(a, ctx);
    const sb = calcDisplayScore(b, ctx);
    if (sb !== sa) return sb - sa;
    const aImg = a.imageUrl ? 0 : 1;
    const bImg = b.imageUrl ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;
    return (b.reviewCount * (b.reviewAverage || 0)) - (a.reviewCount * (a.reviewAverage || 0));
  });
}

function applyDisplayOrder(products: RakutenItem[], savedOrder: string[], ctx: PersonDisplayContext): RakutenItem[] {
  const tierMap = new Map<number, RakutenItem[]>();
  for (const p of products) {
    const t = calcDisplayTier(p, ctx);
    if (!tierMap.has(t)) tierMap.set(t, []);
    tierMap.get(t)!.push(p);
  }
  const result: RakutenItem[] = [];
  for (const tier of [...tierMap.keys()].sort((a, b) => a - b)) {
    const group = tierMap.get(tier)!;
    if (savedOrder.length === 0) {
      group.sort((a, b) => calcDisplayScore(b, ctx) - calcDisplayScore(a, ctx));
      result.push(...group);
    } else {
      const added = new Set<string>();
      const inOrder: RakutenItem[] = [];
      for (const id of savedOrder) {
        const p = group.find((x) => x.id === id);
        if (p && !added.has(p.id)) { inOrder.push(p); added.add(p.id); }
      }
      const rest = group.filter((p) => !added.has(p.id)).sort((a, b) => calcDisplayScore(b, ctx) - calcDisplayScore(a, ctx));
      result.push(...inOrder, ...rest);
    }
  }
  return result;
}

// ─── 集計結果 ──────────────────────────────────────────────────────────────────
export interface SiteUiWork {
  title: string;
  releaseYear: number | null;
  /** 配信サービスの表示名（見放題・無料・広告付き、最大2件） */
  services: string[];
  /** 作品画像URL（Instagram画像に使えないものはnull） */
  imageUrl: string | null;
  /** 配信先がYouTube系だけの作品か（search-flow と同じ isYouTubeProvider で判定） */
  youtubeOnly: boolean;
}

export interface SiteUiProductSection {
  label: ProductSectionLabel;
  /** 人物ページのこのセクションに表示される商品数（新品＋中古） */
  count: number;
  /** 表示順の先頭の商品名（新品優先、最大3件）。商品画像は使わない */
  titles: string[];
}

export interface SiteUiPersonData {
  personName: string;
  group: string | null;
  /** 人物ページのパンくずに出るジャンル（例: 坂道・俳優） */
  genre: string;
  /** 人物ページの「出演作品」 */
  workCount: number;
  /** 人物ページの「配信中」 */
  streamingWorkCount: number;
  /** 人物ページの「配信サービス」 */
  serviceCount: number;
  /** 配信サービス（配信中の作品数が多い順、表示名） */
  services: { name: string; count: number }[];
  /** 人物ページの「関連商品」 */
  productCount: number;
  /** 商品が1件以上あるセクション（人物ページと同じ順） */
  productSections: SiteUiProductSection[];
  /** 配信中の作品（映画・ドラマ優先 → 新しい順） */
  streamingWorks: SiteUiWork[];
  /** 出演作品（映画・ドラマ優先 → 新しい順） */
  works: SiteUiWork[];
  /** 配信中のうち、YouTube系だけで配信されている作品を除いた件数 */
  streamingWorkCountExcludingYouTubeOnly: number;
  /** 配信サービスのうち、YouTube系を除いた数 */
  serviceCountExcludingYouTube: number;
}

function toSiteUiWork(work: WorkRecord, providers: VodProvider[]): SiteUiWork {
  const image = getRenderableWorkImageUrl(getWorkDisplayImage(work));
  const names = [...new Set(providers.map((p) => getVodProviderDisplayInfo(p.providerName).displayName))];
  return {
    title: work.title.trim(),
    releaseYear: work.releaseYear ?? null,
    services: names.slice(0, 2),
    imageUrl: isUsableCanvaImageUrl(image) ? image! : null,
    youtubeOnly: providers.length > 0 && providers.every(isYouTubeProvider),
  };
}

export async function fetchSiteUiPersonData(personName: string): Promise<SiteUiPersonData> {
  const person = await getPersonWithConfigMerged(personName);
  if (!person) throw new PersonNotFoundError(`人物が見つかりません: ${personName}`);

  const [publishedWorks, inactiveSlugs, storedData, verdicts, displayOrders, personMeta] = await Promise.all([
    getPublishedWorks(person.name),
    getInactiveProviderSlugs(),
    getAllStoredProducts(person.name),
    getAllVerdicts(person.name),
    getAllDisplayOrders(person.name),
    getPersonMeta(person.name),
  ]);

  // ── VOD ──
  const streaming = publishedWorks
    .map((w) => ({ work: w, providers: getStreamingProviders(w, inactiveSlugs) }))
    .filter((x) => x.providers.length > 0);
  const providerWorkMap = new Map<string, { name: string; count: number; youtube: boolean }>();
  for (const { providers } of streaming) {
    for (const p of providers) {
      const key = normalizeProviderName(p.providerName);
      const entry = providerWorkMap.get(key) ?? { name: getVodProviderDisplayInfo(key).displayName, count: 0, youtube: isYouTubeProvider(p) };
      entry.count += 1;
      providerWorkMap.set(key, entry);
    }
  }
  const services = [...providerWorkMap.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
    .map(({ name, count }) => ({ name, count }));

  // ── 商品（中古） ──
  const usedProducts: RakutenItem[] = [];
  for (const p of storedData['中古']?.products ?? []) {
    if (verdicts[p.id]?.verdict !== 'related') continue;
    usedProducts.push(p);
  }
  // ── 商品（新品をタイトルで振り分け） ──
  const lookup: Record<ProductSectionLabel, RakutenItem[]> = { '写真集・書籍': [], CD: [], 'Blu-ray・DVD': [], グッズ: [] };
  const seen = new Set<string>();
  for (const cat of NEW_PRODUCT_CATS) {
    for (const p of storedData[cat]?.products ?? []) {
      if (seen.has(p.id)) continue;
      if (verdicts[p.id]?.verdict !== 'related') continue;
      seen.add(p.id);
      lookup[classifyProduct(p.title, cat) as ProductSectionLabel].push(p);
    }
  }
  const ctx: PersonDisplayContext = {
    name: person.name,
    groupName: person.group ?? '',
    aliases: (person.config.aliases ?? []).filter((a) => a.length >= 3),
    generation: personMeta?.generation ?? '',
  };
  const productSections: SiteUiProductSection[] = [];
  let productCount = 0;
  for (const { label, sources, usedKeywords } of DISPLAY_SECTIONS) {
    const sortedNew = applyDisplayOrder(lookup[label], sources.flatMap((c) => displayOrders[c] ?? []), ctx);
    const sectionUsed = sortUsedProducts(
      usedProducts.filter((p) => usedKeywords.some((kw) => p.title.replace(/^【中古】\s*/, '').includes(kw))),
      ctx,
    );
    const count = sortedNew.length + sectionUsed.length;
    productCount += count;
    if (count > 0) productSections.push({ label, count, titles: [...sortedNew, ...sectionUsed].slice(0, 3).map((p) => p.title) });
  }

  // 表示順は「映画・ドラマ優先 → 新しい順」（バラエティの各回などが先頭に並ばないようにする）
  const byYear = (a: SiteUiWork, b: SiteUiWork) => (b.releaseYear ?? -1) - (a.releaseYear ?? -1);
  const movieOrDramaFirst = (items: { w: SiteUiWork; md: boolean }[]) =>
    items.sort((a, b) => (a.md !== b.md ? (a.md ? -1 : 1) : byYear(a.w, b.w))).map((x) => x.w);
  const isMovieOrDrama = (w: WorkRecord) => ['movie', 'drama'].includes(getDisplayWorkType(w));
  const streamingWorks = movieOrDramaFirst(streaming.map(({ work, providers }) => ({ w: toSiteUiWork(work, providers), md: isMovieOrDrama(work) })));
  const works = movieOrDramaFirst(publishedWorks.map((w) => ({ w: toSiteUiWork(w, getStreamingProviders(w, inactiveSlugs)), md: isMovieOrDrama(w) })));

  return {
    personName: person.name,
    group: person.group || null,
    genre: person.genre,
    workCount: publishedWorks.length,
    streamingWorkCount: streaming.length,
    serviceCount: providerWorkMap.size,
    services,
    productCount,
    productSections,
    streamingWorks,
    works,
    streamingWorkCountExcludingYouTubeOnly: streaming.filter(({ providers }) => !providers.every(isYouTubeProvider)).length,
    serviceCountExcludingYouTube: [...providerWorkMap.values()].filter((v) => !v.youtube).length,
  };
}
