import 'server-only';
import type { ReactElement } from 'react';
import sharp from 'sharp';
import { fetchImageBufferSafe, convertToInstagramJpeg, bufferToDataUri } from '../image-prep';
import { detectImageMimeType } from '../mime-detect';
import { uploadPostImage } from '../blob';
import { buildHashtags, type CaptionWorkInput } from '../caption';
import { InsufficientWorksError, type BuildPostImage, type BuildPostResult } from '../build-post';
import { removeLetterbox } from '../build-post-search-flow';
import { renderPages } from '../candidates/builders';
import { displayProductTitle, type SiteUiImage } from '../og-templates/site-ui/shared';
import type { SiteUiTemplateData } from '../og-templates/site-ui/types';
import { buildNameToEverythingPages } from '../og-templates/site-ui/name-to-everything';
import { buildSearchTooMuchPages } from '../og-templates/site-ui/search-too-much';
import { buildWatchAndBuyPages } from '../og-templates/site-ui/watch-and-buy';
import { buildOshiProductsPages } from '../og-templates/site-ui/oshi-products';
import { fetchSiteUiPersonData, type SiteUiPersonData, type SiteUiWork } from './data';
import { buildWatchAndBuyCaption, buildWatchAndBuyHashtags } from './h-schedule';

/**
 * Preview専用テンプレート F〜I の生成処理（手動投稿画面からのみ呼ばれる）。
 * 既存テンプレート・search-flow・候補A〜Eの生成関数とは独立しており、それらの挙動は変えない
 * （描画関数 renderPages・画像取得・JPEG変換・Blobアップロード・黒帯除去・ハッシュタグは既存の関数を再利用）。
 *
 * 商品画像は一切取得・使用しない（楽天の商品画像をInstagram投稿に使ってよいか確認できないため）。
 * 商品はカテゴリのアイコン＋実際の商品名で表す。
 * データが足りない場合は InsufficientWorksError（422）で生成しない。
 */

export interface PreparedSiteUiPost {
  personName: string;
  slug: string;
  pages: ReactElement[];
  works: CaptionWorkInput[];
  caption: string;
  hashtags: string;
}

/** next/og（Satori）が読めるJPEG・PNG以外（WebP等）をJPEGへ変換する。変換できなければnull */
async function toSatoriCompatible(buffer: Buffer): Promise<Buffer | null> {
  try {
    const { format } = await sharp(buffer).metadata();
    if (format === 'jpeg' || format === 'png') return buffer;
    return await sharp(buffer).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    return null;
  }
}

async function loadWorkImage(work: SiteUiWork): Promise<SiteUiImage> {
  const raw = work.imageUrl ? await fetchImageBufferSafe(work.imageUrl) : null;
  const compatible = raw ? await toSatoriCompatible(raw) : null;
  if (!compatible) return { title: work.title, dataUri: null, aspect: null };
  const { buffer, aspect } = await removeLetterbox(compatible);
  return { title: work.title, dataUri: bufferToDataUri(buffer, detectImageMimeType(buffer)), aspect };
}

/**
 * 集計結果をページ用のデータに変換する（作品は配信中の作品を優先して最大3件、画像を取得）。
 * worksOverride を渡した場合はその作品を使う（H案：YouTube系だけで配信されている作品を除いた配信中作品）。
 */
async function toTemplateData(data: SiteUiPersonData, worksOverride?: SiteUiWork[]): Promise<SiteUiTemplateData> {
  const works = (worksOverride ?? (data.streamingWorks.length > 0 ? data.streamingWorks : data.works)).slice(0, 3);
  const images = await Promise.all(works.map(loadWorkImage));
  return {
    personName: data.personName,
    group: data.group,
    genre: data.genre,
    workCount: data.workCount,
    streamingWorkCount: data.streamingWorkCount,
    serviceCount: data.serviceCount,
    services: data.services,
    productCount: data.productCount,
    productSections: data.productSections.map((s) => ({ label: s.label, count: s.count, titles: s.titles.map(displayProductTitle) })),
    works: works.map((w, i) => ({ image: images[i], title: w.title, releaseYear: w.releaseYear, services: w.services })),
    sampleWorkTitle: data.streamingWorks[0]?.title ?? data.works[0]?.title ?? null,
  };
}

async function uploadPages(personName: string, slug: string, pngs: Buffer[]): Promise<[BuildPostImage, BuildPostImage, BuildPostImage]> {
  const timestamp = Date.now();
  const uploaded = await Promise.all(
    pngs.map(async (png, i) => {
      const jpeg = await convertToInstagramJpeg(png);
      const fileName = `${personName}_${timestamp}_${slug}_0${i + 1}.jpg`;
      const url = await uploadPostImage(jpeg, fileName, 'image/jpeg');
      return { order: (i + 1) as 1 | 2 | 3, url, fileName };
    }),
  );
  return uploaded as [BuildPostImage, BuildPostImage, BuildPostImage];
}

async function finalize(prepared: PreparedSiteUiPost): Promise<BuildPostResult> {
  const pngs = await renderPages(prepared.pages);
  return {
    personName: prepared.personName,
    personPhotoUrl: '',
    images: await uploadPages(prepared.personName, prepared.slug, pngs),
    works: prepared.works,
    caption: prepared.caption,
    hashtags: prepared.hashtags,
  };
}

const NOTE = '※配信・商品情報は確認時点のものです。最新の情報は各サービス・販売ページでご確認ください。';

function worksForCaption(d: SiteUiTemplateData): CaptionWorkInput[] {
  return d.works.map((w) => ({ title: w.title, vod: w.services.join(' / ') }));
}

function productSummary(d: SiteUiTemplateData): string {
  return d.productSections.map((s) => `${s.label} ${s.count}件`).join('・');
}

// ─── F: 名前を入れたら、ここまで出る ────────────────────────────────────────────
export async function prepareNameToEverything(personName: string): Promise<PreparedSiteUiPost> {
  const raw = await fetchSiteUiPersonData(personName);
  if (raw.workCount === 0) throw new InsufficientWorksError(`${raw.personName}は出演作品が登録されていません。`);
  const d = await toTemplateData(raw);
  return {
    personName: d.personName,
    slug: 'name2all',
    pages: buildNameToEverythingPages(d),
    works: worksForCaption(d),
    caption: [
      `${d.personName}が気になったら、まず名前を入れてみる。🔍`,
      '',
      `推しサーチでは、出演作品${d.workCount}件${d.streamingWorkCount > 0 ? `・配信中${d.streamingWorkCount}件（${d.serviceCount}社）` : ''}${d.productCount > 0 ? `・関連商品${d.productCount}件` : ''}をまとめて確認できます。`,
      '',
      NOTE,
      '',
      'プロフィールのリンクから✨',
      '',
      buildHashtags(d.personName),
    ].join('\n'),
    hashtags: buildHashtags(d.personName),
  };
}

// ─── G: 推し活、検索しすぎ問題 ──────────────────────────────────────────────────
export async function prepareSearchTooMuch(personName: string): Promise<PreparedSiteUiPost> {
  const raw = await fetchSiteUiPersonData(personName);
  if (raw.workCount === 0) throw new InsufficientWorksError(`${raw.personName}は出演作品が登録されていません。`);
  const d = await toTemplateData(raw);
  return {
    personName: d.personName,
    slug: 'searchtoomuch',
    pages: buildSearchTooMuchPages(d),
    works: worksForCaption(d),
    caption: [
      '推し活、検索しすぎ問題。',
      '「何に出てた？」「どこで見れる？」「写真集ある？」「商品どこ？」',
      '',
      `その検索、推しサーチなら「${d.personName}」の名前1回からまとめて確認できます。`,
      '',
      NOTE,
      '',
      'プロフィールのリンクから✨',
      '',
      buildHashtags(d.personName),
    ].join('\n'),
    hashtags: buildHashtags(d.personName),
  };
}

// ─── H: 観るもの・買うもの、まとめて ─────────────────────────────────────────────
/**
 * H案を生成できる人物か（候補抽出にも使う）。YouTube系だけで配信されている作品・YouTube系サービスは
 * search-flow と同じ isYouTubeProvider のルールで除外して判定する。
 */
export function checkWatchAndBuyEligibility(raw: SiteUiPersonData): { ok: true } | { ok: false; reason: string } {
  if (raw.streamingWorkCountExcludingYouTubeOnly === 0) return { ok: false, reason: '配信中の作品（YouTube系のみの作品を除く）がありません' };
  if (raw.serviceCountExcludingYouTube === 0) return { ok: false, reason: '配信サービス（YouTube系を除く）がありません' };
  if (raw.productCount === 0) return { ok: false, reason: '関連商品がありません' };
  return { ok: true };
}

export async function prepareWatchAndBuy(personName: string): Promise<PreparedSiteUiPost> {
  const raw = await fetchSiteUiPersonData(personName);
  const eligibility = checkWatchAndBuyEligibility(raw);
  if (!eligibility.ok) throw new InsufficientWorksError(`${raw.personName}はH案を生成できません：${eligibility.reason}`);
  // 2枚目の作品は、配信先がYouTube系だけの作品を除いて選ぶ
  const d = await toTemplateData(raw, raw.streamingWorks.filter((w) => !w.youtubeOnly));
  return {
    personName: d.personName,
    slug: 'watchbuy',
    pages: buildWatchAndBuyPages(d),
    works: worksForCaption(d),
    caption: buildWatchAndBuyCaption(d.personName),
    hashtags: buildWatchAndBuyHashtags(d.personName),
  };
}

// ─── I: ○○の商品、どこまで知ってる？ ────────────────────────────────────────────
export async function prepareOshiProducts(personName: string): Promise<PreparedSiteUiPost> {
  const raw = await fetchSiteUiPersonData(personName);
  if (raw.productCount === 0) throw new InsufficientWorksError(`${raw.personName}は関連商品が掲載されていません。`);
  const d = await toTemplateData(raw);
  return {
    personName: d.personName,
    slug: 'products',
    pages: buildOshiProductsPages(d),
    works: [],
    caption: [
      `${d.personName}の商品、どこまで知ってる？👀`,
      '',
      `推しサーチに掲載中の関連商品：${d.productCount}件`,
      productSummary(d),
      '',
      '※商品情報は確認時点のものです。最新の価格・在庫は販売ページでご確認ください。',
      '',
      '作品だけじゃない。推しの商品も名前から探せます。プロフィールのリンクから✨',
      '',
      buildHashtags(d.personName),
    ].join('\n'),
    hashtags: buildHashtags(d.personName),
  };
}

/** F〜IのID→準備関数（src/lib/instagram-templates.ts の PREVIEW_ONLY_INSTAGRAM_TEMPLATES と対応） */
export const SITE_UI_PREPARERS: Record<string, (personName: string) => Promise<PreparedSiteUiPost>> = {
  'name-to-everything': prepareNameToEverything,
  'search-too-much': prepareSearchTooMuch,
  'watch-and-buy': prepareWatchAndBuy,
  'oshi-products': prepareOshiProducts,
};

/** F〜IのID→生成関数（準備 → 描画 → JPEG変換 → Blobアップロード） */
export const SITE_UI_BUILDERS: Record<string, (personName: string) => Promise<BuildPostResult>> = Object.fromEntries(
  Object.entries(SITE_UI_PREPARERS).map(([id, prepare]) => [id, async (personName: string) => finalize(await prepare(personName))]),
);
