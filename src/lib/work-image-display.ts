// 作品画像の「表示方式」を決める共通ロジック（純粋関数。サーバー・クライアント両方から使う）。
//
// 表示方式（管理画面「作品画像表示設定」で切り替える。保存先は site_settings。src/lib/site-settings.ts）:
//   'legacy' … 従来画像表示（getWorkDisplayImage の優先順位：手動画像 > TMDb > 自動取得OG画像 > プレースホルダー）
//   'd1'     … D-1共通デザイン（白地に作品タイトルを HTML テキストで描く。従来画像は読み込まない）
//
// どの画像URLを候補にするか（優先順位・妥当性チェック）は従来どおり src/lib/work-image.ts が担当し、
// このファイルは「その画像を使うか、D-1 で描くか」だけを決める。DB の画像URLは一切変更しない。
//
// ── 将来の拡張（使用許諾済みの公式画像を作品単位で優先する） ──────────────────────
// WorkVisualInput.licensedImageUrl に「使用許諾を確認済みの公式画像URL」を渡すと、
// D-1 表示中でもその作品だけは画像を表示する。現時点ではどこからも渡していない（DB列も未作成）。
// 追加するときは works に専用の列（例: licensed_image_url）を作り、表示側で
// resolveWorkVisual({ ...work, licensedImageUrl }) と渡すだけでよい（各カードの分岐は変更不要）。
import { getWorkDisplayImage, getRenderableWorkImageUrl, isPlausibleImageUrl, type WorkImageInput } from '@/lib/work-image';

export const WORK_IMAGE_DISPLAY_MODES = ['d1', 'legacy'] as const;
export type WorkImageDisplayMode = (typeof WORK_IMAGE_DISPLAY_MODES)[number];

/** 設定が未保存・読み込み失敗のときの表示方式（＝従来どおり。デプロイしただけでは見た目は変わらない） */
export const DEFAULT_WORK_IMAGE_DISPLAY_MODE: WorkImageDisplayMode = 'legacy';

export const WORK_IMAGE_DISPLAY_MODE_LABEL: Record<WorkImageDisplayMode, string> = {
  d1: 'D-1共通デザイン',
  legacy: '従来画像表示',
};

export function isWorkImageDisplayMode(v: unknown): v is WorkImageDisplayMode {
  return typeof v === 'string' && (WORK_IMAGE_DISPLAY_MODES as readonly string[]).includes(v);
}

// ── プレビュー環境専用の表示方式 ──────────────────────────────────────────────
// Vercel のプレビュー環境は本番と同じDBを読むため、本番の設定を変えずにプレビューで D-1 を確認できるよう、
// 環境変数 WORK_IMAGE_DISPLAY_PREVIEW_MODE（'d1' | 'legacy'）で表示方式を上書きできる。
// VERCEL_ENV === 'preview' のときだけ有効。本番（production）・ローカルでは値があっても無視する。
export const WORK_IMAGE_DISPLAY_PREVIEW_ENV = 'WORK_IMAGE_DISPLAY_PREVIEW_MODE';

export function getPreviewOverrideMode(
  env: Record<string, string | undefined> = process.env,
): WorkImageDisplayMode | null {
  if (env.VERCEL_ENV !== 'preview') return null;
  const v = env[WORK_IMAGE_DISPLAY_PREVIEW_ENV]?.trim();
  return isWorkImageDisplayMode(v) ? v : null;
}

export interface WorkVisualInput extends WorkImageInput {
  /** 将来用：使用許諾済みの公式画像URL（D-1 表示中でも優先して表示する）。現在は未使用 */
  licensedImageUrl?: string;
}

export type WorkVisual =
  | { kind: 'image'; url: string; licensed: boolean }
  | { kind: 'd1' }
  | { kind: 'none' };

/**
 * 作品のメイン画像の描き方を決める。
 *   d1     … 許諾済み公式画像があればそれ、なければ D-1（従来の画像URLは返さない＝読み込まない）
 *   legacy … 従来どおり getWorkDisplayImage の結果。画像が無ければ none（各カードの従来プレースホルダー）
 */
export function resolveWorkVisual(work: WorkVisualInput, mode: WorkImageDisplayMode): WorkVisual {
  if (mode === 'd1') {
    const licensed = work.licensedImageUrl && isPlausibleImageUrl(work.licensedImageUrl)
      ? getRenderableWorkImageUrl(work.licensedImageUrl)
      : undefined;
    return licensed ? { kind: 'image', url: licensed, licensed: true } : { kind: 'd1' };
  }
  const url = getRenderableWorkImageUrl(getWorkDisplayImage(work));
  return url ? { kind: 'image', url, licensed: false } : { kind: 'none' };
}

/**
 * 既に「従来の画像URL」（getWorkDisplayImage 済み・または DB の posterUrl そのもの）だけを持っている
 * 呼び出し側用（/vod の VodPageWork、ランキングの RankedWork、グループページの小さな一覧など）。
 * legacy では渡された URL をそのまま使う（従来の表示と完全に同じ）。
 */
export function resolveWorkVisualFromUrl(
  legacyUrl: string | undefined | null,
  mode: WorkImageDisplayMode,
  licensedImageUrl?: string,
): WorkVisual {
  if (mode === 'd1') return resolveWorkVisual({ licensedImageUrl }, 'd1');
  return legacyUrl ? { kind: 'image', url: legacyUrl, licensed: false } : { kind: 'none' };
}

// ── D-1 のタイトルの大きさ ──────────────────────────────────────────────────
// タイトルは全文を表示する（省略しない）。カード幅に対する相対単位（cqi）で文字の大きさを決め、
// 長さに応じて段階的に小さくする。改行はブラウザの折り返しに任せる（日本語は禁則処理、
// 長い英単語は overflow-wrap: anywhere で枠からはみ出さない）。
// 半角文字（英数字・記号）は全角の約半分の幅として数える。

export type D1TitleSize = 'xl' | 'l' | 'm' | 's' | 'xs' | 'xxs' | 'min';

/** 表示幅の目安（全角=1、半角=0.55、空白=0.3）。サロゲートペア（絵文字等）も1文字として数える */
export function getD1TitleWeightedLength(title: string): number {
  let n = 0;
  for (const ch of title.trim()) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === ' ' || ch === '　') n += ch === ' ' ? 0.3 : 1;
    else if (cp <= 0x7e || (cp >= 0xff61 && cp <= 0xff9f)) n += 0.55; // ASCII・半角カナ
    else n += 1;
  }
  return Math.round(n * 100) / 100;
}

export function getD1TitleSize(title: string): D1TitleSize {
  const n = getD1TitleWeightedLength(title);
  if (n <= 5) return 'xl';
  if (n <= 9) return 'l';
  if (n <= 14) return 'm';
  if (n <= 22) return 's';
  if (n <= 34) return 'xs';
  if (n <= 50) return 'xxs';
  return 'min';
}

/** 上部の小さな表示（作品種類・公開年）の項目。不明な項目は出さない */
export function getD1MetaParts(typeLabel?: string | null, releaseYear?: number | null): string[] {
  const parts: string[] = [];
  const t = typeLabel?.trim();
  if (t) parts.push(t);
  if (typeof releaseYear === 'number' && Number.isFinite(releaseYear) && releaseYear > 0) parts.push(String(releaseYear));
  return parts;
}

/** 上部の小さな表示を1つの文字列にしたもの。両方不明なら空文字 */
export function formatD1Meta(typeLabel?: string | null, releaseYear?: number | null): string {
  return getD1MetaParts(typeLabel, releaseYear).join(' · ');
}

// ── 作品ページの OGP／SNS 共有画像・構造化データ（JSON-LD）の image ─────────────────
// D-1 のときは D-1 デザインの OG 画像（/work/[workId]/og。src/app/work/[workId]/og/route.tsx）を使い、
// 従来の作品画像URLは metadata・JSON-LD に一切出さない。従来画像表示のときは従来どおり。
export function buildWorkD1OgImagePath(workId: string): string {
  return `/work/${encodeURIComponent(workId)}/og`;
}

export function resolveWorkShareImage(
  work: WorkVisualInput,
  mode: WorkImageDisplayMode,
  workId: string,
): { url: string; kind: 'd1' | 'image' } | null {
  const visual = resolveWorkVisual(work, mode);
  if (visual.kind === 'image') return { url: visual.url, kind: 'image' };
  if (visual.kind === 'd1') return { url: buildWorkD1OgImagePath(workId), kind: 'd1' };
  return null;
}

/** JSON-LD 用に絶対URLへ（metadata は layout の metadataBase が解決するため相対のままでよい） */
export function toAbsoluteUrl(url: string, siteOrigin: string): string {
  return url.startsWith('/') ? `${siteOrigin.replace(/\/$/, '')}${url}` : url;
}

/** D-1 の OG 画像の大きさ（og:image:width / height） */
export const WORK_D1_OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
