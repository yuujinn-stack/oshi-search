// 診断結果画像（PNG）のレスポンス生成。2つの入口で共有する：
//   /api/oshi-vod/image … 結果ページのプレビュー・画像保存・端末の共有（feed / story）
//   /oshi-vod/og        … 結果URLを X・LINE に貼ったときのカード画像（og 固定）。
//                          robots.txt で /api/ はクロール禁止のため、X 等のクローラーが取得できる場所に置く。
//
// 不正なパラメータ・大量アクセスへの対策：
// - 人物は公開人物として存在する名前だけ・最大12人（任意文字列は描画しない）。サイズ・デザインは許可値のみ。
// - URL を正規形（公開人物だけ・重複なし・既定値は省略・未知のパラメータなし）にそろえ、違えば 308 で正規形へ。
//   CDN のキャッシュキーが無駄に増えない（同じ画像を何度も生成しない）。
// - CDN で1時間キャッシュ（最大1日は古い画像を返しつつ再生成）。CDN で返る分は関数を起動しない。
// - 関数まで届いた生成リクエストは IP ごとに1分あたりの上限を設ける（Upstash Redis。使えない場合は制限なしで続行）。
import 'server-only';
import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis';
import { getOshiVodKnownPersons, loadOshiVodDiagnosis } from '@/lib/oshi-vod/data';
import {
  OSHI_VOD_IMAGE_SIZES,
  OSHI_VOD_MAX_PERSONS,
  parseImageSize,
  parseOshiVodParams,
  resolveKnownNames,
  type OshiVodImageSize,
} from '@/lib/oshi-vod/params';
import { buildOshiVodImageData } from '@/lib/oshi-vod/image-data';
import { OSHI_VOD_DEFAULT_SHARE_VARIANT, parseOshiVodShareVariant, type OshiVodShareVariant } from '@/lib/oshi-vod/share-variant';
import { buildOshiVodImageElement, OSHI_VOD_IMAGE_FONT_FAMILY } from '@/server/oshi-vod/result-image';
import { getNotoSansJpBoldFontData } from '@/server/instagram-post/fonts/font-loader';

/** 関数まで届いた画像生成の上限（IPごと・1分あたり）。人が使う分には届かない値 */
export const OSHI_VOD_IMAGE_RATE_LIMIT_PER_MINUTE = 40;

const CACHE_OK = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_REDIRECT = 'public, max-age=3600, s-maxage=86400';

export interface OshiVodImageRequestShape {
  names: string[];
  size: OshiVodImageSize;
  variant: OshiVodShareVariant;
}

/**
 * 受け取ったクエリが正規形か（p＝公開人物だけ・重複なし・最大12人、size・v は既定値なら省略、ほかのキーなし）。
 * fixedSize の入口（/oshi-vod/og）では size を受け付けない。純粋関数（テスト用に export）。
 */
export function isCanonicalImageQuery(sp: URLSearchParams, expected: OshiVodImageRequestShape, fixedSize: boolean): boolean {
  const allowed = new Set(fixedSize ? ['p', 'v'] : ['p', 'size', 'v']);
  for (const key of sp.keys()) if (!allowed.has(key)) return false;
  const p = sp.getAll('p');
  if (p.length !== expected.names.length || p.some((n, i) => n !== expected.names[i])) return false;
  const size = sp.getAll('size');
  if (!fixedSize && (expected.size === 'feed' ? size.length !== 0 : size.length !== 1 || size[0] !== expected.size)) return false;
  const v = sp.getAll('v');
  if (expected.variant === OSHI_VOD_DEFAULT_SHARE_VARIANT ? v.length !== 0 : v.length !== 1 || v[0] !== expected.variant) return false;
  return true;
}

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** true＝上限超え。Redis が使えない・失敗した場合は制限しない（画像が出ないことを避ける）。テスト用に store を差し替え可 */
export async function isOverOshiVodImageRateLimit(
  ip: string,
  store: RateLimitStore | null = getRedis(),
  now: number = Date.now(),
): Promise<boolean> {
  if (!store) return false;
  try {
    const key = `oshi-vod:image:rl:${ip}:${Math.floor(now / 60_000)}`;
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, 120);
    return count > OSHI_VOD_IMAGE_RATE_LIMIT_PER_MINUTE;
  } catch {
    return false;
  }
}

export async function respondOshiVodImage(
  req: NextRequest,
  opts: { fixedSize?: OshiVodImageSize; buildPath: (shape: OshiVodImageRequestShape) => string; noindex?: boolean },
): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const parsed = parseOshiVodParams({ p: sp.getAll('p') });
  const size = opts.fixedSize ?? parseImageSize(sp.get('size'));
  const variant = parseOshiVodShareVariant(sp.get('v'));
  const known = await getOshiVodKnownPersons();
  const { valid } = resolveKnownNames(parsed.names, new Set(known.keys()));
  if (valid.length === 0) {
    return NextResponse.json({ error: 'no valid persons' }, { status: 400, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
  }

  const shape: OshiVodImageRequestShape = { names: valid.slice(0, OSHI_VOD_MAX_PERSONS), size, variant };
  if (!isCanonicalImageQuery(sp, shape, !!opts.fixedSize)) {
    const res = NextResponse.redirect(new URL(opts.buildPath(shape), req.nextUrl.origin), 308);
    res.headers.set('Cache-Control', CACHE_REDIRECT);
    return res;
  }

  if (await isOverOshiVodImageRateLimit(clientIp(req))) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  }

  try {
    const result = await loadOshiVodDiagnosis(shape.names);
    const { width, height } = OSHI_VOD_IMAGE_SIZES[size];
    return new ImageResponse(buildOshiVodImageElement(buildOshiVodImageData(result), size, variant), {
      width,
      height,
      fonts: [{ name: OSHI_VOD_IMAGE_FONT_FAMILY, data: getNotoSansJpBoldFontData(), weight: 700, style: 'normal' }],
      headers: {
        'Cache-Control': CACHE_OK,
        ...(opts.noindex ? { 'X-Robots-Tag': 'noindex' } : {}),
      },
    });
  } catch (err) {
    console.error('[oshi-vod/image] failed:', String(err));
    return NextResponse.json({ error: 'failed to render' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
