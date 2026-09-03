// VOD配信CTA（呼びかけボタン）の共通ロジック。
// 元々 src/app/work/[workId]/page.tsx にローカル定義されていたものを、
// 人物ページ（今すぐ見られる作品セクション）でも同じ表示規則・同じ公式URLフォールバック
// を使うために切り出した。内容・値は一切変更していない（挙動は変更なし）。
import type { VodProvider } from '@/types/vod';
import { normalizeProviderName } from '@/lib/vod-dedup';

// ─── VOD 種別ごとの表示設定 ──────────────────────────────────────────────────
export const VOD_TYPE_CONFIG: Record<string, {
  icon: string;
  label: string;
  btnLabel: string;
  border: string;
  bg: string;
  btn: string;
  labelColor: string;
}> = {
  flatrate: { icon: '🟢', label: '見放題',      btnLabel: '今すぐ見る',   border: 'border-green-200',  bg: 'bg-green-50',  btn: 'bg-green-600 hover:bg-green-700',   labelColor: 'text-green-700' },
  free:     { icon: '🟢', label: '無料',         btnLabel: '無料で見る',   border: 'border-green-200',  bg: 'bg-green-50',  btn: 'bg-green-600 hover:bg-green-700',   labelColor: 'text-green-700' },
  ads:      { icon: '🟡', label: '広告付き無料', btnLabel: '無料で見る',   border: 'border-yellow-200', bg: 'bg-yellow-50', btn: 'bg-yellow-600 hover:bg-yellow-700', labelColor: 'text-yellow-700' },
  rent:     { icon: '🟠', label: 'レンタル',     btnLabel: 'レンタルする', border: 'border-orange-200', bg: 'bg-orange-50', btn: 'bg-orange-600 hover:bg-orange-700', labelColor: 'text-orange-700' },
  buy:      { icon: '🔵', label: '購入',         btnLabel: '購入する',     border: 'border-blue-200',   bg: 'bg-blue-50',   btn: 'bg-blue-600 hover:bg-blue-700',     labelColor: 'text-blue-700' },
  unknown:  { icon: '⬜', label: '配信',         btnLabel: '詳細を見る',   border: 'border-gray-200',   bg: 'bg-gray-50',   btn: 'bg-gray-600 hover:bg-gray-700',     labelColor: 'text-gray-600' },
};

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
