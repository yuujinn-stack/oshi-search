import 'server-only';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 推し布教カード A（ベーシック）の中央の名前だけに使う丸ゴシック（M PLUS Rounded 1c ExtraBold、約3.6MB）。
 *
 * - ライセンス：SIL Open Font License 1.1（同じフォルダの OFL-MPLUSRounded1c.txt）。出典は Google Fonts。
 * - Noto Sans CJK JP だけでは角ばった看板のような字形になるため、参考デザインのぷっくりした丸い文字に近づける目的で使う。
 * - A を描くときだけ読み込む（他のデザイン・他の画像には影響しない）。丸ゴシックに無い文字は Noto Sans JP で表示される。
 * - Vercel の関数へ確実に含めるため next.config.ts の outputFileTracingIncludes に登録している。
 */
export const OSHI_CARD_ROUNDED_FONT_FAMILY = 'Oshi Card Rounded';

const FONT_PATH = path.join(process.cwd(), 'src', 'server', 'oshi-card', 'fonts', 'MPLUSRounded1c-ExtraBold.ttf');

let cached: ArrayBuffer | null = null;

export function getOshiCardRoundedFontData(): ArrayBuffer {
  if (!cached) {
    const buffer = fs.readFileSync(FONT_PATH);
    cached = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return cached;
}
