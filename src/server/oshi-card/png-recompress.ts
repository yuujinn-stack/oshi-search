import 'server-only';
import sharp from 'sharp';

/**
 * 推し布教カード B（SSR）の画像の PNG を可逆（ロスレス）で再圧縮する。
 *
 * - B はカード素材（ホログラム・ラメ）の細かな質感で next/og の PNG が約4.6〜4.8MB になり、
 *   Vercel 関数のレスポンス上限（4.5MB）を超えうるため、PNG のまま圧縮し直す（約3.0MB）。
 * - 可逆圧縮のみ：色数削減・パレット化はしない（palette: false）。アルファチャンネル（カードの角の透明）も保つ。
 *   画素は1つも変わらない（src/lib/__tests__/oshi-card-png-recompress.test.ts）。
 * - compressionLevel 6 + adaptiveFiltering：レベル9より 約0.17MB 大きいが処理が 約1.3秒→約0.26秒 と速い。
 * - 再圧縮しても小さくならなかった・失敗したときは元の PNG を返す。
 */
export async function recompressPngLossless(png: Buffer): Promise<Buffer> {
  try {
    const out = await sharp(png).png({ compressionLevel: 6, adaptiveFiltering: true, palette: false }).toBuffer();
    return out.length < png.length ? out : png;
  } catch (err) {
    console.error('[oshi-card/image] png recompress failed:', String(err));
    return png;
  }
}
