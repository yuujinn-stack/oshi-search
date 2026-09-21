import 'server-only';

/**
 * マジックバイトから画像のMIMEタイプを判定する（PNG/JPEG以外はJPEG扱いにフォールバック）。
 *
 * sharpを一切importしない、依存の軽い判定専用ファイル。
 * `image-prep.ts`（sharpに依存するJPEG変換処理）と分離しているのは、
 * この判定だけを必要とするルート（例: photo/route.tsのGETハンドラ）が、
 * 使いもしないsharpのネイティブバイナリを巻き込んで読み込まずに済むようにするため
 * （Vercelでのsharpロード失敗が、本来sharpを使わないGETリクエストまで
 * 巻き添えでエラーにしていた問題の再発防止）。
 */
export function detectImageMimeType(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  return 'image/jpeg';
}
