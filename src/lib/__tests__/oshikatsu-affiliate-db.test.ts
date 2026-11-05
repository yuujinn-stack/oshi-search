// 推し活サービスのアフィリエイト：本番DBを使わない結合テスト。
// @/db/client をメモリ上の PostgreSQL（@electric-sql/pglite。ネットワーク接続なし）に差し替え、
// /api/admin/db-init → 管理API → 公開ページの表示 までを実際のSQLで確認する。
// pglite は drizzle-orm の任意依存としてローカルに入っている場合だけ実行する（無ければ skip）。
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { NextRequest } from 'next/server';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

const hasPglite = (() => {
  try {
    createRequire(import.meta.url).resolve('@electric-sql/pglite');
    return true;
  } catch {
    return false;
  }
})();

vi.mock('@/db/client', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const schema = await import('@/db/schema');
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  // neon() のタグ付きテンプレートと同じ呼び方（戻り値は行の配列）
  const neonSql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
    return (await pg.query(text, values)).rows;
  };
  return { db, neonSql, __pg: pg };
});

// next/font はテスト環境で動かないため、デザイン用スタイルだけ空にする（ページ本文の描画は本物）
vi.mock('@/components/site/GraphicPageStyles', () => ({ default: () => null }));

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

// A8.net「通常広告」タグと同じ構造（a8mat 等の値は架空）。前後の改行もそのまま保存されることを確かめる
const A8_TEXT = `<a href="https://px.a8.net/svt/ejp?a8mat=TEST0000+000000+0000+000000" rel="nofollow">推しのオリジナルグッズを作る</a>
<img border="0" width="1" height="1" src="https://www13.a8.net/0.gif?a8mat=TEST0000+000000+0000+000000" alt="">\n`;
const A8_BANNER = `<a href="https://px.a8.net/svt/ejp?a8mat=TEST0000+000000+0000+111111" rel="nofollow">
<img border="0" width="300" height="250" alt="" src="https://www24.a8.net/svt/bgt?aid=000000000000&wid=001&eno=01&mid=s00000000000000&mc=1"></a>
<img border="0" width="1" height="1" src="https://www10.a8.net/0.gif?a8mat=TEST0000+000000+0000+111111" alt="">`;

type Pg = { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
let pg: Pg;

async function snapshot(tables?: string[]): Promise<string> {
  const names = tables ?? (await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows.map((r) => String(r.tablename));
  const out: Record<string, unknown> = {};
  for (const t of names) {
    out[t] = (await pg.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
  }
  out.__columns = (await pg.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
  )).rows;
  out.__indexes = (await pg.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`)).rows;
  return JSON.stringify(out);
}

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

describe.skipIf(!hasPglite)('推し活アフィリエイト × 分離DB（pglite）', () => {
  beforeAll(async () => {
    pg = ((await import('@/db/client')) as unknown as { __pg: Pg }).__pg;
  });

  test('db-init：空のDBで全テーブルを作成でき、推し活用の2テーブルは広告無効が初期値', async () => {
    const { POST } = await import('@/app/api/admin/db-init/route');
    process.env.DATABASE_URL ??= 'postgres://isolated-test';
    const res = await POST();
    const body = await res.json();
    expect(body.createErrors).toEqual([]);
    expect(body.alterErrors).toEqual([]);
    expect(body.counts.oshikatsu_affiliate_services).toBe(0);
    expect(body.counts.oshikatsu_affiliate_creatives).toBe(0);
    const def = await pg.query(`SELECT column_default FROM information_schema.columns WHERE table_name='oshikatsu_affiliate_services' AND column_name='is_ad_enabled'`);
    expect(String(def.rows[0].column_default)).toBe('false');
  });

  test('db-init を既存データがある状態で2回実行しても、全テーブルの行・列・インデックスが1つも変わらない', async () => {
    // 既存データ（人物・作品・VOD・商品・VODアフィリエイト）を入れておく
    await pg.query(`INSERT INTO persons (name, group_name) VALUES ('テスト人物', 'テストグループ')`);
    await pg.query(`INSERT INTO vod_providers (slug, name) VALUES ('hulu', 'Hulu')`);
    await pg.query(`INSERT INTO works (id, person_name, title, type, source, vod_data) VALUES ('w1', 'テスト人物', 'テスト作品', 'movie', 'tmdb', '{"hulu":true}')`);
    await pg.query(`INSERT INTO products (person_name, category, items) VALUES ('テスト人物', 'photobook', '[{"id":"p1"}]')`);
    await pg.query(`INSERT INTO affiliate_programs (vod_service, asp_name, program_name) VALUES ('hulu', 'AccessTrade', 'Hulu')`);
    await pg.query(`INSERT INTO affiliate_creatives (program_id, name, type, raw_code) VALUES (1, 'Hulu CTA', 'raw_html', '<a href="https://example.com/x">Huluで今すぐ見る</a>')`);
    await pg.query(`INSERT INTO affiliate_placements (creative_id, slot_key) VALUES (1, 'work_provider')`);
    await pg.query(`INSERT INTO oshikatsu_affiliate_services (service_key, service_name, category, asp_id, official_url) VALUES ('existing_svc', '既存', 'goods_making', 'a8', 'https://example.com/')`);

    const { POST } = await import('@/app/api/admin/db-init/route');
    const before = await snapshot();
    for (let i = 0; i < 2; i++) {
      const body = await (await POST()).json();
      expect(body.ok).toBe(true);
    }
    expect(await snapshot()).toBe(before);
    await pg.query(`DELETE FROM oshikatsu_affiliate_services WHERE service_key = 'existing_svc'`);
  });

  test('管理API → 公開ページ：承認済み＋広告有効のときだけ、計測用1×1画像を含むタグを1文字も変えずに表示する', async () => {
    const vodTables = ['affiliate_programs', 'affiliate_creatives', 'affiliate_placements', 'persons', 'works', 'products', 'vod_providers'];
    const vodBefore = await snapshot(vodTables);
    const { resolveAffiliateSlot } = await import('@/lib/affiliate-store');
    const vodAdBefore = await resolveAffiliateSlot('hulu', 'work_provider');
    expect(vodAdBefore.desktop?.name).toBe('Hulu CTA');

    const list = await import('@/app/api/admin/oshikatsu-affiliates/route');
    const one = await import('@/app/api/admin/oshikatsu-affiliates/[id]/route');
    const creatives = await import('@/app/api/admin/oshikatsu-affiliates/[id]/creatives/route');
    const creativeOne = await import('@/app/api/admin/oshikatsu-affiliates/creatives/[id]/route');
    const { getPublicOshikatsuAds } = await import('@/lib/oshikatsu-affiliate/store');
    const KEYS = ['cherish_palette', 'shimauma_plus'];

    // 初期案件の登録（2回押しても重複しない）
    const first = await (await list.POST(req('/api/admin/oshikatsu-affiliates', 'POST', { presets: true }))).json();
    expect(first.created.map((s: { serviceKey: string }) => s.serviceKey)).toEqual(KEYS);
    const second = await (await list.POST(req('/api/admin/oshikatsu-affiliates', 'POST', { presets: true }))).json();
    expect(second.created).toEqual([]);
    const services = await (await list.GET()).json();
    const cherish = services.find((s: { serviceKey: string }) => s.serviceKey === 'cherish_palette');
    const shimauma = services.find((s: { serviceKey: string }) => s.serviceKey === 'shimauma_plus');
    expect([cherish.partnershipStatus, cherish.isAdEnabled, shimauma.partnershipStatus, shimauma.isAdEnabled]).toEqual(['approved', false, 'pending', false]);

    // 同じサービスキーの重複登録は 409
    const dup = await list.POST(req('/api/admin/oshikatsu-affiliates', 'POST', {
      serviceKey: 'cherish_palette', serviceName: 'x', category: 'goods_making', aspId: 'a8', officialUrl: 'https://example.com/', partnershipStatus: 'pending',
    }));
    expect(dup.status).toBe(409);

    // プログラムIDの入力
    expect((await one.PUT(req('/', 'PUT', { programId: 's00000000000001' }), params(cherish.id))).status).toBe(200);

    // 不正なタグは保存されない（DBに行が増えない）
    const bad = await creatives.POST(req('/', 'POST', { name: 'bad', kind: 'text', adHtml: `${A8_TEXT}<script>alert(1)</script>` }), params(cherish.id));
    expect(bad.status).toBe(400);
    const noPixel = await creatives.POST(req('/', 'POST', { name: 'bad', kind: 'text', adHtml: A8_TEXT.split('\n')[0] }), params(cherish.id));
    expect(noPixel.status).toBe(400);
    expect((await pg.query('SELECT COUNT(*)::int AS n FROM oshikatsu_affiliate_creatives')).rows[0].n).toBe(0);

    // 正しいタグを登録 → DBにも一字一句そのまま
    const created = await creatives.POST(req('/', 'POST', { name: 'テキスト広告', kind: 'text', adHtml: A8_TEXT }), params(cherish.id));
    expect(created.status).toBe(201);
    const stored = (await pg.query(`SELECT ad_html FROM oshikatsu_affiliate_creatives`)).rows[0].ad_html;
    expect(stored).toBe(A8_TEXT);

    // 広告が無効の間は公開ページに出ない
    expect(await getPublicOshikatsuAds(KEYS)).toEqual({});

    // 広告を有効化 → Cherish Palette だけ表示。タグは登録したものと完全一致
    revalidatePath.mockClear();
    expect((await one.PUT(req('/', 'PUT', { isAdEnabled: true }), params(cherish.id))).status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith('/oshikatsu/goods-making');
    const ads = await getPublicOshikatsuAds(KEYS);
    expect(Object.keys(ads)).toEqual(['cherish_palette']);
    expect(ads.cherish_palette.adHtml).toBe(A8_TEXT);

    // 審査中のしまうまプラスは、素材を登録して広告を有効にしても表示しない
    await creatives.POST(req('/', 'POST', { name: 'バナー', kind: 'banner', adHtml: A8_BANNER }), params(shimauma.id));
    await one.PUT(req('/', 'PUT', { isAdEnabled: true }), params(shimauma.id));
    expect(Object.keys(await getPublicOshikatsuAds(KEYS))).toEqual(['cherish_palette']);

    // 公開ページ（サーバー描画結果）：Cherish Palette のカードにタグそのもの、しまうまプラスは通常リンク
    const { default: GoodsMakingPage } = await import('@/app/oshikatsu/goods-making/page');
    const html = renderToString(await GoodsMakingPage());
    expect(html).toContain(A8_TEXT);
    expect(html).toContain('src="https://www13.a8.net/0.gif?a8mat=TEST0000+000000+0000+000000"');
    // 通常リンクのボタン（React は名前と文言の間に <!-- --> を入れるため、リンク部分で確認）
    const SHIMAUMA_BTN = 'href="https://www.shimauma-plus.n-pri.jp/" target="_blank" rel="noopener noreferrer" class="gm-btn"';
    const CHERISH_BTN = 'href="https://cherish-palette.jp/" target="_blank" rel="noopener noreferrer" class="gm-btn"';
    expect(html).toContain(SHIMAUMA_BTN);
    expect(html).not.toContain(CHERISH_BTN);
    expect(html).toContain(`<div class="gm-ad-tag">${A8_TEXT}</div>`);
    // 広告掲載エリア（PR表記つき）の中にタグが1回だけ。広告リンク・計測用画像が二重に出ない
    expect(html).toMatch(/<aside class="gm-ad gm-ad--text" aria-label="Cherish Paletteの広告"><p class="gm-ad-head"><span class="gm-pr">PR<\/span>/);
    expect(html.split('px.a8.net').length - 1).toBe(1);
    expect(html.split('/0.gif?').length - 1).toBe(1);
    // 目的別の選び方は同じページのカードへの内部リンク
    expect(html).toContain('<a href="#gm-svc-cherish">Cherish Palette<!-- -->の紹介を見る ↑</a>');
    expect(html).toContain('<a href="#gm-svc-shimauma">しまうまプラス<!-- -->の紹介を見る ↑</a>');
    expect(html).toContain('本ページにはアフィリエイト広告が含まれます');
    expect(html).not.toContain('s00000000000001'); // プログラムIDは公開ページに出ない

    // 表示コンポーネント単体でも、タグを改変せずに出力する
    const { default: OshikatsuAdTag } = await import('@/components/oshikatsu/OshikatsuAdTag');
    const one2 = renderToString(createElement(OshikatsuAdTag, { html: A8_BANNER, serviceId: 's', category: 'c', placement: 'p' }));
    expect(one2).toBe(`<div>${A8_BANNER}</div>`);

    // 素材を無効化 → すぐ通常リンクに戻る
    const creativeId = (await pg.query(`SELECT id FROM oshikatsu_affiliate_creatives WHERE name='テキスト広告'`)).rows[0].id as number;
    expect((await creativeOne.PUT(req('/', 'PUT', { isActive: false }), params(creativeId))).status).toBe(200);
    expect(await getPublicOshikatsuAds(KEYS)).toEqual({});
    const htmlOff = renderToString(await GoodsMakingPage());
    expect(htmlOff).toContain(CHERISH_BTN);
    expect(htmlOff).not.toContain('px.a8.net');
    expect(htmlOff).not.toContain('class="gm-ad ');

    // VODアフィリエイト側（テーブル・表示判定）は一切変わっていない
    expect(await snapshot(vodTables)).toBe(vodBefore);
    expect((await resolveAffiliateSlot('hulu', 'work_provider')).desktop?.name).toBe('Hulu CTA');
  });

  test('テーブル未作成・DB障害時も公開ページは落ちず、通常リンクで表示する', async () => {
    await pg.query('ALTER TABLE oshikatsu_affiliate_services RENAME TO oas_tmp');
    try {
      const { getPublicOshikatsuAds } = await import('@/lib/oshikatsu-affiliate/store');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await getPublicOshikatsuAds(['cherish_palette'])).toEqual({});
      spy.mockRestore();
    } finally {
      await pg.query('ALTER TABLE oas_tmp RENAME TO oshikatsu_affiliate_services');
    }
  });
});
