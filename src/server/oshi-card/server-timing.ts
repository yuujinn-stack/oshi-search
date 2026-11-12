/**
 * 推し布教カード B（SSR）の画像生成の計測（Vercel の Preview 環境だけ）。
 *
 * - VERCEL_ENV=preview かつ OSHI_CARD_SERVER_TIMING=1 のときだけ有効。Production・ローカルでは常に無効。
 * - レスポンスの Server-Timing ヘッダーに「数値だけ」を入れる（接続先・認証情報・ファイルパス・人物名などの文字列は入れない）。
 *   render（要素の組み立て＋PNG 生成, ms）・recompress（可逆再圧縮, ms）・font（明朝体の読み込み, ms。2回目以降は 0）・
 *   cold（この関数インスタンスで最初の B の生成なら 1）・rss（メモリ, MB）・raw / png（再圧縮前後の大きさ, KB）。
 *   ※ Server-Timing の書式上、時間以外の値も dur= に入れている。
 * - 有効なときは計測のため CDN にキャッシュさせない（Cache-Control: no-store）。
 */
export interface OshiCardTimingMetrics {
  renderMs: number;
  recompressMs: number;
  fontMs: number;
  cold: boolean;
  rssMb: number;
  rawKb: number;
  pngKb: number;
}

export function oshiCardServerTimingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'preview' && env.OSHI_CARD_SERVER_TIMING === '1';
}

const num = (n: number): string => (Number.isFinite(n) ? String(Math.max(0, Math.round(n * 10) / 10)) : '0');

export function formatOshiCardServerTiming(m: OshiCardTimingMetrics): string {
  return [
    `render;dur=${num(m.renderMs)}`,
    `recompress;dur=${num(m.recompressMs)}`,
    `font;dur=${num(m.fontMs)}`,
    `cold;dur=${m.cold ? 1 : 0}`,
    `rss;dur=${num(m.rssMb)}`,
    `raw;dur=${num(m.rawKb)}`,
    `png;dur=${num(m.pngKb)}`,
  ].join(', ');
}
