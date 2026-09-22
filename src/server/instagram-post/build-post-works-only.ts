import 'server-only';
import { fetchPersonWorks } from './person-data';
import { fetchImageBuffer, convertToInstagramJpeg, bufferToDataUri } from './image-prep';
import { detectImageMimeType } from './mime-detect';
import { renderPostImagesOgWorksOnly } from './og-render-works-only';
import { uploadPostImage } from './blob';
import { buildCaption, buildHashtags, type CaptionWorkInput } from './caption';
import { InsufficientWorksError, type BuildPostImage, type BuildPostResult } from './build-post';

const REQUIRED_WORK_COUNT = 3;

export { InsufficientWorksError };

/**
 * works-onlyテンプレート用の生成処理。既存の buildInstagramPost（build-post.ts、
 * default-person専用）とは完全に独立した関数として用意し、そちらのロジック・挙動は
 * 一切変更していない。人物写真の取得（findExistingPersonPhoto）を一切行わない点のみが
 * 大きな違いで、それ以外（作品取得・画像アップロード・キャプション生成）は
 * 既存の汎用関数（person-data.ts / image-prep.ts / blob.ts / caption.ts）をそのまま再利用する。
 *
 * 戻り値の型は既存のBuildPostResultと互換にしてあるが、personPhotoUrlは
 * このテンプレートでは存在しないため空文字列を入れる（クライアント側は元々この値を
 * 表示に使っていないため、型を変えずに済ませられる）。
 */
export async function buildInstagramPostWorksOnly(personName: string): Promise<BuildPostResult> {
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

  // 人物写真は使用しないため、findExistingPersonPhoto は一切呼び出さない
  // （このテンプレートは人物写真が未登録の人物でも生成できることが要件）。
  const workBuffers = await Promise.all(works.map((w) => fetchImageBuffer(w.imageUrl!)));

  const pngBuffers = await renderPostImagesOgWorksOnly({
    personName,
    works: [0, 1, 2].map((i) => ({
      title: works[i].title,
      vod: works[i].vod,
      imageDataUri: bufferToDataUri(workBuffers[i], detectImageMimeType(workBuffers[i])),
    })) as [
      { title: string; vod: string; imageDataUri: string },
      { title: string; vod: string; imageDataUri: string },
      { title: string; vod: string; imageDataUri: string },
    ],
  });

  const timestamp = Date.now();
  const uploadedImages = await Promise.all(
    pngBuffers.map(async (pngBuffer, i) => {
      const jpegBuffer = await convertToInstagramJpeg(pngBuffer);
      const fileName = `${personName}_${timestamp}_worksonly_0${i + 1}.jpg`;
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
