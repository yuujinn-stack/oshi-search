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
    expect(first.created.map((s: { serviceKey: string }) => s.serviceKey)).toEqual([...KEYS, 'kaitori_ouji', 'justy', 'oshitoku', 'surugaya', 'mechakari', 'aircloset']);
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
    expect(html).toContain(`<aside class="gm-ad gm-ad--text" aria-label="Cherish Paletteの広告"><span class="gm-pr">PR</span><div class="gm-ad-tag">${A8_TEXT}</div></aside>`);
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

  test('グッズ買取：承認済み・有効の JUSTY だけ広告タグを表示。サイト側で止めている駿河屋は有効にしても出さない。最終確認日時を保存できる', async () => {
    const one = await import('@/app/api/admin/oshikatsu-affiliates/[id]/route');
    const creatives = await import('@/app/api/admin/oshikatsu-affiliates/[id]/creatives/route');
    const { getPublicOshikatsuAds } = await import('@/lib/oshikatsu-affiliate/store');
    const id = async (key: string) => (await pg.query(`SELECT id FROM oshikatsu_affiliate_services WHERE service_key=$1`, [key])).rows[0].id as number;
    const justy = await id('justy');
    const suruga = await id('surugaya');
    const BUY_KEYS = ['kaitori_ouji', 'justy', 'oshitoku', 'surugaya'];

    // ASPなし（none）の案件にはタグを登録できない
    expect((await creatives.POST(req('/', 'POST', { name: 'x', kind: 'text', adHtml: A8_TEXT }), params(suruga))).status).toBe(400);

    // 最終確認日時の保存
    expect((await one.PUT(req('/', 'PUT', { checkedAt: '2026-11-06T10:00:00+09:00' }), params(justy))).status).toBe(200);
    expect((await pg.query(`SELECT checked_at FROM oshikatsu_affiliate_services WHERE id=$1`, [justy])).rows[0].checked_at).not.toBeNull();

    // JUSTY: タグ登録 → 承認・有効化で表示
    expect((await creatives.POST(req('/', 'POST', { name: 'JUSTY テキスト', kind: 'text', adHtml: A8_TEXT }), params(justy))).status).toBe(201);
    expect(await getPublicOshikatsuAds(BUY_KEYS)).toEqual({});
    await one.PUT(req('/', 'PUT', { partnershipStatus: 'approved', isAdEnabled: true }), params(justy));
    // 駿河屋: ASPを A8 に変えてタグを登録し、承認・有効にしても表示しない（OSHIKATSU_AD_BLOCKED）
    await one.PUT(req('/', 'PUT', { aspId: 'a8', partnershipStatus: 'approved', isAdEnabled: true }), params(suruga));
    expect((await creatives.POST(req('/', 'POST', { name: 'suruga', kind: 'text', adHtml: A8_TEXT }), params(suruga))).status).toBe(201);
    const ads = await getPublicOshikatsuAds(BUY_KEYS);
    expect(Object.keys(ads)).toEqual(['justy']);
    expect(ads.justy.adHtml).toBe(A8_TEXT);

    // 公開ページの判定は checked_at 列を読まない（本番で db-init 前でも広告表示が止まらない）
    await pg.query('ALTER TABLE oshikatsu_affiliate_services DROP COLUMN checked_at');
    try {
      expect(Object.keys(await getPublicOshikatsuAds(BUY_KEYS))).toEqual(['justy']);
    } finally {
      await pg.query('ALTER TABLE oshikatsu_affiliate_services ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ');
    }

    // 買取比較ページ：JUSTY は広告枠＋PR、買取王子・推しトク・駿河屋は公式サイトへの通常リンク
    const { default: GoodsBuybackPage } = await import('@/app/oshikatsu/goods-buyback/page');
    const html = renderToString(await GoodsBuybackPage());
    expect(html).toContain(`<aside class="gm-ad gm-ad--text" aria-label="JUSTYの広告"><span class="gm-pr">PR</span><div class="gm-ad-tag">${A8_TEXT}</div></aside>`);
    expect(html).toContain('本ページにはアフィリエイト広告が含まれます');
    expect(html).toContain('href="https://www.kaitoriouji.jp/item/idolgoods/" target="_blank" rel="noopener noreferrer" class="gm-btn"');
    expect(html).toContain('href="https://www.suruga-ya.jp/man/kaitori/kantan.html" target="_blank" rel="noopener noreferrer" class="gm-btn"');
    expect(html).not.toContain('https://justy-consul.com/idols/" target="_blank" rel="noopener noreferrer" class="gm-btn"');
    expect(html).toContain('href="https://kaitori-janiyard.jp/idol" target="_blank" rel="noopener noreferrer" class="gm-btn"');
    expect(html.split('px.a8.net').length - 1).toBe(1);

    // 広告を無効にすると JUSTY も公式サイトへの通常リンクに戻る
    await one.PUT(req('/', 'PUT', { isAdEnabled: false }), params(justy));
    const htmlOff = renderToString(await GoodsBuybackPage());
    expect(htmlOff).not.toContain('px.a8.net');
    expect(htmlOff).not.toContain('本ページにはアフィリエイト広告が含まれます');
    expect(htmlOff).toContain('href="https://justy-consul.com/idols/" target="_blank" rel="noopener noreferrer" class="gm-btn"');
  });

  test('ファッションレンタル：初期登録は広告OFF。承認前は有効にしても出さず、承認済み・有効・タグ登録後だけ広告タグを表示する', async () => {
    const one = await import('@/app/api/admin/oshikatsu-affiliates/[id]/route');
    const creatives = await import('@/app/api/admin/oshikatsu-affiliates/[id]/creatives/route');
    const { getPublicOshikatsuAds } = await import('@/lib/oshikatsu-affiliate/store');
    const rows = (await pg.query(`SELECT id, service_key, asp_id, partnership_status, is_ad_enabled FROM oshikatsu_affiliate_services WHERE category='fashion_rental' ORDER BY id`)).rows;
    expect(rows.map((r) => [r.service_key, r.asp_id, r.partnership_status, r.is_ad_enabled])).toEqual([
      ['mechakari', 'a8', 'not_applied', false],
      ['aircloset', 'a8', 'not_applied', false],
    ]);
    const FR_KEYS = ['mechakari', 'aircloset'];
    const mecha = rows[0].id as number;
    const { default: FashionRentalPage } = await import('@/app/oshikatsu/fashion-rental/page');

    // 初期状態：公式サイトへの通常リンクだけ、PR表記なし
    let html = renderToString(await FashionRentalPage());
    expect(html).toContain('href="https://mechakari.com/" target="_blank" rel="noopener noreferrer" class="gm-btn"');
    expect(html).toContain('href="https://www.air-closet.com/" target="_blank" rel="noopener noreferrer" class="gm-btn"');
    // 料金プラン直後の公式サイトボタン（通常リンク）
    expect(html).toContain('href="https://mechakari.com/" target="_blank" rel="noopener noreferrer" class="gm-btn fr-plan-btn"');
    expect(html).toContain('href="https://www.air-closet.com/" target="_blank" rel="noopener noreferrer" class="gm-btn fr-plan-btn"');
    expect(html).not.toContain('px.a8.net');
    expect(html).not.toContain('本ページにはアフィリエイト広告が含まれます');

    // 承認前：タグを登録して広告を有効にしても表示しない
    expect((await creatives.POST(req('/', 'POST', { name: 'メチャカリ テキスト', kind: 'text', adHtml: A8_TEXT }), params(mecha))).status).toBe(201);
    await one.PUT(req('/', 'PUT', { isAdEnabled: true }), params(mecha));
    expect(await getPublicOshikatsuAds(FR_KEYS)).toEqual({});

    // 承認済みにすると表示（PR表記つき）。無効に戻すと通常リンク
    await one.PUT(req('/', 'PUT', { partnershipStatus: 'approved' }), params(mecha));
    expect(Object.keys(await getPublicOshikatsuAds(FR_KEYS))).toEqual(['mechakari']);
    html = renderToString(await FashionRentalPage());
    expect(html).toContain(`<aside class="gm-ad gm-ad--text" aria-label="メチャカリの広告"><span class="gm-pr">PR</span><div class="gm-ad-tag">${A8_TEXT}</div></aside>`);
    // 広告タグ（計測用画像）は1か所だけ。上の公式サイトボタンは下部の広告枠へのページ内リンク
    expect(html.split('px.a8.net').length - 1).toBe(1);
    expect(html).toContain('href="#fr-mechakari-cta"');
    expect(html).toMatch(/<a href="#fr-mechakari-cta" class="gm-btn fr-plan-btn"[^>]*>PRリンクを見る ↓<\/a>/);
    // 広告がない airCloset は従来どおり公式サイトへの通常リンク（上下とも）
    expect(html).toContain('href="https://www.air-closet.com/" target="_blank" rel="noopener noreferrer" class="gm-btn fr-plan-btn"');
    expect(html).not.toContain('href="https://mechakari.com/" target="_blank" rel="noopener noreferrer" class="gm-btn fr-plan-btn"');
    expect(html).toContain('本ページにはアフィリエイト広告が含まれます');
    await one.PUT(req('/', 'PUT', { isAdEnabled: false, partnershipStatus: 'not_applied' }), params(mecha));
    expect(await getPublicOshikatsuAds(FR_KEYS)).toEqual({});
    html = renderToString(await FashionRentalPage());
    expect(html).toContain('href="https://mechakari.com/" target="_blank" rel="noopener noreferrer" class="gm-btn fr-plan-btn"');
    expect(html).not.toContain('PRリンクを見る');
    expect(html).not.toContain('px.a8.net');

    // 既存のグッズ制作・グッズ買取の案件は変わっていない
    const others = (await pg.query(`SELECT service_key, partnership_status FROM oshikatsu_affiliate_services WHERE category <> 'fashion_rental' ORDER BY id`)).rows;
    expect(others.map((r) => r.service_key)).toEqual(['cherish_palette', 'shimauma_plus', 'kaitori_ouji', 'justy', 'oshitoku', 'surugaya']);
  });

  test('本番公開から db-init までの間（checked_at 列なし）：公開ページの広告は表示され、管理画面の一覧だけがエラー。db-init でデータを失わずに復旧する', async () => {
    const one = await import('@/app/api/admin/oshikatsu-affiliates/[id]/route');
    const store = await import('@/lib/oshikatsu-affiliate/store');
    const { POST: dbInit } = await import('@/app/api/admin/db-init/route');
    const justy = (await pg.query(`SELECT id FROM oshikatsu_affiliate_services WHERE service_key='justy'`)).rows[0].id as number;
    await one.PUT(req('/', 'PUT', { isAdEnabled: true }), params(justy));
    const before = await snapshot(['oshikatsu_affiliate_services', 'oshikatsu_affiliate_creatives', 'affiliate_programs', 'affiliate_creatives', 'affiliate_placements']);

    // 旧バージョンのDB（列なし）を再現
    await pg.query('ALTER TABLE oshikatsu_affiliate_services DROP COLUMN checked_at');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 公開ページ：広告判定は影響を受けない
      expect(Object.keys(await store.getPublicOshikatsuAds(['justy', 'kaitori_ouji']))).toEqual(['justy']);
      const { default: GoodsBuybackPage } = await import('@/app/oshikatsu/goods-buyback/page');
      expect(renderToString(await GoodsBuybackPage())).toContain('aria-label="JUSTYの広告"');
      // 管理画面の推し活タブ・推し活の管理API：列がないためエラー（VOD側の affiliate_* は対象外）
      await expect(store.listOshikatsuAffiliateServicesOrThrow()).rejects.toThrow();
      const { getAllAffiliateProgramsOrThrow } = await import('@/lib/affiliate-store');
      await expect(getAllAffiliateProgramsOrThrow()).resolves.toBeTruthy();
    } finally {
      spy.mockRestore();
    }

    // db-init（ADD COLUMN IF NOT EXISTS）で復旧。2回実行しても同じ。既存の行は変わらない（checked_at は NULL で追加）
    for (let i = 0; i < 2; i++) expect((await (await dbInit()).json()).ok).toBe(true);
    await expect(store.listOshikatsuAffiliateServicesOrThrow()).resolves.toHaveLength(8);
    const after = await snapshot(['oshikatsu_affiliate_services', 'oshikatsu_affiliate_creatives', 'affiliate_programs', 'affiliate_creatives', 'affiliate_placements']);
    const strip = (x: string) => JSON.parse(x, (k, v) => (k === 'checked_at' || k === '__columns' || k === '__indexes' ? undefined : v));
    expect(strip(after)).toEqual(strip(before));
    await one.PUT(req('/', 'PUT', { isAdEnabled: false }), params(justy));
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
