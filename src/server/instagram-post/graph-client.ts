import 'server-only';
import type { InstagramPostConfig } from './config';

/**
 * Instagram API with Instagram Login（graph.instagram.com）への薄いHTTPラッパー。
 * tools/instagram-post-generator/instagram-api/client.ts と同一の実装・仕様
 * （公式ドキュメント: instagram-api-with-instagram-login/content-publishing）。
 */
const GRAPH_API_HOST = 'https://graph.instagram.com';

export interface GraphApiError {
  error: {
    message: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export class GraphApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'GraphApiRequestError';
  }
}

export class InstagramGraphClient {
  constructor(private readonly config: InstagramPostConfig) {}

  private buildUrl(pathSegment: string, params: Record<string, string>): string {
    const url = new URL(`${GRAPH_API_HOST}/${this.config.apiVersion}/${pathSegment}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('access_token', this.config.accessToken);
    return url.toString();
  }

  async get<T>(pathSegment: string, params: Record<string, string> = {}): Promise<T> {
    const url = this.buildUrl(pathSegment, params);
    const res = await fetch(url, { method: 'GET' });
    return this.handleResponse<T>(res);
  }

  async post<T>(pathSegment: string, params: Record<string, string>): Promise<T> {
    const url = this.buildUrl(pathSegment, {});
    const body = new URLSearchParams(params);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return this.handleResponse<T>(res);
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GraphApiRequestError(res.status, text, `Graph APIから不正なレスポンス（JSONでない）: ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      const errBody = json as GraphApiError;
      const message = errBody?.error?.message ?? `Graph APIエラー（HTTP ${res.status}）`;
      throw new GraphApiRequestError(res.status, json, message);
    }
    return json as T;
  }
}
