import 'server-only';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 推し布教カード B（SSR）のカード素材（1260×1760 の PNG）。文字は含まない（名前・情報はすべてコードで描く）。
 *
 * - ssr-bg.png    … ホログラムの背景（角はフレームの外形に合わせて透明）
 * - ssr-frame.png … 金の装飾フレーム（内側・外側は透明）。背景の上、文字の下に重ねる
 * - 画像生成ツールで作った素材を、透過の不良（穴・白いにじみ）を直して使っている。
 *   作り方と元画像の扱いは docs/development-log.md を参照。
 * - B を描くときだけ読み込み、プロセス内で使い回す。
 * - Vercel の関数へ確実に含めるため next.config.ts の outputFileTracingIncludes に登録している。
 */
const DIR = path.join(process.cwd(), 'src', 'server', 'oshi-card', 'assets');

let cached: { bg: string; frame: string } | null = null;

export function ssrCardAssets(): { bg: string; frame: string } {
  if (!cached) {
    const uri = (f: string) => `data:image/png;base64,${fs.readFileSync(path.join(DIR, f)).toString('base64')}`;
    cached = { bg: uri('ssr-bg.png'), frame: uri('ssr-frame.png') };
  }
  return cached;
}
