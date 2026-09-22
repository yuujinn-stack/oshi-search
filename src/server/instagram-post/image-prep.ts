import 'server-only';
import sharp from 'sharp';

/** リモート画像URLをメモリ上のBufferとして取得する（ローカルディスクへは書き込まない） */
export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`画像のダウンロードに失敗しました（HTTP ${res.status}）: ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** 一時的なネットワークエラーに対して短い間隔でリトライする最大回数（無限リトライはしない） */
const TRANSIENT_FETCH_RETRY_COUNT = 2;
const TRANSIENT_FETCH_RETRY_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 作品画像等、取得できなくても投稿全体を失敗させたくない画像のための安全な取得関数。
 * fetch()自体が失敗する一時的なネットワークエラー（タイムアウト等）は短い間隔で
 * 最大 TRANSIENT_FETCH_RETRY_COUNT 回までリトライする。HTTPステータスエラー（404等）は
 * リトライしても解決しないためリトライせず、いずれの場合も最終的に取得できなければ
 * 例外を投げずnullを返す（呼び出し側はnullの場合に画像なしのフォールバック表示へ切り替える）。
 */
export async function fetchImageBufferSafe(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt <= TRANSIENT_FETCH_RETRY_COUNT; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // HTTPステータスエラーは一時的なネットワーク障害ではないため、リトライせず即座にフォールバックへ
        console.error(`[image-prep] 画像取得失敗（HTTP ${res.status}、リトライ対象外のためフォールバック表示へ切り替えます）: ${url}`);
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === TRANSIENT_FETCH_RETRY_COUNT) {
        console.error(
          `[image-prep] 画像取得に失敗しました（${attempt + 1}回試行、フォールバック表示へ切り替えます）: ${url}`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
      await sleep(TRANSIENT_FETCH_RETRY_DELAY_MS);
    }
  }
  return null;
}

/** PNG等をInstagram向けの標準的なJPEG（sRGB・透過なし）へ変換する */
export async function convertToInstagramJpeg(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .flatten({ background: '#ffffff' })
    .toColorspace('srgb')
    .jpeg({ quality: 92 })
    .toBuffer();
}

export function bufferToDataUri(buffer: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}
