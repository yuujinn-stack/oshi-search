// 推し布教カードの画像（PNG）のレスポンス生成。2つの入口で共有する：
//   /api/oshi-card/image … 作成画面のプレビュー・画像保存・端末の共有（feed / story）
//   /oshi-card/og        … カードのURLを X・LINE に貼ったときのカード画像（og 固定）。
//                           robots.txt で /api/ はクロール禁止のため、クローラーが取得できる場所に置く。
//
// 不正なパラメータ・大量アクセスへの対策（サブスク診断の画像と同じ方式）：
// - 人物は公開人物として存在する名前だけ。作品はその人物の公開作品の id だけ（他の人物の作品・非公開・存在しない id は除く）。
// - URL を正規形（有効な作品だけ・重複なし・既定値は省略・未知のキーなし）にそろえ、違えば 308 で正規形へ。
// - 有効な作品が1件も無ければ 400。データ取得に失敗したら 500（キャッシュしない）。
// - CDN で1時間キャッシュ（最大1日は古い画像を返しつつ再生成）。関数まで届いた生成は IP ごとに1分40回まで。
import 'server-only';
import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { getNotoSansJpBoldFontData } from '@/server/instagram-post/fonts/font-loader';
import { clientIp, isOverRenderRateLimit } from '@/server/share-image/rate-limit';
import { loadOshiCardPerson } from '@/lib/oshi-card/data';
import { resolveOshiCardWorks } from '@/lib/oshi-card/core';
import {
  OSHI_CARD_DEFAULT_PHRASE,
  OSHI_CARD_DEFAULT_VARIANT,
  OSHI_CARD_IMAGE_SIZES,
  oshiCardPhraseText,
  parseOshiCardImageSize,
  parseOshiCardParams,
  type OshiCardImageSize,
  type OshiCardSelection,
} from '@/lib/oshi-card/params';
import { buildOshiCardImageElement, OSHI_CARD_IMAGE_FONT_FAMILY } from '@/server/oshi-card/card-image';

export const OSHI_CARD_IMAGE_RATE_LIMIT_PER_MINUTE = 40;

const CACHE_OK = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_REDIRECT = 'public, max-age=3600, s-maxage=86400';

/**
 * 受け取ったクエリが正規形か（p・w は検証済みの値と一致、size・v・ph は既定値なら省略、ほかのキーなし）。
 * fixedSize の入口（/oshi-card/og）では size を受け付けない。純粋関数（テスト用に export）。
 */
export function isCanonicalCardQuery(sp: URLSearchParams, sel: OshiCardSelection, size: OshiCardImageSize, fixedSize: boolean): boolean {
  const allowed = new Set(fixedSize ? ['p', 'w', 'v', 'ph'] : ['p', 'w', 'v', 'ph', 'size']);
  for (const key of sp.keys()) if (!allowed.has(key)) return false;
  const p = sp.getAll('p');
  if (p.length !== 1 || p[0] !== sel.person) return false;
  const w = sp.getAll('w');
  if (w.length !== sel.workIds.length || w.some((id, i) => id !== sel.workIds[i])) return false;
  const one = (k: string, expected: string, def: string) => {
    const v = sp.getAll(k);
    return expected === def ? v.length === 0 : v.length === 1 && v[0] === expected;
  };
  if (!one('v', sel.variant, OSHI_CARD_DEFAULT_VARIANT)) return false;
  if (!one('ph', sel.phrase, OSHI_CARD_DEFAULT_PHRASE)) return false;
  if (!fixedSize && !one('size', size, 'feed')) return false;
  return true;
}

const bad = (error: string, status: number, cache: string) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': cache } });

export async function respondOshiCardImage(
  req: NextRequest,
  opts: { fixedSize?: OshiCardImageSize; buildPath: (sel: OshiCardSelection, size: OshiCardImageSize) => string; noindex?: boolean },
): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const parsed = parseOshiCardParams({ p: sp.getAll('p'), w: sp.getAll('w'), v: sp.getAll('v'), ph: sp.getAll('ph') });
  const size = opts.fixedSize ?? parseOshiCardImageSize(sp.get('size'));
  if (!parsed.person) return bad('no person', 400, 'public, max-age=60, s-maxage=300');

  let person;
  try {
    person = await loadOshiCardPerson(parsed.person);
  } catch (err) {
    console.error('[oshi-card/image] load failed:', String(err));
    return bad('failed to load', 500, 'no-store');
  }
  if (!person) return bad('unknown person', 400, 'public, max-age=60, s-maxage=300');
  const { works } = resolveOshiCardWorks(parsed.workIds, person.candidates);
  if (works.length === 0) return bad('no valid works', 400, 'public, max-age=60, s-maxage=300');

  const sel: OshiCardSelection = { person: person.name, workIds: works.map((w) => w.id), variant: parsed.variant, phrase: parsed.phrase };
  if (!isCanonicalCardQuery(sp, sel, size, !!opts.fixedSize)) {
    const res = NextResponse.redirect(new URL(opts.buildPath(sel, size), req.nextUrl.origin), 308);
    res.headers.set('Cache-Control', CACHE_REDIRECT);
    return res;
  }

  if (await isOverRenderRateLimit('oshi-card:image:rl', clientIp(req), OSHI_CARD_IMAGE_RATE_LIMIT_PER_MINUTE)) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  }

  try {
    const { width, height } = OSHI_CARD_IMAGE_SIZES[size];
    const data = {
      person: person.name,
      group: person.group,
      phrase: oshiCardPhraseText(sel.phrase),
      works: works.map((w) => ({ title: w.title, typeLabel: w.typeLabel, year: w.year })),
    };
    return new ImageResponse(buildOshiCardImageElement(data, size, sel.variant), {
      width,
      height,
      fonts: [{ name: OSHI_CARD_IMAGE_FONT_FAMILY, data: getNotoSansJpBoldFontData(), weight: 700, style: 'normal' }],
      headers: { 'Cache-Control': CACHE_OK, ...(opts.noindex ? { 'X-Robots-Tag': 'noindex' } : {}) },
    });
  } catch (err) {
    console.error('[oshi-card/image] render failed:', String(err));
    return bad('failed to render', 500, 'no-store');
  }
}
