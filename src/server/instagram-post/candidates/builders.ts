import 'server-only';
import type { ReactElement } from 'react';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { getNotoSansJpBoldFontData } from '../fonts/font-loader';
import { fetchImageBufferSafe, convertToInstagramJpeg, bufferToDataUri } from '../image-prep';
import { detectImageMimeType } from '../mime-detect';
import { uploadPostImage } from '../blob';
import { buildHashtags, type CaptionWorkInput } from '../caption';
import { InsufficientWorksError, type BuildPostImage, type BuildPostResult } from '../build-post';
import { removeLetterbox } from '../build-post-search-flow';
import { CANVAS } from '../og-templates/candidates/theme';
import type { CandidateImage } from '../og-templates/candidates/shared';
import { buildCuriousPersonPages } from '../og-templates/candidates/curious-person';
import { buildServiceOnlyPages } from '../og-templates/candidates/service-only';
import { buildSubscriptionCountPages } from '../og-templates/candidates/subscription-count';
import { buildOshiStatusPages } from '../og-templates/candidates/oshi-status';
import { buildSearchPainPages } from '../og-templates/candidates/search-pain';
import { fetchCandidatePersonData, watchableWorks, worksOnSubscription, type CandidateWork } from './data';

/**
 * Preview専用の投稿テンプレート候補5種類の生成処理（手動投稿画面からのみ呼ばれる）。
 * 既存テンプレート・search-flow の生成関数とは独立しており、それらの挙動は変えない。
 * 画像取得・JPEG変換・Blobアップロード・黒帯除去・ハッシュタグは既存の関数を再利用する。
 * データが足りない場合は無理に表示せず InsufficientWorksError（422）で生成しない。
 */

export async function renderPages(pages: ReactElement[]): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (const page of pages) {
    const response = new ImageResponse(page, {
      width: CANVAS.width,
      height: CANVAS.height,
      fonts: [{ name: 'Noto Sans JP', data: getNotoSansJpBoldFontData(), weight: 700, style: 'normal' }],
    });
    buffers.push(Buffer.from(await response.arrayBuffer()));
  }
  return buffers;
}

/**
 * next/og（Satori）が読めるのはJPEG・PNGのみ。detectImageMimeType はPNG以外をJPEG扱いにするため、
 * WebP等（例: TVerの作品画像）をそのまま渡すと描画時に例外になる。ここではJPEG・PNG以外をJPEGへ変換し、
 * 変換できない場合はnull（フォールバック表示）にする。
 */
async function toSatoriCompatible(buffer: Buffer): Promise<Buffer | null> {
  try {
    const { format } = await sharp(buffer).metadata();
    if (format === 'jpeg' || format === 'png') return buffer;
    return await sharp(buffer).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    return null;
  }
}

/** 作品画像を取得する。取得・変換できない場合は dataUri=null（タイトル頭文字のフォールバック表示） */
async function loadImages(works: CandidateWork[]): Promise<CandidateImage[]> {
  return Promise.all(
    works.map(async (w) => {
      const raw = w.imageUrl ? await fetchImageBufferSafe(w.imageUrl) : null;
      const compatible = raw ? await toSatoriCompatible(raw) : null;
      if (!compatible) return { title: w.title, dataUri: null, aspect: null };
      const { buffer, aspect } = await removeLetterbox(compatible);
      return { title: w.title, dataUri: bufferToDataUri(buffer, detectImageMimeType(buffer)), aspect };
    }),
  );
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

/** 描画前の投稿内容（ページ・キャプション）。検証時はこれを描画だけしてBlobへはアップロードしない */
export interface PreparedCandidatePost {
  personName: string;
  /** Blobのファイル名に使う短い識別子 */
  slug: string;
  pages: ReactElement[];
  works: CaptionWorkInput[];
  caption: string;
  hashtags: string;
}

/** 準備済みの投稿内容を描画し、JPEG変換してBlobへアップロードする */
async function finalize(prepared: PreparedCandidatePost): Promise<BuildPostResult> {
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

function joinCaption(lines: string[]): string {
  return lines.join('\n');
}

const VOD_NOTE = '※配信情報は確認時点のものです。最新の配信状況は各サービスでご確認ください。';

/** 「2026年9月時点」（日本時間） */
function currentMonthLabel(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}年${month}月時点`;
}

// ─── A: 最近この人、気になってる？ ───────────────────────────────────────────────
export async function prepareCuriousPerson(personName: string): Promise<PreparedCandidatePost> {
  const data = await fetchCandidatePersonData(personName);
  const works = watchableWorks(data).slice(0, 3);
  if (works.length === 0) {
    throw new InsufficientWorksError(`${data.personName}は見放題・無料で配信確認できる作品が見つかりませんでした。`);
  }
  const images = await loadImages(works);
  const services = data.watchableServices.slice(0, 4).map((s) => s.name);
  const captionWorks: CaptionWorkInput[] = works.map((w) => ({ title: w.title, vod: w.watchableServices.slice(0, 2).join(' / ') }));
  return {
    personName: data.personName,
    slug: 'curious',
    pages: buildCuriousPersonPages({
      personName: data.personName,
      images,
      workTitles: works.map((w) => w.title),
      services,
      serviceTotal: data.watchableServices.length,
      group: data.group,
      groupMembers: data.groupMembers,
    }),
    works: captionWorks,
    caption: joinCaption([
      `最近、${data.personName}ちょっと気になってる人へ。`,
      '',
      '何から見ればいいか分からないなら、まずはここから👀',
      '',
      ...captionWorks.map((w) => `・${w.title}（${w.vod}）`),
      '',
      VOD_NOTE,
      '',
      '“気になる”を“推し”に。プロフィールのリンクから「推しサーチ」で名前を検索してみてください✨',
      '',
      buildHashtags(data.personName),
    ]),
    hashtags: buildHashtags(data.personName),
  };
}

// ─── B: ○○だけ契約してる人へ ────────────────────────────────────────────────────
export async function prepareServiceOnly(personName: string): Promise<PreparedCandidatePost> {
  const data = await fetchCandidatePersonData(personName);
  const top = data.subscriptionServices[0];
  if (!top) {
    throw new InsufficientWorksError(`${data.personName}は見放題で配信確認できる作品が見つかりませんでした。`);
  }
  const all = worksOnSubscription(data, top.name);
  const works = all.slice(0, 3);
  const images = await loadImages(works);
  const captionWorks: CaptionWorkInput[] = works.map((w) => ({ title: w.title, vod: top.name }));
  return {
    personName: data.personName,
    slug: 'serviceonly',
    pages: buildServiceOnlyPages({
      personName: data.personName,
      serviceName: top.name,
      works: works.map((w, i) => ({ image: images[i], releaseYear: w.releaseYear })),
      total: all.length,
    }),
    works: captionWorks,
    caption: joinCaption([
      `${top.name}だけ契約してる${data.personName}ファンへ。`,
      '',
      `${top.name}で見られる出演作（確認できたもの）📺`,
      ...captionWorks.map((w) => `・${w.title}`),
      ...(all.length > works.length ? [`ほか${all.length - works.length}作品`] : []),
      '',
      VOD_NOTE,
      '',
      '他のサブスクでの配信先は、プロフィールのリンクから「推しサーチ」でまとめて確認できます✨',
      '',
      buildHashtags(data.personName),
    ]),
    hashtags: buildHashtags(data.personName),
  };
}

// ─── C: この推し、サブスク何個必要？ ─────────────────────────────────────────────
export async function prepareSubscriptionCount(personName: string): Promise<PreparedCandidatePost> {
  const data = await fetchCandidatePersonData(personName);
  const services = data.subscriptionServices;
  if (services.length === 0) {
    throw new InsufficientWorksError(`${data.personName}は見放題で配信確認できる作品が見つかりませんでした。`);
  }
  return {
    personName: data.personName,
    slug: 'subcount',
    pages: buildSubscriptionCountPages({ personName: data.personName, services }),
    works: services.map((s) => ({ title: s.name, vod: `${s.count}作品` })),
    caption: joinCaption([
      `${data.personName}を追うなら、サブスク何個必要？🤔`,
      '',
      `現在確認できたのは${services.length}サービス（見放題で配信確認できた出演作の数）`,
      ...services.map((s) => `・${s.name}：${s.count}作品`),
      '',
      VOD_NOTE,
      '',
      'プロフィールのリンクから「推しサーチ」で配信先をまとめてチェック✨',
      '',
      buildHashtags(data.personName),
    ]),
    hashtags: buildHashtags(data.personName),
  };
}

// ─── D: 推しの現在地 ────────────────────────────────────────────────────────────
export async function prepareOshiStatus(personName: string): Promise<PreparedCandidatePost> {
  const data = await fetchCandidatePersonData(personName);
  if (data.watchableWorkCount === 0) {
    throw new InsufficientWorksError(`${data.personName}は見放題・無料で配信確認できる作品が見つかりませんでした。`);
  }
  // 関連商品数は人物ページ側でAI判定等を経て表示件数が決まり、同じ数を再現できないため使わない
  const stats = [
    { label: '登録作品', value: data.registeredWorkCount, unit: '作品' },
    { label: '配信確認', value: data.watchableWorkCount, unit: '作品' },
    { label: '配信サービス', value: data.watchableServices.length, unit: 'サービス' },
  ];
  const dateLabel = currentMonthLabel();
  const topServices = data.watchableServices.slice(0, 4).map((s) => s.name);
  return {
    personName: data.personName,
    slug: 'status',
    pages: buildOshiStatusPages({ personName: data.personName, dateLabel, stats, topServices, serviceTotal: data.watchableServices.length }),
    works: [],
    caption: joinCaption([
      `${data.personName}の現在地（${dateLabel}）📊`,
      '',
      `・推しサーチ登録作品：${data.registeredWorkCount}作品`,
      `・見放題・無料で配信確認：${data.watchableWorkCount}作品`,
      `・配信サービス：${data.watchableServices.length}（${topServices.join(' / ')}${data.watchableServices.length > topServices.length ? ' ほか' : ''}）`,
      '',
      VOD_NOTE,
      '',
      '気になったら、プロフィールのリンクから「推しサーチ」で名前からチェック✨',
      '',
      buildHashtags(data.personName),
    ]),
    hashtags: buildHashtags(data.personName),
  };
}

// ─── E: 推し活で地味に面倒なこと（人物に依存しない） ──────────────────────────────
const SEARCH_PAIN_HASHTAGS = '#推しサーチ #推し活 #VOD #サブスク';

export async function prepareSearchPain(_personName: string): Promise<PreparedCandidatePost> {
  return {
    // 人物名は画像・キャプションに使わない（Blobのファイル名にも入れない）
    personName: 'search-pain',
    slug: 'searchpain',
    pages: buildSearchPainPages(),
    works: [],
    caption: joinCaption([
      '推し活で地味に面倒なこと。',
      '「この人何に出てたっけ？」→ 出演作を検索 → どこで見れる？ → サブスクをまた検索…🔁',
      '',
      '推しサーチなら、人物名から出演作品・配信先をまとめて探せます。',
      'プロフィールのリンクから使ってみてください✨',
      '',
      SEARCH_PAIN_HASHTAGS,
    ]),
    hashtags: SEARCH_PAIN_HASHTAGS,
  };
}

/** Preview専用テンプレート候補のID→準備関数（src/lib/instagram-templates.ts の PREVIEW_ONLY_INSTAGRAM_TEMPLATES と対応） */
export const PREVIEW_CANDIDATE_PREPARERS: Record<string, (personName: string) => Promise<PreparedCandidatePost>> = {
  'curious-person': prepareCuriousPerson,
  'service-only': prepareServiceOnly,
  'subscription-count': prepareSubscriptionCount,
  'oshi-status': prepareOshiStatus,
  'search-pain': prepareSearchPain,
};

/** Preview専用テンプレート候補のID→生成関数（準備 → 描画 → JPEG変換 → Blobアップロード） */
export const PREVIEW_CANDIDATE_BUILDERS: Record<string, (personName: string) => Promise<BuildPostResult>> = Object.fromEntries(
  Object.entries(PREVIEW_CANDIDATE_PREPARERS).map(([id, prepare]) => [id, async (personName: string) => finalize(await prepare(personName))]),
);
