// GA4 計測を送ってよいホストの判定（クライアント・サーバー共通の純粋関数）。
//
// 本番ホストだけを許可するホワイトリスト方式。localhost / 127.0.0.1 / *.vercel.app（Preview）/
// LAN IP / その他の開発環境からは、page_view を含む GA4 イベントを一切送信しない
// （テスト・確認時のイベントが本番 GA4 プロパティに混ざらないようにするため）。
//
// www.oshi-search.jp は 2026-10 時点で DNS 未設定（名前解決できない）のため含めていない。
// 本番で使うホストを追加する場合はここに追記すること。
export const GA_ALLOWED_HOSTS: readonly string[] = ['oshi-search.jp'];

export function isGaAllowedHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  return GA_ALLOWED_HOSTS.includes(hostname.trim().toLowerCase());
}
