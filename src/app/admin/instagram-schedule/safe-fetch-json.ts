/**
 * fetch()のレスポンスを安全にJSONとして読み取るヘルパー。
 * src/app/admin/instagram-post/safe-fetch-json.ts と同一内容。
 * 既存の手動投稿機能側のファイルには触れず、予約投稿機能側に複製して保持する。
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
