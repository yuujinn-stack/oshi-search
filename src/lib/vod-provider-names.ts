// VOD対応14サービスの「正規化スラグ → 公開表示名」Single Source of Truth。
//
// このファイルは意図的に他モジュールへ依存しない（normalizeProviderName等を
// importしない）。理由: vod-dedup.ts（getVodProviderDisplayInfo）と
// vod-page.ts（VOD_PAGE_PROVIDERS）の両方から参照される可能性があり、
// どちらか一方に依存すると循環importになるため。
//
// キーはnormalizeProviderName()が返す正規化済みスラグと完全一致させること
// （vod-page.test.tsでVOD_PAGE_PROVIDERSのnormalizedSlugとの整合を検証している）。
// 表示名はvod-page.tsのVOD_PAGE_PROVIDERSで既に確定している正式表記と同一にする。
export const VOD_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  hulu: 'Hulu',
  unext: 'U-NEXT',
  netflix: 'Netflix',
  primevideo: 'Prime Video',
  disneyplus: 'Disney+',
  dmmtv: 'DMM TV',
  lemino: 'Lemino',
  fod: 'FOD',
  telasa: 'TELASA',
  abema: 'ABEMA',
  tver: 'TVer',
  youtube: 'YouTube',
  'nhkオンデマンド': 'NHKオンデマンド',
  'のぎ動画': 'のぎ動画',
};
