import 'server-only';
import type { ReactElement } from 'react';
import { ImageResponse } from 'next/og';
import {
  buildPage1Element,
  buildPage2Element,
  buildPage3Element,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from './og-templates';
import { getNotoSansJpBoldFontData } from './fonts/font-loader';

/**
 * 投稿画像3枚のレンダリング（Playwright/Chromiumを一切使わない実装）。
 *
 * next/ogのImageResponse（Vercel公式の@vercel/og、内部でSatori+Resvgを使用）でJSXから
 * 直接PNGを生成する。Chromiumのようなヘッドレスブラウザプロセスの起動が不要なため、
 * コールドスタート・メモリ・タイムアウトの問題が構造的に発生しない
 * （Vercel Hobbyプランでも安定動作する）。
 *
 * 元々はPlaywrightで本番サイトの人物ページをスクリーンショットしてページ3を作っていたが、
 * 実際のWebページのスクリーンショットには依存しない設計に変更したため、この方式に統一できた。
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

export interface RenderOgWorkInput {
  title: string;
  vod: string;
  /** 取得失敗時はnull（画像なしのフォールバックカードとして描画される） */
  imageDataUri: string | null;
}

export interface RenderOgInput {
  personName: string;
  personImageDataUri: string;
  works: [RenderOgWorkInput, RenderOgWorkInput, RenderOgWorkInput];
}

/** 投稿画像3枚をこの順番でPNG Bufferとしてレンダリングする */
export async function renderPostImagesOg(data: RenderOgInput): Promise<[Buffer, Buffer, Buffer]> {
  const page1 = await renderElementToPng(
    buildPage1Element({ personName: data.personName, personImageDataUri: data.personImageDataUri }),
  );
  const page2 = await renderElementToPng(
    buildPage2Element({ personName: data.personName, works: data.works }),
  );
  const page3 = await renderElementToPng(
    buildPage3Element({ personName: data.personName, personImageDataUri: data.personImageDataUri }),
  );
  return [page1, page2, page3];
}
