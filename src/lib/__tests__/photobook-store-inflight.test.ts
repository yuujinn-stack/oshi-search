import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── モック ──────────────────────────────────────────────────────────────────────
// photobook.ts（判定・統合ロジック）と group-slug.ts は純粋関数のため実装をそのまま使う。
const mockExecute = vi.hoisted(() => vi.fn());
const mockGetAllPersonsMerged = vi.hoisted(() => vi.fn());
const mockGetAllPersonMetas = vi.hoisted(() => vi.fn());
const mockGetAllGroupMetas = vi.hoisted(() => vi.fn());
const mockGetStoredProductItemById = vi.hoisted(() => vi.fn());

vi.mock('@/db/client', () => ({ db: { execute: mockExecute } }));
vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: mockGetAllPersonsMerged }));
vi.mock('@/lib/person-meta', () => ({ getAllPersonMetas: mockGetAllPersonMetas }));
vi.mock('@/lib/group-meta', () => ({ getAllGroupMetas: mockGetAllGroupMetas }));
vi.mock('@/lib/product-store', () => ({ getStoredProductItemById: mockGetStoredProductItemById }));

import {
  getAllPhotobookItems,
  getPhotobookHomeItems,
  isTransientDbConnectionError,
  withTransientDbRetry,
} from '@/lib/photobook-store';

// SQL本文（drizzle の queryChunks 内の文字列）を連結して返す
function sqlText(query: unknown): string {
  const out: string[] = [];
  const walk = (q: unknown) => {
    for (const c of (q as { queryChunks?: unknown[] }).queryChunks ?? []) {
      const v = (c as { value?: unknown }).value;
      if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
      if ((c as { queryChunks?: unknown }).queryChunks) walk(c);
    }
  };
  walk(query);
  return out.join(' ');
}
// 第1段階（全候補の軽量列＝以前の重いSQLに相当する全件走査）
const isStage1Query = (q: unknown) => sqlText(q).includes('WITH ORDINALITY');
// 第2段階（選定済みキーの商品JSON全体）
const isStage2Query = (q: unknown) => sqlText(q).includes('jsonb_to_recordset');
// 第2段階に渡されたキー（JSONパラメータ）を取り出す
function stage2Keys(query: unknown): { person_name: string; category: string; ord: number; id: string }[] {
  // drizzle はテンプレートに埋め込んだ文字列値を queryChunks にそのまま（生の string として）入れる
  for (const c of (query as { queryChunks?: unknown[] }).queryChunks ?? []) {
    if (typeof c === 'string' && c.startsWith('[')) return JSON.parse(c);
  }
  return [];
}

const SETTINGS_NULL = {
  status: null, published: null, home_state: null, home_pinned_position: null,
  sort_order: null, dedup_group_override: null, force_representative: null,
  source_category: null, note: null,
};
const P1_ITEM = {
  id: 'p1',
  title: '山田花子 1st写真集',
  isUsed: false,
  price: 3000,
  imageUrl: 'https://example.com/p1.jpg',
  itemUrl: 'https://example.com/p1',
  affiliateUrl: 'https://example.com/aff/p1',
};
// 第1段階: p1（写真集）と p9（写真集ではない商品 → 事前判定で除外され第2段階に渡らない）
const LIGHT_ROWS = [
  { person_name: '山田花子', category: '写真集', ord: 1, id: 'p1', title: P1_ITEM.title, is_used: false, status: null },
  { person_name: '山田花子', category: 'CD', ord: 1, id: 'p9', title: '山田花子 ニューシングル', is_used: false, status: null },
];
const FULL_ROWS = [{ person_name: '山田花子', category: '写真集', ord: 1, item: P1_ITEM, ...SETTINGS_NULL }];

let autoQueryCount = 0;
let lastStage2Keys: ReturnType<typeof stage2Keys> = [];

async function defaultExecute(query: unknown) {
  if (isStage1Query(query)) {
    autoQueryCount++;
    // 実際の全件走査SQLのように少し時間をかけ、同時呼び出しが重なる状況を作る
    await new Promise((r) => setTimeout(r, 20));
    return { rows: LIGHT_ROWS };
  }
  if (isStage2Query(query)) {
    lastStage2Keys = stage2Keys(query);
    return { rows: FULL_ROWS.filter((r) => lastStage2Keys.some((k) => k.person_name === r.person_name && k.category === r.category && k.ord === r.ord)) };
  }
  return { rows: [] };
}

// Drizzle が投げる形（Failed query → TypeError: terminated → SocketError: other side closed）を模す
function makeOtherSideClosedError(): Error {
  const socketErr = Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' });
  const terminated = new TypeError('terminated', { cause: socketErr });
  return new Error('Failed query: WITH candidates AS (...)', { cause: terminated });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  autoQueryCount = 0;
  lastStage2Keys = [];
  mockExecute.mockImplementation(defaultExecute);
  mockGetAllPersonsMerged.mockResolvedValue([{ name: '山田花子', group: '', genre: '女優', config: {} }]);
  mockGetAllPersonMetas.mockResolvedValue({ 山田花子: { gender: 'female' } });
  mockGetAllGroupMetas.mockResolvedValue([]);
  mockGetStoredProductItemById.mockResolvedValue(null);
});

describe('写真集取得: 同時実行の重複排除（in-flight共有）', () => {
  it('同時に2回呼び出しても全件走査SQLは1回しか実行されない', async () => {
    const [a, b] = await Promise.all([getAllPhotobookItems(), getAllPhotobookItems()]);
    expect(autoQueryCount).toBe(1);
    expect(a).toEqual(b);
  });

  it('ホームの女性/男性の同時取得でも重いSQLは1回', async () => {
    await Promise.all([getPhotobookHomeItems('female', 8), getPhotobookHomeItems('male', 8)]);
    expect(autoQueryCount).toBe(1);
  });

  it('取得成功時は単独呼び出しと同じ写真集データを返す', async () => {
    const alone = await getAllPhotobookItems();
    const [concurrent] = await Promise.all([getAllPhotobookItems(), getAllPhotobookItems()]);
    expect(concurrent).toEqual(alone);
    expect(alone).toHaveLength(1);
    expect(alone[0].productId).toBe('p1');
  });

  it('キャッシュではない: 完了後の次の呼び出しでは再びSQLを実行する', async () => {
    await getAllPhotobookItems();
    await getAllPhotobookItems();
    expect(autoQueryCount).toBe(2);
  });

  it('失敗後もin-flight状態が解除され、次の呼び出しは新しく実行される', async () => {
    mockExecute.mockImplementationOnce(async () => {
      autoQueryCount++;
      throw new Error('syntax error at or near "SELECT"');
    });
    await expect(getAllPhotobookItems()).rejects.toThrow('syntax error');
    const items = await getAllPhotobookItems();
    expect(items).toHaveLength(1);
  });
});

describe('写真集取得: 一時的な接続切断のみ1回再試行', () => {
  it('other side closed の場合は1回だけ再試行して成功する', async () => {
    let calls = 0;
    mockExecute.mockImplementation(async (query: unknown) => {
      if (isStage1Query(query)) {
        calls++;
        if (calls === 1) throw makeOtherSideClosedError();
      }
      return defaultExecute(query);
    });
    const items = await getAllPhotobookItems();
    expect(calls).toBe(2);
    expect(items).toHaveLength(1);
  });

  it('再試行でも失敗した場合は無限ループせず、2回目で終了してエラーになる', async () => {
    let calls = 0;
    mockExecute.mockImplementation(async (query: unknown) => {
      if (isStage1Query(query)) {
        calls++;
        throw makeOtherSideClosedError();
      }
      return defaultExecute(query);
    });
    await expect(getAllPhotobookItems()).rejects.toThrow('Failed query');
    expect(calls).toBe(2);
  });

  it('通常のエラー（SQL構文エラー等）は再試行しない', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failed query', { cause: new Error('syntax error at or near "FROM"') }));
    await expect(withTransientDbRetry('test', fn)).rejects.toThrow('Failed query');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('接続切断の判定は cause チェーンをたどり、それ以外は false', () => {
    expect(isTransientDbConnectionError(makeOtherSideClosedError())).toBe(true);
    expect(isTransientDbConnectionError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientDbConnectionError(new Error('relation "photobook_settings" does not exist'))).toBe(false);
    expect(isTransientDbConnectionError(new TypeError('terminated'))).toBe(false);
    expect(isTransientDbConnectionError(null)).toBe(false);
    // 応答ヘッダ受信前に切れた場合の Neon の形（NeonDbError.sourceError に元エラー）
    const socketErr = Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' });
    const neonErr = Object.assign(new Error('Error connecting to database: TypeError: terminated'), {
      name: 'NeonDbError',
      sourceError: new TypeError('terminated', { cause: socketErr }),
    });
    expect(isTransientDbConnectionError(new Error('Failed query', { cause: neonErr }))).toBe(true);
    // sourceError があっても接続切断でなければ false
    const neonSyntaxErr = Object.assign(new Error('syntax error'), { name: 'NeonDbError', sourceError: new Error('bad') });
    expect(isTransientDbConnectionError(neonSyntaxErr)).toBe(false);
  });
});

describe('写真集取得: 2段階取得', () => {
  it('第2段階には事前判定を通過した行だけを渡す（写真集でない商品の商品JSONは取得しない）', async () => {
    const items = await getAllPhotobookItems();
    expect(lastStage2Keys).toEqual([{ person_name: '山田花子', category: '写真集', ord: 1, id: 'p1' }]);
    expect(items.map((i) => i.productId)).toEqual(['p1']);
    expect(items[0].imageUrl).toBe(P1_ITEM.imageUrl);
    expect(items[0].affiliateUrl).toBe(P1_ITEM.affiliateUrl);
  });

  it('手動設定（manual_include）がある行は、タイトルが写真集判定に通らなくても第2段階に渡す', async () => {
    mockExecute.mockImplementation(async (query: unknown) => {
      if (isStage1Query(query)) {
        return { rows: [{ ...LIGHT_ROWS[1], status: 'manual_include' }] };
      }
      if (isStage2Query(query)) lastStage2Keys = stage2Keys(query);
      return { rows: [] };
    });
    await getAllPhotobookItems();
    expect(lastStage2Keys.map((k) => k.id)).toEqual(['p9']);
  });

  it('同じ人物×idが複数カテゴリにあっても、従来どおり最初の1件だけを採用する', async () => {
    mockExecute.mockImplementation(async (query: unknown) => {
      if (isStage1Query(query)) {
        return { rows: [LIGHT_ROWS[0], { ...LIGHT_ROWS[0], category: '本・雑誌', ord: 5 }] };
      }
      return defaultExecute(query);
    });
    await getAllPhotobookItems();
    expect(lastStage2Keys).toEqual([{ person_name: '山田花子', category: '写真集', ord: 1, id: 'p1' }]);
  });

  it('第2段階の返却順に関わらず、第1段階の順序に戻す', async () => {
    const light = [
      { person_name: '山田花子', category: '写真集', ord: 1, id: 'a1', title: '山田花子 1st写真集', is_used: false, status: null },
      { person_name: '山田花子', category: '写真集', ord: 2, id: 'a2', title: '山田花子 2nd写真集', is_used: false, status: null },
    ];
    const full = light.map((r) => ({ person_name: r.person_name, category: r.category, ord: r.ord, item: { ...P1_ITEM, id: r.id, title: r.title }, ...SETTINGS_NULL, sort_order: r.ord }));
    mockExecute.mockImplementation(async (query: unknown) => {
      if (isStage1Query(query)) return { rows: light };
      if (isStage2Query(query)) return { rows: [...full].reverse() };
      return { rows: [] };
    });
    const items = await getAllPhotobookItems();
    expect(items.map((i) => i.productId).sort()).toEqual(['a1', 'a2']);
    const list = await import('@/lib/photobook-store').then((m) => m.getPhotobookListItems({}, 1));
    expect(list.items.map((i) => i.productId)).toEqual(['a1', 'a2']);
  });

  it('第1〜第2段階の間に商品が消えた場合（item=null）はその行を除外する', async () => {
    mockExecute.mockImplementation(async (query: unknown) => {
      if (isStage1Query(query)) return { rows: [LIGHT_ROWS[0]] };
      if (isStage2Query(query)) return { rows: [{ ...FULL_ROWS[0], item: null }] };
      return { rows: [] };
    });
    expect(await getAllPhotobookItems()).toEqual([]);
  });
});
