// #推しアド（AccessTrade）の承認済みリンクコード。
// AccessTrade 管理画面で発行された公式SSLリンクコードを一切改変せずに保持する
// （アフィリエイトURL・計測用img・rel・referrerpolicy 等を書き換えると成果計測が壊れるため）。
// 人物ページの OshiAdBanner と応援広告ガイド（/support-ads）の両方がこの定数を使う。
// 通常の公式URLへの置き換えや、文字列の編集はしないこと。
export const ACCESSTRADE_OSHI_AD_BANNER_HTML =
  '<a href="https://h.accesstrade.net/sp/cc?rk=0100q6rn00ovvr" rel="nofollow" referrerpolicy="no-referrer-when-downgrade"><img src="https://h.accesstrade.net/sp/rr?rk=0100q6rn00ovvr" alt="#推しアド" border="0" width="300" height="250"></a>';

/**
 * 推しアド広告の表示可否。NEXT_PUBLIC_OSHI_AD_ENABLED が明示的に 'true' の場合のみ表示する（opt-in）。
 * 未設定・'false'・その他の値は非表示（案件終了後や設定漏れ時に広告が出続けるのを防ぐ）。
 */
export function isOshiAdEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OSHI_AD_ENABLED === 'true';
}

/**
 * 応援広告ガイド（/support-ads）に推しアドの広告枠を出すかどうか。
 * 推しアド広告の表示（isOshiAdEnabled）に加えて、NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED='true' のときだけ表示する。
 * リンク先はユーザーが実クリックで確認済み（2026-10-16：推しアド公式トップ app.oshi-ad.com、atnct パラメータ付き。
 * 「掲載枠を探す」からWeb申込・クレジットカード決済が可能）。Production のみ 'true' を設定する想定。
 * NEXT_PUBLIC_ のためビルド時に値が埋め込まれる（変更時は再デプロイが必要）。
 */
export function isSupportAdsCtaEnabled(): boolean {
  return isOshiAdEnabled() && process.env.NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED === 'true';
}
