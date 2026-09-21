import 'server-only';

/**
 * 管理画面 /admin/instagram-post 用の設定読み込み・検証。
 * tools/instagram-post-generator/instagram-api/config.ts と同じ考え方
 * （認証方式: Instagram API with Instagram Login。Facebookページ連携は不要）。
 * 実在のトークン・秘密情報はこのファイルには一切含めない（環境変数からの読み込みのみ）。
 * `server-only` によりクライアントバンドルへ誤って含まれることを防いでいる。
 */
export interface InstagramPostConfig {
  accessToken: string;
  igUserId: string;
  apiVersion: string;
}

const REQUIRED_VARS = ['IG_ACCESS_TOKEN', 'IG_USER_ID'] as const;

export class InstagramConfigError extends Error {}

/**
 * 環境変数から設定を読み込む。不足があれば「何が不足しているか」を明確にした
 * エラーを投げる（推測で埋めない）。エラーメッセージにも値そのものは含めない。
 */
export function loadInstagramConfig(): InstagramPostConfig {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new InstagramConfigError(
      `Instagram API設定が不足しています（.env.local）: ${missing.join(', ')}`,
    );
  }
  return {
    accessToken: process.env.IG_ACCESS_TOKEN!.trim(),
    igUserId: process.env.IG_USER_ID!.trim(),
    apiVersion: process.env.IG_GRAPH_API_VERSION?.trim() || 'v25.0',
  };
}

export function isBlobUploadConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN?.trim();
}
