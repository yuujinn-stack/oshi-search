import { Space_Grotesk, Space_Mono, Noto_Sans_JP } from 'next/font/google';
import '@/app/graphic-site.css';

// 公開ページ共通デザイン「C. Graphic Pop」（src/app/graphic-site.css）を読み込むサーバーコンポーネント。
// トップ・人物ページ以外の公開ページで、ルート要素に `oshi-graphic-page`（＋ `oshi-graphic-page--{種別}`）
// クラスを付け、その中でこのコンポーネントを1回描画する。
// フォントはトップ・人物ページと同じ方針（日本語Webフォントは 900 の見出し・ロゴ用のみ。本文は既存フォントスタック）。
const graphicDisplayFont = Space_Grotesk({ subsets: ['latin'], weight: ['700'], display: 'swap' });
const graphicMonoFont = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], display: 'swap' });
const graphicJpFont = Noto_Sans_JP({ subsets: ['latin'], weight: ['900'], display: 'swap', preload: false });

const GRAPHIC_SITE_FONT_VARS_CSS = `html:not([data-proto]):has(.oshi-graphic-page){--graphic-font-display:${graphicDisplayFont.style.fontFamily},system-ui,sans-serif;--graphic-font-jp:${graphicJpFont.style.fontFamily},'Hiragino Sans',system-ui,sans-serif;--graphic-font-mono:${graphicMonoFont.style.fontFamily},ui-monospace,monospace;}`;

export default function GraphicPageStyles() {
  return <style dangerouslySetInnerHTML={{ __html: GRAPHIC_SITE_FONT_VARS_CSS }} />;
}
