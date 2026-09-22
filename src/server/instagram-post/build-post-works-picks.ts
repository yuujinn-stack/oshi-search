import 'server-only';
import { fetchPersonWorks } from './person-data';
import { fetchImageBufferSafe, convertToInstagramJpeg, bufferToDataUri } from './image-prep';
import { detectImageMimeType } from './mime-detect';
import { renderPostImagesOgWorksPicks } from './og-render-works-picks';
import { uploadPostImage } from './blob';
import { buildCaption, buildHashtags, type CaptionWorkInput } from './caption';
import { InsufficientWorksError, type BuildPostImage, type BuildPostResult } from './build-post';

const REQUIRED_WORK_COUNT = 3;

export { InsufficientWorksError };

/**
 * works-picksテンプレート（出演作3選、人物写真なし）用の生成処理。
 * build-post-works-only.tsと同様、既存のbuildInstagramPost（default-person）とは
 * 完全に独立した関数として用意している。人物写真の取得は一切行わない。
 * 汎用処理（作品取得・画像アップロード・キャプション生成）は既存関数をそのまま再利用する。
 */
export async function buildInstagramPostWorksPicks(personName: string): Promise<BuildPostResult> {
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

  // 作品画像は1枚取得できなくても投稿全体を失敗させたくないため、
  // fetchImageBufferSafe（一時的エラーは自動リトライ、最終的に失敗すればnull）を使う。
  const workBuffers = await Promise.all(works.map((w) => fetchImageBufferSafe(w.imageUrl!)));

  const pngBuffers = await renderPostImagesOgWorksPicks({
    personName,
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
      const fileName = `${personName}_${timestamp}_workspicks_0${i + 1}.jpg`;
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
    caption: buildCaption(personName, captionWorks),
    hashtags: buildHashtags(personName),
  };
}
