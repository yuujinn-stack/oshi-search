import 'server-only';
import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import {
  buildVodComparePage1Element,
  buildVodComparePage2Element,
  buildVodComparePage3Element,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type VodCountEntry,
} from './og-templates/vod-compare';
import { getNotoSansJpBoldFontData } from './fonts/font-loader';

/**
 * vod-compareテンプレート（配信サービス比較、人物写真なし）専用のレンダリング処理。
 * 他のog-render-*.tsとは完全に独立させている。フォント読み込みのみ既存font-loader.tsを共有する。
 */
async function renderElementToPng(element: ReactElement): Promise<Buffer> {
  const response = new ImageResponse(element, {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fonts: [
      {
        name: 'Noto Sans JP',
        data: getNotoSansJpBoldFontData(),
        weight: 700,
        style: 'normal',
      },
    ],
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface RenderVodCompareInput {
  personName: string;
  counts: VodCountEntry[];
}

/** vod-compareテンプレートの投稿画像3枚をこの順番でPNG Bufferとしてレンダリングする */
export async function renderPostImagesOgVodCompare(data: RenderVodCompareInput): Promise<[Buffer, Buffer, Buffer]> {
  const page1 = await renderElementToPng(buildVodComparePage1Element({ personName: data.personName }));
  const page2 = await renderElementToPng(buildVodComparePage2Element({ personName: data.personName, counts: data.counts }));
  const page3 = await renderElementToPng(buildVodComparePage3Element({ personName: data.personName }));
  return [page1, page2, page3];
}
