// VOD配信CTA（呼びかけボタン）の共通ロジック。
// 元々 src/app/work/[workId]/page.tsx にローカル定義されていたものを、
// 人物ページ（今すぐ見られる作品セクション）でも同じ表示規則・同じ公式URLフォールバック
// を使うために切り出した。
//
// 【CTA配色方針（重要）】
// availabilityType（見放題/無料/レンタル/購入）による色分けは廃止した。
// VOD_TYPE_CONFIG は now 補助チップ用の icon/label/btnLabel と、常にニュートラルな
// （グレー系のみの）border/bg/labelColorだけを持つ。CTAボタン本体の色は
// VOD_SERVICE_STYLE / getVodServiceStyle() が配信サービス単位で決定する
// （globals.css の .affiliate-slot--work-provider[data-vod-service] と値を同期させること）。
import type { VodProvider } from '@/types/vod';
import { normalizeProviderName } from '@/lib/vod-dedup';

// ─── VOD 種別ごとの表示設定（補助チップ用。常にニュートラル配色） ──────────────
export const VOD_TYPE_CONFIG: Record<string, {
  label: string;
  btnLabel: string;
  border: string;
  bg: string;
  labelColor: string;
}> = {
  flatrate: { label: '見放題',      btnLabel: '今すぐ見る',   border: 'border-gray-200', bg: 'bg-gray-50', labelColor: 'text-gray-600' },
  free:     { label: '無料',         btnLabel: '無料で見る',   border: 'border-gray-200', bg: 'bg-gray-50', labelColor: 'text-gray-600' },
  ads:      { label: '広告付き無料', btnLabel: '無料で見る',   border: 'border-gray-200', bg: 'bg-gray-50', labelColor: 'text-gray-600' },
  rent:     { label: 'レンタル',     btnLabel: 'レンタルする', border: 'border-gray-200', bg: 'bg-gray-50', labelColor: 'text-gray-600' },
  buy:      { label: '購入',         btnLabel: '購入する',     border: 'border-gray-200', bg: 'bg-gray-50', labelColor: 'text-gray-600' },
  unknown:  { label: '配信',         btnLabel: '詳細を見る',   border: 'border-gray-200', bg: 'bg-gray-50', labelColor: 'text-gray-600' },
};

// ─── 配信サービス別 CTAボタンスタイル ────────────────────────────────────────
// 構造（高さ・padding・角丸・フォント・ロゴサイズ位置・矢印・hover/focus/shadow）は
// 全サービス共通（各コンポーネント側の共通クラスで統一）。ここではbackground/color等、
// サービスごとに変わってよい値だけを持つ。
export interface VodServiceStyle {
  /** CSS background値（単色 or グラデーション） */
  background: string;
  /** CTAテキスト・矢印の色 */
  color: string;
  /** 指定時はサイト共通の hover（brightness暗化）の代わりにこの背景色を使う（YouTubeのみ） */
  hoverBackground?: string;
  /** 明るい背景色向けの薄い枠線（YouTubeのみ） */
  border?: string;
  /** ロゴだけでは判別しづらいサービス向けの小さな差し色アクセント（ABEMAの黄色ドット等） */
  accentColor?: string;
}

const DEFAULT_SERVICE_STYLE: VodServiceStyle = {
  // 個別デザイン未定義のサービス（wowow/niconico等）用の中立フォールバック
  background: '#374151',
  color: '#ffffff',
};

export const VOD_SERVICE_STYLE: Record<string, VodServiceStyle> = {
  // #40E030 はProviderLogoで実際に表示されているHuluロゴ画像から抽出した代表色
  // （新規アセット取得は行わず、既存表示アセットの色をそのまま採用）。
  hulu:             { background: '#40E030', color: '#052e16' },
  unext:            { background: '#0D0D0D', color: '#ffffff' },
  lemino:           { background: 'linear-gradient(90deg, #BE185D 0%, #C2410C 100%)', color: '#ffffff' },
  netflix:          { background: '#111111', color: '#ffffff' },
  // 濃紺→ブルーの控えめなグラデーション。Disney+（ネイビー→ティール）・TVer（水色→青）とは
  // 色相を青系のみに絞ることで区別している。
  primevideo:       { background: 'linear-gradient(90deg, #0B2545 0%, #14508C 100%)', color: '#ffffff' },
  amazonprimevideo: { background: 'linear-gradient(90deg, #0B2545 0%, #14508C 100%)', color: '#ffffff' },
  dmmtv:            { background: '#FFDD00', color: '#111111' },
  // #F05808 はProviderLogoで実際に表示されているTELASAロゴ画像から抽出した代表色。
  // そのままでは白文字とのコントラストが不足するため、色相・彩度を保ったまま明度のみ
  // 約80%に落として調整している。
  telasa:           { background: '#C04606', color: '#ffffff' },
  fod:              { background: '#E4002B', color: '#ffffff' },
  fodpremium:       { background: '#E4002B', color: '#ffffff' },
  abema:            { background: '#0B0B0B', color: '#ffffff' },
  abemat:           { background: '#0B0B0B', color: '#ffffff' },
  tver:             { background: 'linear-gradient(90deg, #7DD3FC 0%, #2563EB 45%, #1E3A8A 100%)', color: '#ffffff' },
  disneyplus:       { background: 'linear-gradient(90deg, #0B1F3A 0%, #0E6B7A 100%)', color: '#ffffff' },
  youtube:          { background: '#ffffff', color: '#111111', border: '1px solid #E5E7EB', hoverBackground: '#FEF2F2' },
  youtubepremium:   { background: '#ffffff', color: '#111111', border: '1px solid #E5E7EB', hoverBackground: '#FEF2F2' },
  nhkondemand:      { background: '#C2540A', color: '#ffffff' },
};

/** providerName（未正規化でも可）から配信サービス単位のCTAスタイルを返す */
export function getVodServiceStyle(providerName: string): VodServiceStyle {
  const norm = normalizeProviderName(providerName);
  return VOD_SERVICE_STYLE[norm] ?? DEFAULT_SERVICE_STYLE;
}

// 定額配信（flatrate）を最優先、次に無料・広告付き、購入・レンタルは後ろ
export const VOD_TYPE_ORDER: Record<string, number> = { flatrate: 0, free: 1, ads: 2, rent: 3, buy: 4, unknown: 5 };

// ─── 配信サービス公式 URL マッピング（p.link がない場合のフォールバック）──────
export const VOD_OFFICIAL_URLS: Record<string, string> = {
  'lemino':             'https://lemino.docomo.ne.jp/',
  'hulu':               'https://www.hulu.jp/',
  'unext':              'https://video.unext.jp/',
  'netflix':            'https://www.netflix.com/jp/',
  'primevideo':         'https://www.amazon.co.jp/gp/video/storefront',
  'amazonprimevideo':   'https://www.amazon.co.jp/gp/video/storefront',
  'disneyplus':         'https://www.disneyplus.com/ja-jp',
  'abema':              'https://abema.tv/',
  'abemat':             'https://abema.tv/',
  'fod':                'https://fod.fujitv.co.jp/',
  'telasa':             'https://telasa.jp/',
  'dmmtv':              'https://tv.dmm.com/',
  'rakutentv':          'https://tv.rakuten.co.jp/',
  'tversionrakuten':    'https://tv.rakuten.co.jp/',
  'nhkondemand':        'https://www.nhk-ondemand.jp/',
  'paravi':             'https://www.paravi.jp/',
  'tver':               'https://tver.jp/',
  'wowow':              'https://www.wowow.co.jp/',
  'bandaichannel':      'https://www.b-ch.com/',
  'niconico':           'https://www.nicovideo.jp/',
  'gyao':               'https://gyao.yahoo.co.jp/',
  'hikari':             'https://hikaritv.net/',
  'jcomtv':             'https://v.jcom.co.jp/',
};

export function getVodLink(p: VodProvider): string | undefined {
  if (p.link) return p.link;
  const norm = normalizeProviderName(p.providerName);
  return VOD_OFFICIAL_URLS[norm];
}
