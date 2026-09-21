import 'server-only';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Noto Sans CJK JP (Bold) フォントデータの読み込み。
 *
 * next/ogのImageResponse（Satori）はフォントを明示的に渡す必要があり、日本語グリフは
 * 標準では一切含まれていない。当初は@fontsource/noto-sans-jpの「japanese」サブセット
 * （約1.4MB、Base64文字列としてTSファイルに直接埋め込み）を使っていたが、実際に
 * 「アイシー～瞬間記憶捜査・柊班～」のようなタイトルをレンダリングしたところ、
 * 波ダッシュ（～）のグリフが含まれておらず表示が欠ける（豆腐文字になる）ことが判明した。
 * 作品タイトルは任意の文字を含みうる動的な文字列のため、日本語の記号・句読点を含めて
 * 網羅的にカバーしているNoto Sans CJK JP（フルセット、約17MB）に切り替えている。
 *
 * ファイルサイズが大きいため、Base64埋め込みではなくファイルとして配置し、
 * fs.readFileSyncで読み込む方式にしている（Node.jsランタイムではnext/ogの公式ドキュメントで
 * 明示的にサポートされている方法）。Vercelへのデプロイ時にこのファイルが
 * サーバーレス関数へ確実に含まれるよう、next.config.tsのoutputFileTracingIncludesで
 * 明示的に含めている。
 */
const FONT_PATH = path.join(process.cwd(), 'src', 'server', 'instagram-post', 'fonts', 'NotoSansCJKjp-Bold.otf');

let cachedFontData: ArrayBuffer | null = null;

export function getNotoSansJpBoldFontData(): ArrayBuffer {
  if (!cachedFontData) {
    const buffer = fs.readFileSync(FONT_PATH);
    cachedFontData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return cachedFontData;
}
