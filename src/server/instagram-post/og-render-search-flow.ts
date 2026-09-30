import 'server-only';
import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import {
  buildSearchFlowPage1Element,
  buildSearchFlowPage2Element,
  buildSearchFlowPage3Element,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type SearchFlowWorkData,
} from './og-templates/search-flow';
import { getNotoSansJpBoldFontData } from './fonts/font-loader';

/**
 * search-flowテンプレート（検索体験型、人物写真なし）専用のレンダリング処理（1080×1080）。
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

export interface RenderSearchFlowInput {
  personName: string;
  /** 1〜3件 */
  works: SearchFlowWorkData[];
}

/** search-flowテンプレートの投稿画像3枚をこの順番でPNG Bufferとしてレンダリングする */
export async function renderPostImagesOgSearchFlow(data: RenderSearchFlowInput): Promise<[Buffer, Buffer, Buffer]> {
  const page1 = await renderElementToPng(buildSearchFlowPage1Element({ personName: data.personName, works: data.works }));
  const page2 = await renderElementToPng(buildSearchFlowPage2Element({ personName: data.personName, works: data.works }));
  const page3 = await renderElementToPng(buildSearchFlowPage3Element({ personName: data.personName }));
  return [page1, page2, page3];
}
