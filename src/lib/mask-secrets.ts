/**
 * 管理画面へ表示する前に、エラーメッセージ等から秘密情報らしき文字列をマスクする。
 *
 * 設計上、GraphApiRequestErrorのメッセージにはMeta側のエラー本文のみが入り
 * access_token等は含まれない想定だが（送信時にURLへ載せるだけでレスポンスには
 * エコーバックされない）、念のため表示直前に防御的にマスクする
 * （保存されているerrorMessage自体は変更せず、表示用の文字列だけを加工する）。
 */
const SECRET_PATTERNS: RegExp[] = [
  // access_token=xxx / token=xxx のようなクエリパラメータ形式
  /\b(access_token|token)=[^&\s"']+/gi,
  // 既知の環境変数名 + その値（KEY=value / KEY: value の両方に対応）
  /\b(IG_ACCESS_TOKEN|CRON_SECRET|ADMIN_PASSWORD|ADMIN_SESSION_SECRET|DATABASE_URL|IG_USER_ID)\s*[:=]\s*[^\s"'&,}]+/gi,
  // Authorization: Bearer xxx 形式
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
];

export function maskSecrets(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const sepIdx = match.search(/[:=]|\s(?=[A-Za-z0-9._-]{10,}$)/);
      if (sepIdx === -1) return '[MASKED]';
      return `${match.slice(0, sepIdx + 1)}***`;
    });
  }
  return masked;
}
