import 'server-only';
import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import {
  buildWorksPicksPage1Element,
  buildWorksPicksPage2Element,
  buildWorksPicksPage3Element,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from './og-templates/works-picks';
import { getNotoSansJpBoldFontData } from './fonts/font-loader';

/**
 * works-picksテンプレート（出演作3選、人物写真なし）専用のレンダリング処理。
 * og-render.tsx（default-person）・og-render-works-only.tsx とは完全に独立させている。
 * フォント読み込みのみ既存font-loader.tsを共有する。
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

export interface RenderWorksPicksWorkInput {
  title: string;
  vod: string;
  /** 取得失敗時はnull（画像なしのフォールバックカードとして描画される） */
  imageDataUri: string | null;
}

export interface RenderWorksPicksInput {
  personName: string;
  works: [RenderWorksPicksWorkInput, RenderWorksPicksWorkInput, RenderWorksPicksWorkInput];
}

/** works-picksテンプレートの投稿画像3枚をこの順番でPNG Bufferとしてレンダリングする */
export async function renderPostImagesOgWorksPicks(data: RenderWorksPicksInput): Promise<[Buffer, Buffer, Buffer]> {
  const page1 = await renderElementToPng(buildWorksPicksPage1Element({ personName: data.personName }));
  const page2 = await renderElementToPng(buildWorksPicksPage2Element({ personName: data.personName, works: data.works }));
  const page3 = await renderElementToPng(buildWorksPicksPage3Element({ personName: data.personName }));
  return [page1, page2, page3];
}
