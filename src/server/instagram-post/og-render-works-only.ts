import 'server-only';
import { ImageResponse } from 'next/og';
import type { ReactElement } from 'react';
import {
  buildWorksOnlyPage1Element,
  buildWorksOnlyPage2Element,
  buildWorksOnlyPage3Element,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from './og-templates/works-only';
import { getNotoSansJpBoldFontData } from './fonts/font-loader';

/**
 * works-onlyテンプレート（人物写真を使わない投稿）専用のレンダリング処理。
 * 既存の og-render.tsx（default-person用、1080×1350）は一切変更せず、
 * こちらは1080×1080（Instagram正方形投稿）用として完全に独立させている。
 * フォント読み込み（getNotoSansJpBoldFontData）だけは汎用のため共有する。
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

export interface RenderWorksOnlyWorkInput {
  title: string;
  vod: string;
  imageDataUri: string;
}

export interface RenderWorksOnlyInput {
  personName: string;
  works: [RenderWorksOnlyWorkInput, RenderWorksOnlyWorkInput, RenderWorksOnlyWorkInput];
}

/** works-onlyテンプレートの投稿画像3枚をこの順番でPNG Bufferとしてレンダリングする */
export async function renderPostImagesOgWorksOnly(data: RenderWorksOnlyInput): Promise<[Buffer, Buffer, Buffer]> {
  const page1 = await renderElementToPng(buildWorksOnlyPage1Element({ personName: data.personName }));
  const page2 = await renderElementToPng(buildWorksOnlyPage2Element({ personName: data.personName, works: data.works }));
  const page3 = await renderElementToPng(buildWorksOnlyPage3Element({ personName: data.personName }));
  return [page1, page2, page3];
}
