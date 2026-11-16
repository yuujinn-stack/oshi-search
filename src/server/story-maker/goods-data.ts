// ストーリーズ B（関連商品）の自動作成用データ。DB は読むだけ（書き込み・構造変更なし）。
//
// - 商品の選び方は src/lib/story-maker/goods-select.ts（公開中の人物ページ・グループページと同じ条件）。
// - 商品画像はサーバーで取得して data: URL にする（ブラウザで外部画像を描くと PNG 保存で欠けるため）。
//   1枚ごとにタイムアウト・サイズ上限・画像形式の確認をし、失敗した商品は画像なし（代替カード）にする。
// - 同じ画像を何度も取りに行かないよう、取得結果をサーバーのメモリに短時間だけ覚えておく（失敗も短く覚える）。

import { getAllPersonsMerged, getPersonWithConfigMerged } from '@/lib/persons';
import { getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import { getAllDisplayOrders } from '@/lib/product-order-store';
import { getPersonMeta } from '@/lib/person-meta';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { groupMembershipRecords, personsInGroup } from '@/lib/group-membership';
import { getBestProductImageUrl } from '@/lib/product-image';
import { pickStoryGoods, selectGroupGoods, selectPersonGoods, storyGoodsTitle, type GoodsSection } from '@/lib/story-maker/goods-select';
import type { ProductPanelItem } from '@/lib/story-maker/panels';

export const STORY_GOODS_MAX = 3;
const IMAGE_TIMEOUT_MS = 6_000;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const CACHE_OK_MS = 30 * 60_000;
const CACHE_FAIL_MS = 2 * 60_000;
const CACHE_MAX = 120;

export class StoryGoodsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface StoryGoodsResult {
  targetName: string;
  items: ProductPanelItem[];
  /** サイトに出ている商品の件数（ストーリーズに載せない分も含む） */
  totalOnSite: number;
  /** 画像を取得できなかった件数（代替カードで表示） */
  imageFailures: number;
}

// ── 画像の取得（タイムアウト・サイズ上限・形式確認・キャッシュ） ─────────────────

type CacheEntry = { at: number; dataUrl: string | null };
const imageCache = new Map<string, CacheEntry>();

/** テスト用 */
export function clearStoryImageCache(): void {
  imageCache.clear();
}

export async function fetchImageAsDataUrl(
  url: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number; now?: () => number } = {},
): Promise<string | null> {
  const now = opts.now ?? Date.now;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const hit = imageCache.get(url);
  if (hit && now() - hit.at < (hit.dataUrl ? CACHE_OK_MS : CACHE_FAIL_MS)) return hit.dataUrl;

  const remember = (dataUrl: string | null) => {
    if (imageCache.size >= CACHE_MAX) imageCache.delete(imageCache.keys().next().value as string);
    imageCache.set(url, { at: now(), dataUrl });
    return dataUrl;
  };
  try {
    const res = await (opts.fetchImpl ?? fetch)(parsed.toString(), {
      signal: AbortSignal.timeout(opts.timeoutMs ?? IMAGE_TIMEOUT_MS),
      redirect: 'follow',
      cache: 'no-store',
    });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return remember(null);
    const max = opts.maxBytes ?? IMAGE_MAX_BYTES;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > max) return remember(null);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > max) return remember(null);
    return remember(`data:${type};base64,${buf.toString('base64')}`);
  } catch {
    return remember(null);
  }
}

// ── 商品の読み込み ───────────────────────────────────────────────

async function personSections(name: string): Promise<GoodsSection[]> {
  const person = await getPersonWithConfigMerged(name);
  if (!person) throw new StoryGoodsError(`「${name}」は公開中の人物に見つかりませんでした。`, 404);
  const [stored, verdicts, displayOrders, meta] = await Promise.all([
    getAllStoredProducts(person.name),
    getAllVerdicts(person.name),
    getAllDisplayOrders(person.name).catch(() => ({})),
    getPersonMeta(person.name).catch(() => null),
  ]);
  return selectPersonGoods(stored, verdicts, displayOrders, {
    name: person.name,
    groupName: person.group ?? '',
    aliases: (person.config.aliases ?? []).filter((a) => a.length >= 3),
    generation: meta?.generation ?? '',
  });
}

async function groupSections(groupName: string): Promise<GoodsSection[]> {
  const [persons, records] = await Promise.all([getAllPersonsMerged(), getAllMembershipRecords()]);
  const members = personsInGroup(groupName, persons, groupMembershipRecords(records));
  if (members.length === 0) throw new StoryGoodsError(`「${groupName}」のメンバーが見つかりませんでした。`, 404);
  const data = await Promise.all(members.map(async (m) => {
    const [stored, verdicts] = await Promise.all([getAllStoredProducts(m.name), getAllVerdicts(m.name)]);
    return { stored, verdicts };
  }));
  return selectGroupGoods(data);
}

export async function loadStoryGoods(
  target: { type: 'person' | 'group'; name: string },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<StoryGoodsResult> {
  const name = target.name.trim();
  if (!name || name.length > 100) throw new StoryGoodsError('人物またはグループを選んでください。', 400);
  const sections = target.type === 'person' ? await personSections(name) : await groupSections(name);
  const totalOnSite = sections.reduce((n, s) => n + s.products.length, 0);
  const picked = pickStoryGoods(sections, STORY_GOODS_MAX);
  if (picked.length === 0) {
    throw new StoryGoodsError(
      `「${name}」の${target.type === 'person' ? '人物' : 'グループ'}ページに公開中の関連商品（写真集・CD・Blu-ray・DVD・グッズ）がないため、自動作成できません。画像をアップロードして作るか、別の人物・グループを選んでください。`,
      404,
    );
  }
  const images = await Promise.all(picked.map(({ product }) => (product.imageUrl ? fetchImageAsDataUrl(getBestProductImageUrl(product.imageUrl), opts) : Promise.resolve(null))));
  const items: ProductPanelItem[] = picked.map(({ product, section }, i) => ({
    title: storyGoodsTitle(product.title),
    section,
    imageSrc: images[i],
    url: product.itemUrl,
  }));
  return { targetName: name, items, totalOnSite, imageFailures: items.filter((x) => !x.imageSrc).length };
}
