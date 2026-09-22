import 'server-only';
import { fetchPersonWorks } from './person-data';
import { convertToInstagramJpeg } from './image-prep';
import { renderPostImagesOgVodCompare } from './og-render-vod-compare';
import { uploadPostImage } from './blob';
import { buildCaption, buildHashtags, type CaptionWorkInput } from './caption';
import { InsufficientWorksError, type BuildPostImage, type BuildPostResult } from './build-post';
import type { VodCountEntry } from './og-templates/vod-compare';

const REQUIRED_WORK_COUNT = 3;

export { InsufficientWorksError };

/**
 * work.vod（例: "Netflix / U-NEXT"）は buildVodDisplayString()
 * （tools/canva-instagram/work-selection.ts、最大2件を" / "で連結）が組み立てた文字列。
 * これを分割・集計するだけで、新しい配信サービス判定ロジックは一切作らない
 * （既存のVOD確定ロジックの結果をそのまま数え上げるのみ）。
 * 1件も出現しないサービスは結果に含まれないため、「0作品のサービスは表示しない」を
 * 自然に満たす。
 */
export function aggregateVodCounts(works: { vod: string }[]): VodCountEntry[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const w of works) {
    const names = w.vod.split('/').map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      if (!counts.has(name)) {
        counts.set(name, 0);
        order.push(name);
      }
      counts.set(name, counts.get(name)! + 1);
    }
  }
  return order
    .map((providerName) => ({ providerName, count: counts.get(providerName)! }))
    .sort((a, b) => b.count - a.count);
}

/**
 * vod-compareテンプレート（配信サービス比較、人物写真なし）用の生成処理。
 * 既存のbuildInstagramPostとは完全に独立している。人物写真は取得しない。
 * このテンプレートは作品画像を1枚も使わない（2枚目はサービス別の件数比較バーのみ）ため、
 * 他のテンプレートと異なり作品画像のダウンロード（fetchImageBuffer）自体を行わない。
 */
export async function buildInstagramPostVodCompare(personName: string): Promise<BuildPostResult> {
  const personData = await fetchPersonWorks(personName);

  if (personData.works.length < REQUIRED_WORK_COUNT) {
    throw new InsufficientWorksError(
      `${personName}は現在配信中の対象作品が${personData.works.length}件しか見つかりませんでした（${REQUIRED_WORK_COUNT}件必要です）。`,
    );
  }
  const works = personData.works.slice(0, REQUIRED_WORK_COUNT);

  const counts = aggregateVodCounts(works);

  const pngBuffers = await renderPostImagesOgVodCompare({ personName, counts });

  const timestamp = Date.now();
  const uploadedImages = await Promise.all(
    pngBuffers.map(async (pngBuffer, i) => {
      const jpegBuffer = await convertToInstagramJpeg(pngBuffer);
      const fileName = `${personName}_${timestamp}_vodcompare_0${i + 1}.jpg`;
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
