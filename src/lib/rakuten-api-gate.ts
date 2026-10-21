// 楽天APIの呼び出し制御（アプリID単位で1秒1リクエスト）。サーバー専用。
//
// 同じアプリIDを使う全経路（商品の自動更新・管理画面の再取得／検索・推し活お買い物診断）が、Vercel の
// 複数インスタンスをまたいでも合計で 1.1 秒に1回以下になるよう、既存の Upstash Redis で「使用権」を1つだけ持たせる。
//
//   使用権（LEASE_KEY）… SET NX PX で取得。持っている間だけ、間隔を 1.1 秒以上空けて楽天APIを呼べる。
//     - 一連の呼び出し（1カテゴリの検索ページ群など）を1回の取得でまとめ、Redis のコマンド数を抑える
//       （取得1＋返却1＋更新は約35秒に1回）。
//     - 期限（60秒）が近づいたら所有者を確認しながら延長する（Lua で比較と延長を一度に行う）。延長できなければ呼ぶのをやめる。
//     - 自分の見積もり上の期限（取得要求を送る前の時刻から計算するため、Redis 側の期限より必ず早い）を過ぎてからは
//       呼ばないので、期限切れ後に別の処理が取得しても呼び出しは重ならない。
//     - 返却時は「1.1 秒間だけ有効な返却済み」の値に置き換える（次の取得者が直後に呼ばないため）。
//     - 処理が途中で落ちて返却されなくても、最長60秒で期限切れになり次の処理が取得できる。
//   停止（COOLDOWN_KEY）… 429 が確定したら（呼び出し側が reportRateLimited で報告）、全経路共通で一定時間
//     （Retry-After と60秒の大きい方）使用権を取らせない。報告したセッションも以後は呼ばない。
//     既存の rakuten.ts は従来どおり「待ってから1回だけ再試行」し、それでも 429 なら報告する（無制限に再試行しない）。
//     診断は再試行せずすぐ報告する。
//
// Redis が無い・つながらない場合：
//   onUnavailable='local'（自動更新・管理画面）… このプロセス内で 1.1 秒間隔に並べて続行（既存の取得を止めない）
//   onUnavailable='skip'（診断）……………………… 呼ばない
import { AsyncLocalStorage } from 'node:async_hooks';
import { getRedis } from '@/lib/redis';

export const LEASE_KEY = 'rakuten-api:lease';
export const COOLDOWN_KEY = 'rakuten-api:cooldown';
export const MIN_INTERVAL_MS = 1100;
export const LEASE_TTL_MS = 60_000;
const RENEW_WHEN_REMAINING_MS = 25_000;
const SAFETY_MARGIN_MS = 3_000;
const ACQUIRE_POLL_MS = 500;
export const DEFAULT_COOLDOWN_MS = 60_000;

// 取得：停止中でなく、使用権が空いていれば取る（1コマンド）。戻り値 1=取得 0=使用中 -1=停止中
export const ACQUIRE_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return 1 end
return 0`;
// 延長：自分が持っている場合だけ期限を延ばす。戻り値 1=延長 0=失った
export const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0`;
// 返却：自分が持っている場合だけ、短い期限の「返却済み」に置き換える
export const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], 'released', 'PX', ARGV[2]) return 1 end
return 0`;

export interface GateRedis {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  set(key: string, value: string, opts: { px: number }): Promise<unknown>;
}

export interface GateDeps {
  redis: GateRedis | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  intervalMs: number;
  log: (msg: string) => void;
}

export class RakutenApiBusyError extends Error {}
export class RakutenApiCooldownError extends Error {}
export class RakutenApiUnavailableError extends Error {}
export class RakutenApiLeaseLostError extends Error {}

export interface SessionOptions {
  /** ログ用の処理名（例: cron-refresh, admin-search, oshi-shopping） */
  label: string;
  /** 使用権が空くまで待つ最大時間 */
  maxWaitMs: number;
  onUnavailable: 'local' | 'skip';
}

export interface RakutenApiSession {
  /** 楽天APIを1回呼ぶ（間隔・使用権・停止を確認してから doFetch を実行する） */
  call(doFetch: () => Promise<Response>): Promise<Response>;
  /** 429 が確定したことを報告する：全経路共通の停止を記録し、このセッションでは以後呼ばない */
  reportRateLimited(res: Response): Promise<void>;
  /** 使用権を返す（呼ばれていなければ何もしない） */
  close(): Promise<void>;
}

function defaultDeps(): GateDeps {
  return {
    redis: getRedis() as unknown as GateRedis | null,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    intervalMs: MIN_INTERVAL_MS,
    log: (m) => console.warn(m),
  };
}

// Redis を使えないときの、このプロセス内の間隔制御（全セッション共通）
let localChain: Promise<unknown> = Promise.resolve();
let localLastAt = 0;
let localCooldownUntil = 0;

function parseRetryAfterMs(res: Response): number {
  const v = Number(res.headers?.get?.('retry-after'));
  return Number.isFinite(v) && v > 0 ? v * 1000 : 0;
}

export function createRakutenApiSession(opts: SessionOptions, depsOverride?: Partial<GateDeps>): RakutenApiSession {
  const deps: GateDeps = { ...defaultDeps(), ...depsOverride };
  const owner = `${opts.label}:${Math.random().toString(36).slice(2)}:${deps.now()}`;
  let mode: 'none' | 'redis' | 'local' = 'none';
  let expiresAt = 0; // 自分の見積もり上の使用権の期限
  let lastCallAt = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let stopped: Error | null = null;

  async function acquire(): Promise<void> {
    if (!deps.redis) {
      if (opts.onUnavailable === 'skip') throw new RakutenApiUnavailableError('redis unavailable');
      mode = 'local';
      return;
    }
    const deadline = deps.now() + opts.maxWaitMs;
    for (;;) {
      const sentAt = deps.now();
      let r: number;
      try {
        r = Number(await deps.redis.eval(ACQUIRE_SCRIPT, [LEASE_KEY, COOLDOWN_KEY], [owner, String(LEASE_TTL_MS)]));
      } catch {
        if (opts.onUnavailable === 'skip') throw new RakutenApiUnavailableError('redis error');
        deps.log(`[rakuten-api] Redis に接続できないため、このプロセス内の間隔制御で続行します (${opts.label})`);
        mode = 'local';
        return;
      }
      if (r === 1) {
        mode = 'redis';
        expiresAt = sentAt + LEASE_TTL_MS;
        return;
      }
      if (r === -1) throw new RakutenApiCooldownError('cooldown');
      if (deps.now() + ACQUIRE_POLL_MS > deadline) throw new RakutenApiBusyError('busy');
      await deps.sleep(ACQUIRE_POLL_MS);
    }
  }

  async function ensureLease(): Promise<void> {
    if (mode !== 'redis' || !deps.redis) return;
    if (expiresAt - deps.now() >= RENEW_WHEN_REMAINING_MS) return;
    const sentAt = deps.now();
    try {
      const r = Number(await deps.redis.eval(RENEW_SCRIPT, [LEASE_KEY], [owner, String(LEASE_TTL_MS)]));
      if (r === 1) {
        expiresAt = sentAt + LEASE_TTL_MS;
        return;
      }
      throw new RakutenApiLeaseLostError('lease lost');
    } catch (err) {
      if (err instanceof RakutenApiLeaseLostError) throw err;
      // 延長できなくても、見積もり上の期限まで十分あれば続行する
      if (expiresAt - deps.now() > SAFETY_MARGIN_MS) return;
      throw new RakutenApiLeaseLostError('lease renew failed');
    }
  }

  async function callOnce(doFetch: () => Promise<Response>): Promise<Response> {
    if (stopped) throw stopped;
    if (mode === 'none') await acquire();
    if (mode === 'local') {
      // プロセス内で全セッション共通の列に並べる
      const run = localChain.then(async () => {
        if (deps.now() < localCooldownUntil) throw new RakutenApiCooldownError('cooldown (local)');
        const wait = localLastAt + deps.intervalMs - deps.now();
        if (wait > 0) await deps.sleep(wait);
        localLastAt = deps.now();
        return doFetch();
      });
      localChain = run.catch(() => undefined);
      return run;
    }
    // redis
    const wait = lastCallAt + deps.intervalMs - deps.now();
    if (wait > 0) await deps.sleep(wait);
    await ensureLease();
    if (expiresAt - deps.now() <= SAFETY_MARGIN_MS) throw new RakutenApiLeaseLostError('lease expiring');
    lastCallAt = deps.now();
    return doFetch();
  }

  return {
    call(doFetch) {
      // セッション内の呼び出しは1本の列に並べる
      const run = chain.then(() => callOnce(doFetch));
      chain = run.catch(() => undefined);
      return run;
    },
    async reportRateLimited(res) {
      const ms = Math.max(parseRetryAfterMs(res), DEFAULT_COOLDOWN_MS);
      stopped = new RakutenApiCooldownError('429');
      if (mode === 'redis' && deps.redis) {
        try {
          await deps.redis.set(COOLDOWN_KEY, owner, { px: ms });
        } catch {
          // 記録できなくても、このセッションでは以後呼ばない
        }
      } else {
        localCooldownUntil = deps.now() + ms;
      }
      deps.log(`[rakuten-api] 429 のため ${Math.round(ms / 1000)} 秒間、楽天APIを呼びません (${opts.label})`);
    },
    async close() {
      await chain.catch(() => undefined);
      if (mode === 'redis' && deps.redis) {
        try {
          await deps.redis.eval(RELEASE_SCRIPT, [LEASE_KEY], [owner, String(deps.intervalMs)]);
        } catch {
          // 返却できなくても最長 LEASE_TTL_MS で期限切れになる
        }
      }
      mode = 'none';
    },
  };
}

// ── rakuten.ts の既存の呼び出し口から使う：処理単位（1カテゴリ取得など）のセッションを引き継ぐ ──
const sessionStore = new AsyncLocalStorage<RakutenApiSession>();

/** fn の中の rakutenApiFetch 呼び出しを1つの使用権にまとめる（終わったら返却） */
export async function withRakutenApiSession<T>(opts: SessionOptions, fn: () => Promise<T>): Promise<T> {
  const session = createRakutenApiSession(opts);
  try {
    return await sessionStore.run(session, fn);
  } finally {
    await session.close();
  }
}

/** withRakutenApiSession の中なら、そのセッション（429 の報告などに使う） */
export function currentRakutenApiSession(): RakutenApiSession | undefined {
  return sessionStore.getStore();
}

/**
 * 楽天APIを1回呼ぶ。withRakutenApiSession の中ならそのセッションで、外なら1回だけの使用権を取って呼ぶ。
 * 使用中で待ちきれない・停止中・（skip の場合）Redis なしのときは例外（Rakuten への送信はしない）。
 */
export async function rakutenApiFetch(
  url: string,
  init: RequestInit,
  fallbackOpts: SessionOptions,
): Promise<Response> {
  const current = sessionStore.getStore();
  if (current) return current.call(() => fetch(url, init));
  return withRakutenApiSession(fallbackOpts, () => sessionStore.getStore()!.call(() => fetch(url, init)));
}

/** テスト専用：プロセス内の間隔制御・停止状態を初期化する */
export function __resetRakutenApiGateForTests(): void {
  localChain = Promise.resolve();
  localLastAt = 0;
  localCooldownUntil = 0;
}
