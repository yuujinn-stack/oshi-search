// 推し布教カードの完成ページの OG・Twitter カード（純粋関数・DB非依存）。
// X・LINE にカードのURLを貼ったとき、そのカード（人物・作品・順序・デザイン・ひとこと）の画像を出す。
// /oshi-card 本体・作成画面には使わない（静的OGのまま）。canonical・robots はここでは扱わない。
import type { Metadata } from 'next';
import { OSHI_CARD_IMAGE_SIZES, buildOshiCardOgImagePath, buildOshiCardResultPath, type OshiCardSelection } from './params';

export function buildOshiCardSocialMetadata(opts: {
  selection: OshiCardSelection;
  titles: string[];
  siteOrigin: string;
  baseOpenGraph: Metadata['openGraph'];
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const { selection, titles, siteOrigin } = opts;
  const title = `${selection.person}の布教カード｜推しサーチ`;
  const description = `${selection.person}のおすすめ作品：${titles.map((t) => `「${t}」`).join('')}。あなたの推しでも布教カードを作ってみて。`;
  const image = {
    url: buildOshiCardOgImagePath(selection),
    width: OSHI_CARD_IMAGE_SIZES.og.width,
    height: OSHI_CARD_IMAGE_SIZES.og.height,
    alt: `${selection.person}の布教カード`,
    type: 'image/png',
  };
  return {
    openGraph: { ...opts.baseOpenGraph, title, description, url: `${siteOrigin}${buildOshiCardResultPath(selection)}`, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
