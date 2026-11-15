// スクリーンショットを撮ってよいページのパスか（DB非依存）。
// 取得先は推しサーチの公開サイト（STORY_SITE_ORIGIN）に固定し、ここで許可した公開ページのパスだけを受け付ける
// （任意のURLを開かせない）。

const ALLOWED_PREFIXES = ['/oshi-vod', '/oshi-card', '/oshi-shopping', '/oshikatsu', '/person', '/groups', '/search', '/photobooks'];

export function isAllowedScreenshotPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) return false;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  let pathname: string;
  try {
    pathname = new URL(path, 'https://example.invalid').pathname;
  } catch {
    return false;
  }
  if (pathname.startsWith('/api') || pathname.startsWith('/admin')) return false;
  return pathname === '/' || ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
