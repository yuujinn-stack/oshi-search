// 診断結果URLの OG・Twitter カード（純粋関数・DB非依存）。
// X・LINE に結果URLを貼ったとき、その結果と共有元が選んだデザイン（sv）のカード画像を出す。
// /oshi-vod 本体・入口URLには使わない（従来の静的OGのまま）。canonical・robots はここでは扱わない。
import type { Metadata } from 'next';
import { formatPersonList } from './format';
import { OSHI_VOD_IMAGE_SIZES, buildOshiVodOgImagePath, buildOshiVodResultPath } from './params';
import { OSHI_VOD_SHARE_VARIANT_PARAM } from './share';
import { OSHI_VOD_DEFAULT_SHARE_VARIANT, type OshiVodShareVariant } from './share-variant';

export function buildOshiVodResultSocialMetadata(opts: {
  /** 公開人物として確認済みの名前（最大12人） */
  names: string[];
  variant: OshiVodShareVariant;
  siteOrigin: string;
  description: string;
  baseOpenGraph: Metadata['openGraph'];
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const { names, variant, siteOrigin, description } = opts;
  const title = `${formatPersonList(names)}に合うサブスク診断結果`;
  const image = {
    url: buildOshiVodOgImagePath(names, variant),
    width: OSHI_VOD_IMAGE_SIZES.og.width,
    height: OSHI_VOD_IMAGE_SIZES.og.height,
    alt: `${title}｜推しサーチ`,
    type: 'image/png',
  };
  // og:url は共有されたURL（同じ人物・同じデザイン）。og:url を見直して取得し直すサービスでも同じカードになる。
  const sv = variant === OSHI_VOD_DEFAULT_SHARE_VARIANT ? '' : `&${OSHI_VOD_SHARE_VARIANT_PARAM}=${variant}`;
  return {
    openGraph: { ...opts.baseOpenGraph, title, url: `${siteOrigin}${buildOshiVodResultPath(names)}${sv}`, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
