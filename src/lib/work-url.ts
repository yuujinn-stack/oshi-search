/**
 * 作品公開URLの共通生成ユーティリティ
 *
 * 現行ルート: /person/{personName}/work/{workId}
 * 将来の /work/{id} ルートへ移行する際はここだけ変更する。
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
 * - personName が空またはworkIdが空の場合は null を返す（不正URLを生成しない）
 * - URLエンコードは内部で行う（呼び出し側でエンコード不要）
 */
export function getWorkPublicUrl({ workId, personName, canonicalWorkId }: WorkPublicUrlInput): string | null {
  // canonicalWorkId が空文字・null・undefined の場合は workId にフォールバック
  const resolvedId = (canonicalWorkId?.trim() || workId?.trim());
  const person = personName?.trim();
  if (!resolvedId || !person) return null;
  return `/person/${encodeURIComponent(person)}/work/${encodeURIComponent(resolvedId)}`;
}
