/**
 * fetch()のレスポンスを安全にJSONとして読み取るヘルパー。
 *
 * サーバー側で予期しないクラッシュが起きた場合、Next.js/Vercelは
 * HTMLのエラーページ（"<!DOCTYPE ..."で始まる）を返すことがある。
 * これを確認せずに response.json() を呼ぶと
 * "Unexpected token '<', ... is not valid JSON" という
 * 分かりにくいエラーがそのまま画面に表示されてしまう
 * （実際に/api/admin/instagram-post/photoでsharpのネイティブモジュール読み込み失敗により
 * 発生した）。
 *
 * ここでは、Content-Typeを確認してJSONでない場合は
 * 「サーバーエラーが発生しました（詳細はVercelのFunction Logsを確認してください）」
 * という分かりやすいメッセージに変換する。
 */
export async function safeFetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    const bodyPreview = await res.text().catch(() => '');
    throw new Error(
      `サーバーエラーが発生しました（HTTP ${res.status}）。予期しない応答形式のため詳細は取得できません。` +
        `Vercelのfunction logsを確認してください。` +
        (bodyPreview ? `\n応答冒頭: ${bodyPreview.slice(0, 120)}` : ''),
    );
  }

  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? `サーバーエラーが発生しました（HTTP ${res.status}）`);
  }
  return data;
}
