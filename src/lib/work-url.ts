/**
 * 作品公開URLの共通生成ユーティリティ
 *
 * 正規URL: /work/{workId}
 *
 * サーバー・クライアント両方で安全に使用可能（DBアクセスなし・副作用なし）。
 */

export type WorkPublicUrlInput = {
  workId: string;
  personName?: string | null;
  /** 将来の統合先workId。指定された場合はworkIdより優先される */
  canonicalWorkId?: string | null;
};

/**
 * 作品の公開URLを返す。
 * - workId が空の場合は null を返す（不正URLを生成しない）
 * - URLエンコードは内部で行う（呼び出し側でエンコード不要）
 * - personName は後方互換のため型に残すが URL 生成には使用しない
 */
export function getWorkPublicUrl({ workId, canonicalWorkId }: WorkPublicUrlInput): string | null {
  // canonicalWorkId が空文字・null・undefined の場合は workId にフォールバック
  const resolvedId = (canonicalWorkId?.trim() || workId?.trim());
  if (!resolvedId) return null;
  return `/work/${encodeURIComponent(resolvedId)}`;
}
