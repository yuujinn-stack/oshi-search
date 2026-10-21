import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Redis } from '@upstash/redis';
import {
  checkRedisEnv, checkRedisRead, describeError, redactSecrets, redisEnvProblems,
} from '../../../scripts/price-refresh/diagnostics';

// 価格更新の失敗の原因を、秘密情報を出さずにログに出す（scripts/price-refresh/diagnostics.ts）。
const TOKEN = 'AXyzTESTtokenNotReal0123456789abcdefABCDEF0123456789xyz';
const URL_ = 'https://fake-db-12345.upstash.io';
const ENV = {
  UPSTASH_REDIS_REST_URL: URL_, UPSTASH_REDIS_REST_TOKEN: TOKEN,
  DATABASE_URL: 'postgresql://price_refresher:PwNotReal0123456789Abc@ep-fake.neon.tech/neondb?sslmode=require',
  RAKUTEN_ACCESS_KEY: 'pk_notreal_accesskey_0123456789', RAKUTEN_APP_ID: 'app-notreal-0001',
};
const leaks = (x: unknown) => {
  const s = JSON.stringify(x);
  return [TOKEN, 'fake-db-12345', 'PwNotReal0123456789Abc', 'ep-fake.neon.tech', 'pk_notreal_accesskey_0123456789', 'app-notreal-0001'].filter((v) => s.includes(v));
};

// Upstash の REST API の代わり（認証・権限のエラーを返す）
let server: http.Server;
let base = '';
let reply: { status: number; body: unknown } = { status: 401, body: { error: 'WRONGPASS invalid or missing auth token' } };
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.body)); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe('Redis（Upstash）の失敗の原因を秘密を出さずに示す', () => {
  it('認証の失敗（トークンの誤り）：Upstash のエラー文と失敗したコマンド名だけ（トークン・URL は出さない）', async () => {
    reply = { status: 401, body: { error: 'WRONGPASS invalid or missing auth token' } };
    const redis = new Redis({ url: base, token: TOKEN, retry: false });
    const r = await checkRedisRead(redis, { halt: 'price-refresh:halt', lock: 'price-refresh:runner-lock' }, ENV);
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ kind: 'UpstashError', upstashError: 'WRONGPASS invalid or missing auth token', redisCommand: 'GET' });
    expect(leaks(r)).toEqual([]);
  });

  it('権限の不足（読み取り専用のトークンで書き込み）：NOPERM とコマンド名', async () => {
    reply = { status: 403, body: { error: "NOPERM this user has no permissions to run the 'set' command" } };
    const redis = new Redis({ url: base, token: TOKEN, retry: false });
    let err: unknown;
    try { await redis.set('price-refresh:runner-lock', 'owner-x', { nx: true, px: 1000 }); } catch (e) { err = e; }
    const d = describeError(err, ENV);
    expect(d).toMatchObject({ kind: 'UpstashError', redisCommand: 'SET' });
    expect(d.upstashError).toContain('NOPERM');
    expect(JSON.stringify(d)).not.toContain('owner-x'); // コマンドの引数は出さない
    expect(leaks(d)).toEqual([]);
  });

  it('つながらない（URL の誤り）：エラーの種類と原因のコードだけ', async () => {
    const redis = new Redis({ url: 'http://127.0.0.1:1', token: TOKEN, retry: false });
    const r = await checkRedisRead(redis, { halt: 'h', lock: 'l' }, ENV);
    expect(r.ok).toBe(false);
    expect(leaks(r)).toEqual([]);
  });

  it('読み取れたら ok と、自動停止の印・ロックの有無（書き込みはしない）', async () => {
    const calls: string[] = [];
    const fake = { get: async (k: string) => { calls.push(`get ${k}`); return null; }, exists: async (k: string) => { calls.push(`exists ${k}`); return 1; } };
    expect(await checkRedisRead(fake, { halt: 'h', lock: 'l' }, ENV)).toEqual({ ok: true, halt: false, locked: true });
    expect(calls).toEqual(['get h', 'exists l']);
  });
});

describe('Redis の設定の形（値・長さは出さない）', () => {
  it('正しい形', () => {
    const c = checkRedisEnv(ENV);
    expect(redisEnvProblems(c)).toEqual([]);
    expect(leaks(c)).toEqual([]);
  });
  it('貼り間違い：redis:// の URL・トークン欄に URL・改行入り', () => {
    expect(redisEnvProblems(checkRedisEnv({ UPSTASH_REDIS_REST_URL: 'rediss://default:x@fake-db-12345.upstash.io:6379', UPSTASH_REDIS_REST_TOKEN: TOKEN }))[0]).toContain('https://');
    expect(redisEnvProblems(checkRedisEnv({ UPSTASH_REDIS_REST_URL: URL_, UPSTASH_REDIS_REST_TOKEN: URL_ }))).toContain('UPSTASH_REDIS_REST_TOKEN に URL が入っている（トークンを貼る）');
    expect(redisEnvProblems(checkRedisEnv({ UPSTASH_REDIS_REST_URL: URL_, UPSTASH_REDIS_REST_TOKEN: TOKEN + '\n' }))).toContain('UPSTASH_REDIS_REST_TOKEN に空白・改行が入っている');
    expect(redisEnvProblems(checkRedisEnv({ UPSTASH_REDIS_REST_URL: URL_ + '/v2', UPSTASH_REDIS_REST_TOKEN: TOKEN }))[0]).toContain('パス');
  });
});

describe('その他のエラーの文面も伏せる', () => {
  it('接続文字列・トークン・ホスト名・長い文字列を *** にする', () => {
    const msg = `connect failed ${ENV.DATABASE_URL} token=${TOKEN} host fake-db-12345.upstash.io key ${ENV.RAKUTEN_ACCESS_KEY}`;
    expect(leaks(redactSecrets(msg, ENV))).toEqual([]);
    const d = describeError(new Error(msg), ENV);
    expect(d.kind).toBe('Error');
    expect(leaks(d)).toEqual([]);
  });
});
