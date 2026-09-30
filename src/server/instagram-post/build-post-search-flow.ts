import 'server-only';
import sharp from 'sharp';
import { getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import type { VodProvider } from '@/types/vod';
import { fetchPersonWorks, type PersonWorkData } from './person-data';
import { fetchImageBufferSafe, convertToInstagramJpeg, bufferToDataUri } from './image-prep';
import { detectImageMimeType } from './mime-detect';
import { renderPostImagesOgSearchFlow } from './og-render-search-flow';
import { uploadPostImage } from './blob';
import { buildHashtags, type CaptionWorkInput } from './caption';
import { InsufficientWorksError, type BuildPostImage, type BuildPostResult } from './build-post';

/** 2枚目に表示する作品の最大件数 */
const MAX_WORK_COUNT = 3;
/** 2枚目が寂しく見えないための最小件数（配信先が確認できる作品がこれ未満なら生成しない） */
const MIN_WORK_COUNT = 2;

export { InsufficientWorksError };

/**
 * YouTube系の配信サービス（YouTube・YouTube Premium・YouTubeオリジナル等）か。
 * search-flowは「どこで見れる？（どのサブスクか）」を訴求するため、YouTube系は配信先として扱わない。
 */
export function isYouTubeProvider(provider: VodProvider): boolean {
  return /youtube/i.test(provider.providerName) || /youtube/i.test(getVodProviderDisplayInfo(provider.providerName).displayName);
}

/**
 * 配信先（VOD）が確認できる作品だけに絞る。
 * selectTopWorks()はVODあり作品を優先するが必須にはしないため、VODなし作品
 * （YouTube系を除外した結果、配信先が0件になった作品を含む）が混ざることがある。
 * このテンプレートは「どこで見れる？」を訴求するので、配信先が空の作品は表示しない。
 */
export function filterWorksWithVod(works: PersonWorkData[]): PersonWorkData[] {
  return works.filter((w) => w.vod.trim().length > 0).slice(0, MAX_WORK_COUNT);
}

/** 黒帯除去を採用する条件: 除去後の比率が16:9前後であること */
const LETTERBOX_RESULT_ASPECT_MIN = 1.6;
const LETTERBOX_RESULT_ASPECT_MAX = 1.9;

/**
 * 横長画像の上下に入った黒帯（YouTubeサムネイル等のレターボックス）を取り除く。search-flow専用。
 *
 * 副作用を避けるため、次の条件をすべて満たす場合だけ除去結果を採用し、それ以外は元画像をそのまま返す。
 * - 元画像が横長（幅 > 高さ）。縦長のポスター画像には一切適用しない
 * - 左右は削られず、上下だけが削られている
 * - 上下の削られた量がほぼ同じ（左右対称なレターボックス）
 * - 除去後の比率が16:9前後
 * 暗い色の映画ポスター・場面写真の端を誤って削らないための条件。失敗時も元画像を返す。
 */
export async function removeLetterbox(buffer: Buffer): Promise<{ buffer: Buffer; aspect: number | null }> {
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return { buffer, aspect: null };
    const originalAspect = meta.width / meta.height;
    if (meta.width <= meta.height) return { buffer, aspect: originalAspect };

    const { data, info } = await sharp(buffer)
      .trim({ background: '#000000', threshold: 30 })
      .toBuffer({ resolveWithObject: true });

    const removedTop = -(info.trimOffsetTop ?? 0);
    const removedBottom = meta.height - info.height - removedTop;
    const trimmedAspect = info.width / info.height;
    const isSymmetricLetterbox =
      info.width === meta.width &&
      info.trimOffsetLeft === 0 &&
      removedTop > 0 &&
      Math.abs(removedTop - removedBottom) <= Math.max(4, meta.height * 0.02) &&
      trimmedAspect >= LETTERBOX_RESULT_ASPECT_MIN &&
      trimmedAspect <= LETTERBOX_RESULT_ASPECT_MAX;

    return isSymmetricLetterbox ? { buffer: data, aspect: trimmedAspect } : { buffer, aspect: originalAspect };
  } catch {
    return { buffer, aspect: null };
  }
}

/**
 * search-flow専用のキャプション。既存テンプレート共通の buildCaption（caption.ts）とは別に持ち、
 * 「名前で検索すると出演作品・配信先が分かる」という検索体験と、配信情報が確認時点のものである旨を伝える。
 * ハッシュタグは既存の buildHashtags をそのまま使う。
 */
export function buildSearchFlowCaption(personName: string, works: CaptionWorkInput[]): string {
  const workLines = works.map((w) => `・${w.title}（${w.vod}）`).join('\n');
  return [
    `${personName}の出演作、どこで見れる？🔍`,
    '',
    '推しサーチなら、名前を入れるだけで',
    '出演作品と配信先をまとめてチェックできます。',
    '',
    workLines,
    '',
    '※配信情報は確認時点のものです。最新の配信状況は各サービスでご確認ください。',
    '',
    'プロフィールのリンクから「推しサーチ」で検索してみてください✨',
    '',
    buildHashtags(personName),
  ].join('\n');
}

/**
 * search-flowテンプレート（検索体験型、人物写真なし）用の生成処理。Preview確認専用。
 * 既存テンプレートの生成関数とは完全に独立しており、人物写真は取得しない。
 * - 作品選定では YouTube系の配信先を除外する（selectTopWorks の excludeProvider オプション）
 * - 作品画像は取得できなくても投稿全体を失敗させず、タイトル頭文字のフォールバック表示にする
 * - 横長画像の黒帯（レターボックス）は条件を満たす場合のみ除去する
 */
export async function buildInstagramPostSearchFlow(personName: string): Promise<BuildPostResult> {
  const personData = await fetchPersonWorks(personName, { excludeProvider: isYouTubeProvider });

  const works = filterWorksWithVod(personData.works);
  if (works.length < MIN_WORK_COUNT) {
    throw new InsufficientWorksError(
      `${personName}は配信先（YouTube系を除く）が確認できる対象作品が${works.length}件しか見つかりませんでした（${MIN_WORK_COUNT}件以上必要です）。`,
    );
  }

  const images = await Promise.all(
    works.map(async (w) => {
      const raw = w.imageUrl ? await fetchImageBufferSafe(w.imageUrl) : null;
      if (!raw) return null;
      const { buffer, aspect } = await removeLetterbox(raw);
      return { dataUri: bufferToDataUri(buffer, detectImageMimeType(buffer)), aspect };
    }),
  );

  const pngBuffers = await renderPostImagesOgSearchFlow({
    personName,
    works: works.map((w, i) => ({
      title: w.title,
      vod: w.vod,
      imageDataUri: images[i]?.dataUri ?? null,
      imageAspect: images[i]?.aspect ?? null,
    })),
  });

  const timestamp = Date.now();
  const uploadedImages = await Promise.all(
    pngBuffers.map(async (pngBuffer, i) => {
      const jpegBuffer = await convertToInstagramJpeg(pngBuffer);
      const fileName = `${personName}_${timestamp}_searchflow_0${i + 1}.jpg`;
      const url = await uploadPostImage(jpegBuffer, fileName, 'image/jpeg');
      return { order: (i + 1) as 1 | 2 | 3, url, fileName };
    }),
  );

  const captionWorks: CaptionWorkInput[] = works.map((w) => ({ title: w.title, vod: w.vod }));

  return {
    personName,
    personPhotoUrl: '',
    images: uploadedImages as [BuildPostImage, BuildPostImage, BuildPostImage],
    works: captionWorks,
    caption: buildSearchFlowCaption(personName, captionWorks),
    hashtags: buildHashtags(personName),
  };
}
