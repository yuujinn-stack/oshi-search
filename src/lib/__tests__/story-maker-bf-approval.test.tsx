// 楽天BF：承認・セール期間・有効期限をサーバーの時刻で判定すること（署名・API・投稿記録の保存・表示の一致）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const CANDIDATE = { productId: 'p1', title: 'サンプル商品 初回盤', section: 'Blu-ray・DVD', pageUrl: 'https://item.rakuten.co.jp/shop-a/item-1/', thumbUrl: null, storedPrice: null };
vi.mock('@/server/story-maker/goods-data', () => ({
  loadStorySaleCandidates: vi.fn(async () => ({ targetName: 'Snow Man', candidates: [CANDIDATE], totalOnSite: 1 })),
  StoryGoodsError: class extends Error { status = 400; },
}));
// 投稿記録の保存先（Redis）はメモリ上の代わりを使う（本物の Redis には書かない）
const store = new Map<string, Map<string, string>>();
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    hget: async (k: string, f: string) => store.get(k)?.get(f) ?? null,
    hlen: async (k: string) => store.get(k)?.size ?? 0,
    hset: async (k: string, obj: Record<string, string>) => { const m = store.get(k) ?? new Map(); for (const [f, v] of Object.entries(obj)) m.set(f, v); store.set(k, m); return 1; },
    hgetall: async (k: string) => Object.fromEntries(store.get(k) ?? []),
    hdel: async () => 1,
  }),
}));

import {
  BF_APPROVAL_TTL_MS,
  bfSaleCorner,
  checkBfRecordTiming,
  isApprovalUsable,
  verifyBfItem,
  type BfApprovedItem,
  type BfVerificationInput,
} from '@/lib/story-maker/bf-sale';
import { approveBfItem, checkBfApprovals, signBfApproval, verifyBfRecordApprovals, verifyBfSignature } from '@/server/story-maker/bf-approval';
import { saveStoryPost } from '@/server/story-maker/post-store';
import { GET as bfGet, POST as bfPost } from '@/app/api/admin/story-maker/bf-sale/route';
import { POST as postsPost } from '@/app/api/admin/story-maker/posts/route';
import BfSalePanel from '@/app/admin/story-maker/BfSalePanel';

const START = Date.parse('2026-11-19T20:00:00+09:00');
const END = Date.parse('2026-11-25T01:59:00+09:00');
const DURING = Date.parse('2026-11-20T12:00:00+09:00');
const H24 = BF_APPROVAL_TTL_MS;
const GROUP = { type: 'group' as const, name: 'Snow Man' };
const input: BfVerificationInput = { priceLabel: '通常価格', regularPrice: '9900', salePrice: '7920', sourceUrl: CANDIDATE.pageUrl, discountKind: 'price-cut', conditions: '', confirmed: true, checkedBy: '確認者' };

/** JST の "YYYY-MM-DDTHH:mm" */
function jst(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 16);
}
async function signedAt(ms: number, target = GROUP): Promise<BfApprovedItem> {
  const r = verifyBfItem(CANDIDATE, input, ms);
  if (!r.ok) throw new Error(r.errors.join());
  return signBfApproval(r.item, target);
}
function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/story-maker/bf-sale', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.stubEnv('ADMIN_SESSION_SECRET', 'x'.repeat(48));
  store.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('セール期間・有効期限の境界（サーバーの時刻を渡して判定）', () => {
  it('開始直前は不可・開始時は可・終了直前は可・終了時刻以降は不可（日本時間 11/19 20:00〜11/25 1:59）', () => {
    const sale = bfSaleCorner();
    expect(sale?.startsAt).toBe(START);
    expect(sale?.endsAt).toBe(END);
    expect(verifyBfItem(CANDIDATE, input, START - 1).ok).toBe(false);
    expect(verifyBfItem(CANDIDATE, input, START).ok).toBe(true);
    expect(verifyBfItem(CANDIDATE, input, END - 1).ok).toBe(true);
    expect(verifyBfItem(CANDIDATE, input, END).ok).toBe(false);
    expect(verifyBfItem(CANDIDATE, input, END + 3600_000).ok).toBe(false);
  });

  it('承認から24時間未満は有効、ちょうど24時間・24時間超過は無効', async () => {
    const it0 = await signedAt(DURING);
    expect(isApprovalUsable(it0, DURING + H24 - 1)).toBe(true);
    expect(isApprovalUsable(it0, DURING + H24)).toBe(false);
    expect(isApprovalUsable(it0, DURING + H24 + 60_000)).toBe(false);
    // 24時間以内でもセールが終われば無効
    const late = await signedAt(END - 3600_000);
    expect(isApprovalUsable(late, END - 1)).toBe(true);
    expect(isApprovalUsable(late, END)).toBe(false);
  });
});

describe('承認の署名（サーバーだけが付けられる）', () => {
  it('承認内容・承認日時・推しのどれかを変えると署名が合わない', async () => {
    const item = await signedAt(DURING);
    expect(item.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyBfSignature(item, GROUP)).toBe(true);
    expect(await verifyBfSignature({ ...item, salePrice: 5000 }, GROUP)).toBe(false);
    expect(await verifyBfSignature({ ...item, checkedAt: new Date(DURING + 3600_000).toISOString() }, GROUP)).toBe(false);
    expect(await verifyBfSignature({ ...item, conditions: '条件なし' }, GROUP)).toBe(false);
    expect(await verifyBfSignature({ ...item, sourceUrl: 'https://item.rakuten.co.jp/other/x/' }, GROUP)).toBe(false);
    expect(await verifyBfSignature({ ...item, signature: 'f'.repeat(64) }, GROUP)).toBe(false);
    expect(await verifyBfSignature(item, { type: 'group', name: 'SixTONES' })).toBe(false); // 別の推しの承認
    expect(await verifyBfSignature(item, { type: 'person', name: 'Snow Man' })).toBe(false);
  });

  it('鍵（ADMIN_SESSION_SECRET）が無い・短いときは承認しない', async () => {
    vi.stubEnv('ADMIN_SESSION_SECRET', 'short');
    await expect(signedAt(DURING)).rejects.toThrow('ADMIN_SESSION_SECRET');
  });

  it('候補はサーバーで読み直す（候補に無い商品は承認しない）', async () => {
    expect(await approveBfItem(GROUP, 'not-a-candidate', input, DURING)).toEqual({ ok: false, errors: ['この推しの候補に無い商品です。候補を読み込み直してください。'] });
  });
});

describe('API を直接呼び出した場合（/api/admin/story-maker/bf-sale）', () => {
  it('承認日時はサーバーの時刻。ブラウザから届いた時刻・承認日時は使わない（PCの時計が進んでいても遅れていても同じ）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DURING); // サーバーの時刻＝開催中
    for (const pcClock of [DURING + 10 * 24 * 3600_000, DURING - 10 * 24 * 3600_000]) { // PCの時計が10日進んでいる・遅れている
      const res = await bfPost(req({ action: 'approve', ...GROUP, productId: 'p1', input: { ...input, checkedAt: new Date(pcClock).toISOString() }, now: pcClock, checkedAt: new Date(pcClock).toISOString() }));
      const j = await res.json();
      expect(res.status).toBe(200);
      expect(j.item.checkedAt).toBe(new Date(DURING).toISOString());
      expect(j.now).toBe(DURING);
    }
    expect((await (await bfGet()).json()).now).toBe(DURING);
  });

  it('サーバーの時刻がセール期間外なら、PCの時計が開催中でも承認できない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const server of [START - 1, END, END + 24 * 3600_000]) {
      vi.setSystemTime(server);
      const res = await bfPost(req({ action: 'approve', ...GROUP, productId: 'p1', input, now: DURING }));
      expect(res.status).toBe(400);
      expect((await res.json()).errors.join()).toContain('開催中だけ承認できます');
    }
  });

  it('PNG保存前の確認：署名・期間・期限をサーバーの時刻で（不正な承認日時・改ざん・別の推しは不可）', async () => {
    const item = await signedAt(DURING);
    vi.useFakeTimers({ toFake: ['Date'] });
    const check = async (items: unknown, target = GROUP) => (await (await bfPost(req({ action: 'check', ...target, items }))).json()) as { ok: boolean; problems: { reason: string }[] };
    vi.setSystemTime(DURING + 3600_000);
    expect((await check([item])).ok).toBe(true);
    // 承認日時を書き換える（例：期限切れを隠すため新しい時刻に）→ 署名が合わない
    const forged = { ...item, checkedAt: new Date(DURING + 23 * 3600_000).toISOString() };
    expect((await check([forged])).problems[0].reason).toContain('承認の内容を確認できません');
    // 署名の無い・形式の違う承認
    expect((await check([{ ...item, signature: '' }])).ok).toBe(false);
    expect((await check([{ ...item, salePrice: 1 }])).ok).toBe(false);
    // 別の推しの承認を使い回す
    expect((await check([item], { type: 'group', name: 'SixTONES' })).ok).toBe(false);
    // 24時間ちょうど・超過
    vi.setSystemTime(DURING + H24);
    expect((await check([item])).problems[0].reason).toContain('24時間');
    // セール終了後
    const late = await signedAt(END - 60_000);
    vi.setSystemTime(END);
    expect((await check([late])).problems[0].reason).toContain('期間外');
    // 商品なし
    expect((await check([])).ok).toBe(false);
  });

  it('操作・対象が正しくない呼び出しは 400', async () => {
    expect((await bfPost(req({ action: 'x', ...GROUP }))).status).toBe(400);
    expect((await bfPost(req({ action: 'approve', type: 'x', name: 'Snow Man' }))).status).toBe(400);
  });
});

describe('投稿記録の保存（サーバーの時刻と投稿日時で検証）', () => {
  const base = (templateId: 'bf' | 'bfstory', item: BfApprovedItem, postedAt: string) => ({
    id: `rec${templateId}${Math.random().toString(36).slice(2, 8)}`, postedAt, templateId, targetName: 'Snow Man', targetType: 'group',
    slideCount: templateId === 'bf' ? 3 : 2, linkSlide: templateId === 'bf' ? 3 : 2, reach: [], utmCampaign: 'c', utmContent: 'x', url: 'https://oshi-search.jp/', saleItems: [item],
  });

  it('通常投稿・ストーリーズとも、承認から24時間以内・セール中の投稿日時なら保存でき、あとから編集しても通る', async () => {
    const item = await signedAt(DURING);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DURING + 2 * 3600_000);
    for (const t of ['bf', 'bfstory'] as const) {
      const rec = base(t, item, jst(DURING + 3600_000));
      const saved = await saveStoryPost(rec);
      expect(saved.saleItems?.[0].signature).toBe(item.signature);
      // 3日後にリーチを入力して保存し直す（投稿日時は同じ）→ 通る
      vi.setSystemTime(DURING + 3 * 24 * 3600_000);
      await expect(saveStoryPost({ ...rec, reach: [100, 80, 60] })).resolves.toBeTruthy();
      vi.setSystemTime(DURING + 2 * 3600_000);
    }
  });

  it('投稿日時が24時間ちょうど・超過・承認より前・セール終了後なら保存しない', async () => {
    const item = await signedAt(DURING);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(END + 24 * 3600_000);
    for (const posted of [DURING + H24, DURING + H24 + 60_000, DURING - 2 * 60_000]) {
      await expect(saveStoryPost(base('bf', item, jst(posted)))).rejects.toThrow('有効ではありません');
    }
    const late = await signedAt(END - 3600_000);
    await expect(saveStoryPost(base('bfstory', late, jst(END)))).rejects.toThrow('有効ではありません');
    // 終了1分前の投稿を、終了30秒前（承認が今も有効なうち）に新規で記録するのは可
    vi.setSystemTime(END - 30_000);
    await expect(saveStoryPost(base('bfstory', late, jst(END - 60_000)))).resolves.toBeTruthy();
  });

  it('新規の記録：サーバーの今は承認から24時間以上たっているのに、投稿日時だけを期限内に戻しても保存できない（APIを直接呼んでも）', async () => {
    const item = await signedAt(DURING);
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const t of ['bf', 'bfstory'] as const) {
      for (const server of [DURING + H24, DURING + 25 * 3600_000, END + 7 * 24 * 3600_000]) { // ちょうど24時間・25時間後・セール終了の1週間後
        vi.setSystemTime(server);
        const rec = base(t, item, jst(DURING + 3600_000)); // 投稿日時は承認の1時間後（期限内）に戻してある
        await expect(saveStoryPost(rec)).rejects.toThrow('新しく記録できません');
        const res = await postsPost(new NextRequest('http://localhost/api/admin/story-maker/posts', { method: 'POST', body: JSON.stringify({ record: rec }) }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('新しく記録できません');
      }
      // 24時間未満なら新規でも保存できる
      vi.setSystemTime(DURING + H24 - 60_000);
      await expect(saveStoryPost(base(t, item, jst(DURING + 3600_000)))).resolves.toBeTruthy();
    }
  });

  it('保存済みの記録：セール終了後でもリーチ等の指標は編集できる。ただし承認の差し替え・投稿日時の期限外への変更・別IDへの複製はできない', async () => {
    const item = await signedAt(DURING);
    const other = await signedAt(DURING - 3600_000); // 別の（古い）承認
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const t of ['bf', 'bfstory'] as const) {
      vi.setSystemTime(DURING + 2 * 3600_000);
      const rec = base(t, item, jst(DURING + 3600_000));
      await saveStoryPost(rec);
      vi.setSystemTime(END + 7 * 24 * 3600_000); // セール終了の1週間後
      // 指標の編集（同じ承認・同じ投稿日時）→ 可
      const edited = await saveStoryPost({ ...rec, reach: [1200, 900, 700], linkTaps: 40, memo: '後日入力' });
      expect(edited.reach.slice(0, 2)).toEqual([1200, 900]);
      expect(edited.saleItems?.[0].signature).toBe(item.signature);
      // 承認を別の承認に差し替える → 新しく記録する承認として今の時刻で判定 → 不可
      await expect(saveStoryPost({ ...rec, saleItems: [other] })).rejects.toThrow('新しく記録できません');
      // 投稿日時を承認の期限外に変える → 不可
      await expect(saveStoryPost({ ...rec, postedAt: jst(DURING + H24 + 60_000) })).rejects.toThrow('有効ではありません');
      // 保存済みの記録を別のIDで複製（新規扱い）→ 不可
      await expect(saveStoryPost({ ...rec, id: `${rec.id}copy` })).rejects.toThrow('新しく記録できません');
    }
  });

  it('署名の無い・書き換えた・別の推しの承認は保存しない（posts API を直接呼んでも）', async () => {
    const item = await signedAt(DURING);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DURING + 3600_000);
    const call = async (rec: unknown) => postsPost(new NextRequest('http://localhost/api/admin/story-maker/posts', { method: 'POST', body: JSON.stringify({ record: rec }) }));
    const posted = jst(DURING + 600_000);
    expect((await call(base('bf', { ...item, signature: '' }, posted))).status).toBe(400);
    expect((await call(base('bf', { ...item, salePrice: 1000 }, posted))).status).toBe(400);
    expect((await call(base('bf', { ...item, checkedAt: new Date(DURING + 600_000).toISOString() }, posted))).status).toBe(400);
    expect((await call({ ...base('bf', item, posted), targetName: 'SixTONES' })).status).toBe(400);
    expect((await call(base('bf', item, posted))).status).toBe(200);
  });

  it('承認日時がサーバーの今より未来なら不可（checkBfRecordTiming）。他のテンプレートの記録は従来どおり', async () => {
    expect(checkBfRecordTiming([{ productId: 'p1', checkedAt: new Date(DURING + 3600_000).toISOString(), saleId: 'rakuten-blackfriday-2026' }], jst(DURING + 3600_000), DURING)[0]).toContain('承認日時が正しくありません');
    expect(await verifyBfRecordApprovals({ targetName: 'Snow Man', targetType: 'group', postedAt: jst(DURING), saleItems: [] })).toEqual([]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2027-03-01T00:00:00+09:00'));
    const goods = { id: 'recgoods01', postedAt: '2027-03-01T09:00', templateId: 'goods', targetName: 'Snow Man', targetType: 'group', slideCount: 2, linkSlide: 2, reach: [10, 5] };
    await expect(saveStoryPost(goods)).resolves.toMatchObject({ templateId: 'goods' });
  });
});

describe('表示の不一致（React #418）を起こさない', () => {
  it('サーバーの描画も画面の最初の描画も、ページを描いたときのサーバーの時刻（serverNow）で開催状態を出す（PCの時計に依らない）', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const render = (serverNow: number, pcNow: number) => {
      vi.setSystemTime(pcNow);
      return renderToStaticMarkup(<BfSalePanel target={{ type: 'group', name: 'Snow Man', pagePath: '/g' }} onChange={() => {}} serverNow={serverNow} />);
    };
    // サーバーは開催中、PCは終了後・開始前でも同じ出力
    const a = render(END - 60_000, END - 60_000);
    expect(a).toContain('開催中');
    expect(render(END - 60_000, END + 3600_000)).toBe(a);
    expect(render(END - 60_000, START - 3600_000)).toBe(a);
    // サーバーが終了後なら（PCが開催中でも）終了と出す
    expect(render(END, DURING)).toContain('終了');
  });
});
