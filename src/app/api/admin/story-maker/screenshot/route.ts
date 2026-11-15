import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { isAllowedScreenshotPath } from '@/lib/story-maker/screenshot-path';
import { STORY_SITE_ORIGIN } from '@/lib/story-maker/templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 推しサーチ公開サイトのページを、スマホ幅（390×844・2倍）で撮影して PNG を返す（ストーリーズの実画面用）。
// - 認証・CSRF は src/proxy.ts（/api/admin/:path*）。
// - Playwright の Chromium が必要なため、ローカルの管理画面（npm run dev）でだけ動く。Vercel 上では 501 を返し、
//   管理画面は「画像をアップロード」を案内する。
// - 閲覧数の計測（/api/track 等）と GA・広告タグは読み込ませない（撮影で本番の閲覧数を増やさない）。

const VIEWPORT = { width: 390, height: 844 };
const BLOCKED = [/\/api\/track/, /\/api\/search-track/, /google-analytics\.com/, /googletagmanager\.com/, /doubleclick\.net/, /\/_vercel\/insights/, /\/_vercel\/speed-insights/];

export async function POST(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json({ error: 'この環境ではスクリーンショットを取得できません。ローカルの管理画面で取得するか、画像をアップロードしてください。' }, { status: 501 });
  }
  const body = (await req.json().catch(() => ({}))) as { path?: unknown; scrollY?: unknown };
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (!isAllowedScreenshotPath(path)) {
    return NextResponse.json({ error: '撮影できるのは推しサーチの公開ページ（サブスク診断・人物ページ等）だけです。' }, { status: 400 });
  }
  const scrollY = Math.max(0, Math.min(20000, Math.round(Number(body.scrollY) || 0)));

  let browser: { close: () => Promise<void> } | null = null;
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch();
    browser = b;
    const context = await b.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
    const page = await context.newPage();
    await page.route('**/*', (route) => (BLOCKED.some((re) => re.test(route.request().url())) ? route.abort() : route.continue()));
    const url = new URL(path, STORY_SITE_ORIGIN);
    const res = await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30_000 });
    if (!res || !res.ok()) {
      return NextResponse.json({ error: `ページを開けませんでした（${res?.status() ?? '応答なし'}）: ${url.pathname}` }, { status: 502 });
    }
    // ハッシュ（#oshi-vod-picker 等）の位置ではなく、指定のスクロール位置から撮る
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(400);
    const png = await page.screenshot({ type: 'png' });
    return new NextResponse(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Screenshot-Url': encodeURI(url.toString()) },
    });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    const hint = /Executable doesn't exist|browserType\.launch/i.test(msg) ? '（Chromium が見つかりません。npx playwright install chromium を実行するか、画像をアップロードしてください）' : '';
    return NextResponse.json({ error: `スクリーンショットを取得できませんでした${hint}: ${(maskSecrets(msg) ?? "").slice(0, 300)}` }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
  }
}
