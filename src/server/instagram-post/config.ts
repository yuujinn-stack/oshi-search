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

/**
 * 予約投稿の自動公開（/api/cron/instagram-publish）専用のハードガード。
 *
 * 手動投稿（/admin/instagram-post、「投稿する」ボタン）はこのフラグの影響を受けない
 * （既存の手動投稿機能は変更しない）。このフラグは「Cronが人の確認なしに
 * media_publishを実行してよいか」だけを制御する、自動投稿専用の安全装置。
 * 明示的に文字列 "true" のときのみ許可する（未設定・"false"・その他の値はすべて拒否＝安全側）。
 */
export function isAutopublishEnabled(): boolean {
  return process.env.INSTAGRAM_AUTOPUBLISH_ENABLED?.trim().toLowerCase() === 'true';
}
