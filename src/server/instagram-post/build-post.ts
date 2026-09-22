import 'server-only';
import { fetchPersonWorks } from './person-data';
import { fetchImageBuffer, fetchImageBufferSafe, convertToInstagramJpeg, bufferToDataUri } from './image-prep';
import { detectImageMimeType } from './mime-detect';
import { renderPostImagesOg } from './og-render';
import { uploadPostImage, findExistingPersonPhoto } from './blob';
import { buildCaption, buildHashtags, type CaptionWorkInput } from './caption';

const REQUIRED_WORK_COUNT = 3;

export class InsufficientWorksError extends Error {}
export class PersonPhotoMissingError extends Error {}

export interface BuildPostImage {
  order: 1 | 2 | 3;
  url: string;
  fileName: string;
}

export interface BuildPostResult {
  personName: string;
  personPhotoUrl: string;
  images: [BuildPostImage, BuildPostImage, BuildPostImage];
  works: CaptionWorkInput[];
  caption: string;
  hashtags: string;
}

/**
 * 「投稿を作成」ボタンの処理本体。
 * 人物データ取得 → 画像3枚生成 → JPEG変換 → Vercel Blobアップロード → キャプション生成
 * まで実行する。Instagram APIへの書き込みは一切行わない（この関数はcreation_idも
 * 作らない）。ローカルディスクへは一切書き込まない。
 */
export async function buildInstagramPost(personName: string): Promise<BuildPostResult> {
  const personData = await fetchPersonWorks(personName);

  if (personData.works.length < REQUIRED_WORK_COUNT) {
    throw new InsufficientWorksError(
      `${personName}は現在配信中の対象作品が${personData.works.length}件しか見つかりませんでした（${REQUIRED_WORK_COUNT}件必要です）。`,
    );
  }
  const works = personData.works.slice(0, REQUIRED_WORK_COUNT);
  const missingImages = works.filter((w) => !w.imageUrl);
  if (missingImages.length > 0) {
    throw new Error(
      `以下の作品で画像URLが取得できませんでした: ${missingImages.map((w) => w.title).join('、')}`,
    );
  }

  const personPhotoUrl = await findExistingPersonPhoto(personName);
  if (!personPhotoUrl) {
    throw new PersonPhotoMissingError(
      `${personName}の人物写真がまだアップロードされていません。先に人物写真をアップロードしてください。`,
    );
  }

  // 画像生成はnext/og（Satori+Resvg）を使い、Playwright/Chromiumには一切依存しない
  // （Vercel Hobby環境でのコールドスタート・メモリ・タイムアウト問題を構造的になくすため）。
  // 3枚目もPlaywrightでの本番サイトスクリーンショットは行わず、人物写真とテキストのみで
  // 構成する専用テンプレートに変更している。
  //
  // 人物写真は投稿の主役であり代替できないため、従来通りfetchImageBufferで取得し、
  // 失敗した場合はそのまま投稿全体を失敗させる（このエラーハンドリングは変更しない）。
  // 作品画像は1枚取得できなくても投稿全体を失敗させたくないため、
  // fetchImageBufferSafe（一時的エラーは自動リトライ、最終的に失敗すればnull）を使う。
  const [personPhotoBuffer, workBuffers] = await Promise.all([
    fetchImageBuffer(personPhotoUrl),
    Promise.all(works.map((w) => fetchImageBufferSafe(w.imageUrl!))),
  ]);

  const personImageDataUri = bufferToDataUri(personPhotoBuffer, detectImageMimeType(personPhotoBuffer));
  const pngBuffers = await renderPostImagesOg({
    personName,
    personImageDataUri,
    works: [0, 1, 2].map((i) => ({
      title: works[i].title,
      vod: works[i].vod,
      imageDataUri: workBuffers[i] ? bufferToDataUri(workBuffers[i]!, detectImageMimeType(workBuffers[i]!)) : null,
    })) as [
      { title: string; vod: string; imageDataUri: string | null },
      { title: string; vod: string; imageDataUri: string | null },
      { title: string; vod: string; imageDataUri: string | null },
    ],
  });

  const timestamp = Date.now();
  const uploadedImages = await Promise.all(
    pngBuffers.map(async (pngBuffer, i) => {
      const jpegBuffer = await convertToInstagramJpeg(pngBuffer);
      const fileName = `${personName}_${timestamp}_0${i + 1}.jpg`;
      const url = await uploadPostImage(jpegBuffer, fileName, 'image/jpeg');
      return { order: (i + 1) as 1 | 2 | 3, url, fileName };
    }),
  );

  const captionWorks: CaptionWorkInput[] = works.map((w) => ({ title: w.title, vod: w.vod }));

  return {
    personName,
    personPhotoUrl,
    images: uploadedImages as [BuildPostImage, BuildPostImage, BuildPostImage],
    works: captionWorks,
    caption: buildCaption(personName, captionWorks),
    hashtags: buildHashtags(personName),
  };
}
