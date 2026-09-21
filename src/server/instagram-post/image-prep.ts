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
