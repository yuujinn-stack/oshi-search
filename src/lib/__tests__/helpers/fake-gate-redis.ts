// テスト用：rakuten-api-gate.ts が使う Redis の操作（3つの Lua スクリプトと SET PX）を、期限つきで再現する。
// 全インスタンス共通の Upstash Redis の代わり。時計は差し替え可能。
import { ACQUIRE_SCRIPT, RELEASE_SCRIPT, RENEW_SCRIPT, type GateRedis } from '@/lib/rakuten-api-gate';

export interface FakeGateRedis extends GateRedis {
  store: Map<string, { v: string; exp: number }>;
  commands: string[];
  failNext: number;
  down: boolean;
}

export function createFakeGateRedis(now: () => number = () => Date.now()): FakeGateRedis {
  const store = new Map<string, { v: string; exp: number }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e && e.exp > now()) return e;
    store.delete(k);
    return null;
  };
  const r: FakeGateRedis = {
    store,
    commands: [],
    failNext: 0,
    down: false,
    async eval(script, keys, args) {
      r.commands.push(script === ACQUIRE_SCRIPT ? 'acquire' : script === RENEW_SCRIPT ? 'renew' : script === RELEASE_SCRIPT ? 'release' : 'eval?');
      if (r.down || r.failNext > 0) { r.failNext = Math.max(0, r.failNext - 1); throw new Error('redis down'); }
      if (script === ACQUIRE_SCRIPT) {
        if (live(keys[1])) return -1;
        if (live(keys[0])) return 0;
        store.set(keys[0], { v: args[0], exp: now() + Number(args[1]) });
        return 1;
      }
      if (script === RENEW_SCRIPT) {
        const e = live(keys[0]);
        if (!e || e.v !== args[0]) return 0;
        e.exp = now() + Number(args[1]);
        return 1;
      }
      if (script === RELEASE_SCRIPT) {
        const e = live(keys[0]);
        if (!e || e.v !== args[0]) return 0;
        store.set(keys[0], { v: 'released', exp: now() + Number(args[1]) });
        return 1;
      }
      throw new Error('unknown script');
    },
    async set(key, value, opts) {
      r.commands.push('set');
      if (r.down) throw new Error('redis down');
      store.set(key, { v: value, exp: now() + opts.px });
      return 'OK';
    },
  };
  return r;
}
