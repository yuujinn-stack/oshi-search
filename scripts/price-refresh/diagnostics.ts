// 価格更新（scripts/price-refresh/run.ts）の失敗の原因を、秘密情報を出さずにログに出すための補助。
//
// Actions のログは公開リポジトリでは誰でも見られる。トークン・パスワード・接続文字列・URL は出さず、
// 「何が・どこで」失敗したかだけを出す。
//   - Upstash の失敗：Upstash が返したエラー文（例「WRONGPASS invalid or missing auth token」「NOPERM ...」）と、
//     失敗したコマンドの名前（GET 等）。@upstash/redis はエラー文に送ったコマンドと引数を付けるが、引数は出さない。
//   - 通信の失敗：エラーの種類と原因のコード（ENOTFOUND 等）。
//   - Redis の設定：URL の形式（https か・Upstash のホストか・余分な空白や改行が無いか）、トークンの形（空白・改行が無いか、
//     URL を貼り間違えていないか）を「はい／いいえ」だけで出す。値・長さは出さない。

/** ログに出してはいけない値を持つ環境変数 */
export const SECRET_ENV_KEYS = [
  'DATABASE_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'RAKUTEN_APP_ID', 'RAKUTEN_ACCESS_KEY', 'RAKUTEN_AFFILIATE_ID', 'OPENAI_API_KEY',
] as const;

type Env = Record<string, string | undefined>;

function secretValues(env: Env): string[] {
  const out: string[] = [];
  for (const k of SECRET_ENV_KEYS) {
    const v = (env[k] ?? '').trim();
    if (!v) continue;
    out.push(v);
    try { const u = new URL(v); if (u.password) out.push(u.password, decodeURIComponent(u.password)); if (u.host) out.push(u.host); } catch { /* URL でない値 */ }
  }
  // 短すぎる値（1〜3文字）で置き換えると文が壊れるため除く。長いものから置き換える
  return [...new Set(out)].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length);
}

/** 文中の秘密の値・URL・接続文字列を *** にする */
export function redactSecrets(text: string, env: Env): string {
  let s = text;
  for (const v of secretValues(env)) s = s.split(v).join('***');
  return s
    .replace(/\b(postgres(ql)?|rediss?|https?):\/\/[^\s'"`,)]+/gi, '$1://***')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '***');
}

export interface ErrorDescription {
  kind: string;
  /** Upstash が返したエラー文（秘密は伏せる） */
  upstashError?: string;
  /** 失敗した Redis のコマンド名（引数は出さない） */
  redisCommand?: string;
  /** 原因のコード（ENOTFOUND・ECONNREFUSED 等） */
  causeCode?: string;
  /** その他のエラーの短い説明（秘密は伏せる） */
  message?: string;
}

export function describeError(e: unknown, env: Env): ErrorDescription {
  const err = e as { name?: string; message?: string; code?: unknown; cause?: { code?: unknown; name?: string } };
  const kind = e instanceof Error ? err.name ?? 'Error' : typeof e;
  const msg = String(err?.message ?? e ?? '');
  const causeCode = err?.cause?.code ? String(err.cause.code) : err?.code ? String(err.code) : undefined;
  if (kind === 'UpstashError' || /command was: \[/.test(msg)) {
    const [errorPart, commandPart] = msg.split(', command was: ');
    let redisCommand: string | undefined;
    // @upstash/redis は送ったコマンド（JSON の文字列）をさらに JSON にして付けるため、文字列なら2回読む
    try {
      let c: unknown = JSON.parse(commandPart ?? '');
      if (typeof c === 'string') c = JSON.parse(c);
      // 形は ["get", ...] または [["get", ...]]（複数のコマンドをまとめて送る形）
      if (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
      if (Array.isArray(c) && typeof c[0] === 'string') redisCommand = c[0].toUpperCase();
    } catch { /* 無し */ }
    const m = errorPart.match(/^Command(?: \d+ \[ (\w+) \])? failed: (.*)$/);
    if (m) { redisCommand = redisCommand ?? m[1]?.toUpperCase(); }
    return { kind, upstashError: redactSecrets((m ? m[2] : errorPart).slice(0, 200), env), redisCommand, causeCode };
  }
  return { kind, causeCode, message: redactSecrets(msg.split('\n')[0].slice(0, 200), env) };
}

export interface RedisEnvCheck {
  urlIsHttps: boolean;
  urlHostIsUpstash: boolean;
  urlHasWhitespace: boolean;
  urlHasPathOrQuery: boolean;
  tokenHasWhitespace: boolean;
  tokenLooksLikeUrl: boolean;
  tokenSameAsUrl: boolean;
}

/** Redis の設定の形だけを確認する（値・長さは返さない） */
export function checkRedisEnv(env: Env): RedisEnvCheck {
  const rawUrl = env.UPSTASH_REDIS_REST_URL ?? '';
  const rawToken = env.UPSTASH_REDIS_REST_TOKEN ?? '';
  let host = '', path = '/', search = '', protocol = '';
  try { const u = new URL(rawUrl.trim()); host = u.hostname; path = u.pathname; search = u.search; protocol = u.protocol; } catch { /* 不正な URL */ }
  return {
    urlIsHttps: protocol === 'https:',
    urlHostIsUpstash: /\.upstash\.io$/i.test(host),
    urlHasWhitespace: /\s/.test(rawUrl),
    urlHasPathOrQuery: (path !== '/' && path !== '') || !!search,
    tokenHasWhitespace: /\s/.test(rawToken),
    tokenLooksLikeUrl: /^[a-z]+:\/\//i.test(rawToken.trim()),
    tokenSameAsUrl: !!rawToken && rawToken.trim() === rawUrl.trim(),
  };
}

/** 設定の形の問題（空なら問題なし） */
export function redisEnvProblems(c: RedisEnvCheck): string[] {
  const p: string[] = [];
  if (!c.urlIsHttps) p.push('UPSTASH_REDIS_REST_URL が https:// で始まっていない（REDIS_URL・KV_URL〔redis://〕を貼っていないか）');
  if (!c.urlHostIsUpstash) p.push('UPSTASH_REDIS_REST_URL のホストが *.upstash.io ではない');
  if (c.urlHasWhitespace) p.push('UPSTASH_REDIS_REST_URL に空白・改行が入っている');
  if (c.urlHasPathOrQuery) p.push('UPSTASH_REDIS_REST_URL にパス・クエリが付いている（ホストまでの URL にする）');
  if (c.tokenHasWhitespace) p.push('UPSTASH_REDIS_REST_TOKEN に空白・改行が入っている');
  if (c.tokenLooksLikeUrl || c.tokenSameAsUrl) p.push('UPSTASH_REDIS_REST_TOKEN に URL が入っている（トークンを貼る）');
  return p;
}

export interface RedisReadCheck { ok: boolean; halt?: boolean; locked?: boolean; error?: ErrorDescription }

/** Redis への読み取りだけの接続確認（自動停止の印・実行ロックがあるかを読む。書き込みはしない） */
export async function checkRedisRead(
  redis: { get(key: string): Promise<unknown>; exists(...keys: string[]): Promise<number> },
  keys: { halt: string; lock: string },
  env: Env,
): Promise<RedisReadCheck> {
  try {
    const halt = await redis.get(keys.halt);
    const locked = await redis.exists(keys.lock);
    return { ok: true, halt: halt != null, locked: locked > 0 };
  } catch (e) {
    return { ok: false, error: describeError(e, env) };
  }
}
