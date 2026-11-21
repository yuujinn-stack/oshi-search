'use client';

/**
 * ストーリーズ作成（/admin/story-maker）のテンプレート「楽天BF・推し別セール紹介」だけで出す、セール対象商品の選択と確認・承認欄。
 *
 * - 候補：選んだ人物・グループのページに公開中の関連商品（B と同じ選び方。/api/admin/story-maker/goods?mode=sale）。
 *   既存の商品データには楽天ブラックフライデーの対象・通常価格・セール価格が無いため、候補のままでは掲載できない。
 * - 承認：管理者が楽天の商品ページを開き、BF の対象であること・価格の表記（通常価格 等）・セール価格を確認して入力し、
 *   確認のチェックと確認者名を入れて「承認する」。検証は src/lib/story-maker/bf-sale.ts（推測で数字を作らない）。
 * - 値引きの種類（表示価格の値下げ／ポイント・買いまわりのみ／クーポン時のみ）を選ばせ、表示価格そのものの値下げだけ承認する。
 *   根拠URL（確認した商品ページ）・確認日時・適用条件を承認内容として持つ。
 * - 承認済みの商品から最大6件を「投稿に使う」で選ぶ（3件まで商品ページ1枚、4〜6件で2枚）。承認から24時間を過ぎた・セールが終わったものは自動で使えなくなる。
 * - 対象（人物・グループ）を変えたら、親が key を変えてこのパネルを作り直す（別の推しの承認を持ち越さない）。
 * 承認内容はこの画面の中だけで持ち、効果測定の記録（投稿データ）を保存するときに一緒に保存する。DB・商品データは変更しない。
 *
 * 時刻：承認・期間・有効期限はサーバーの時刻で判定する（管理者PCの時計は使わない）。
 * - 承認は /api/admin/story-maker/bf-sale（action=approve）で行い、サーバーが署名した承認を受け取る
 * - 画面の表示（開催中・期限切れ）は、ページを描いたときのサーバーの時刻（serverNow）から始め、表示後はサーバーの時刻を取り直して
 *   performance.now()（PCの時計を変えても進み方が変わらない）で進める。サーバーと同じ時刻で描くため表示の不一致（React #418）が起きない
 * - PNG保存の前に checkBfApprovalsOnServer でサーバーに確かめる（StoryMakerClient）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { currentPriceDraft, type BfAutoItem, type BfAutoResult } from '@/lib/story-maker/bf-auto';
import {
  BF_CONDITIONS_MAX,
  BF_DISCOUNT_KINDS,
  BF_MAX_ITEMS,
  BF_PRICE_LABELS,
  EMPTY_VERIFICATION,
  bfSalePeriodLabel,
  bfSalePhase,
  calcDiscount,
  formatYen,
  isApprovalUsable,
  maxOffRate,
  parseYen,
  type BfApprovedItem,
  type BfDiscountKind,
  type BfPriceLabel,
  type BfSaleCandidate,
  type BfSlideItem,
  type BfVerificationInput,
} from '@/lib/story-maker/bf-sale';
import type { StoryTarget } from '@/lib/story-maker/templates';

export interface BfPanelState {
  items: BfSlideItem[];
  /** 保存できない理由（null なら保存できる） */
  blocked: string | null;
}

const FETCH_TIMEOUT_MS = 25_000;
const CHECKER_KEY = 'story-maker:bf-checker';

function readChecker(): string {
  try { return localStorage.getItem(CHECKER_KEY) ?? ''; } catch { return ''; }
}
function writeChecker(v: string) {
  try { localStorage.setItem(CHECKER_KEY, v); } catch { /* 保存できない環境 */ }
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(j.error ?? `取得に失敗しました（HTTP ${res.status}）`);
    return j;
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error(`${FETCH_TIMEOUT_MS / 1000}秒以内に取得できませんでした。時間をおいてもう一度お試しください。`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const BF_API = '/api/admin/story-maker/bf-sale';
const BF_AUTO_API = '/api/admin/story-maker/bf-auto';

async function postBf<T>(body: Record<string, unknown>, url = BF_API): Promise<{ status: number; json: T & { error?: string; now?: number } }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as T & { error?: string; now?: number } };
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error(`${FETCH_TIMEOUT_MS / 1000}秒以内にサーバーから応答がありませんでした。`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PNG保存の前に、サーバーの時刻で承認（署名・セール期間・有効期限）を確かめる。
 * 通信できないときも保存させない（ok=false）。
 */
export async function checkBfApprovalsOnServer(target: StoryTarget, items: BfApprovedItem[]): Promise<{ ok: boolean; message: string | null }> {
  try {
    const { status, json } = await postBf<{ ok?: boolean; problems?: { productId: string; reason: string }[] }>({
      action: 'check', type: target.type, name: target.name,
      items: items.map((i) => { const { imageSrc: _img, ...rest } = i as BfApprovedItem & { imageSrc?: unknown }; return rest; }),
    });
    if (status !== 200) return { ok: false, message: json.error ?? `サーバーで承認を確認できませんでした（HTTP ${status}）。` };
    if (json.ok) return { ok: true, message: null };
    const reasons = Array.from(new Set((json.problems ?? []).map((p) => p.reason)));
    return { ok: false, message: reasons.join(' ') || '承認を確認できませんでした。' };
  } catch (err) {
    return { ok: false, message: `サーバーで承認を確認できませんでした：${err instanceof Error ? err.message : String(err)}` };
  }
}

export default function BfSalePanel({ target, onChange, serverNow }: { target: StoryTarget | null; onChange: (s: BfPanelState) => void; serverNow: number }) {
  // サーバーの時刻。初回の描画はページを描いたときのサーバーの時刻（SSR と同じ値）、表示後は performance.now() で進める
  const clock = useRef<{ server: number; perf: number | null }>({ server: serverNow, perf: null });
  const serverTime = () => (clock.current.perf === null ? clock.current.server : clock.current.server + (performance.now() - clock.current.perf));
  const [now, setNow] = useState(serverNow);
  const syncClock = (server: unknown) => {
    if (typeof server !== 'number' || !Number.isFinite(server)) return;
    clock.current = { server, perf: performance.now() };
    setNow(server);
  };
  const [approving, setApproving] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BfSaleCandidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, BfVerificationInput>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string[]>>({});
  const [approved, setApproved] = useState<Record<string, BfApprovedItem>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [imageError, setImageError] = useState<string | null>(null);
  const [checker, setChecker] = useState('');
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoItems, setAutoItems] = useState<Record<string, BfAutoItem>>({});
  const [autoRecommended, setAutoRecommended] = useState<string[]>([]);
  const [autoCheckedCount, setAutoCheckedCount] = useState(0);
  const [autoWarning, setAutoWarning] = useState<string | null>(null);

  useEffect(() => { setChecker(readChecker()); }, []);
  // 表示後：サーバーの時刻を取り直し、開催状態・承認の期限を30秒ごとに見直す（PCの時計は使わない）
  useEffect(() => {
    clock.current = { server: clock.current.server, perf: performance.now() };
    fetch(BF_API, { cache: 'no-store' }).then((r) => r.json()).then((j: { now?: unknown }) => syncClock(j.now)).catch(() => { /* 取れなければページを描いたときの時刻から進める */ });
    const id = setInterval(() => setNow(serverTime()), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = bfSalePhase(now);
  const usable = useMemo(
    () => selected.map((id) => approved[id]).filter((it): it is BfApprovedItem => !!it && isApprovalUsable(it, now)),
    [selected, approved, now],
  );
  const expiredSelected = selected.filter((id) => approved[id] && !isApprovalUsable(approved[id], now));

  // 採用した商品の画像（サーバーで取得した data: URL。投稿画像に外部URLを描かない）
  useEffect(() => {
    if (!target) return;
    const missing = usable.map((i) => i.productId).filter((id) => !(id in images));
    if (missing.length === 0) return;
    let cancelled = false;
    setImageError(null);
    fetchJson<{ images: { productId: string; imageSrc: string | null }[] }>(
      `/api/admin/story-maker/goods?type=${target.type}&name=${encodeURIComponent(target.name)}&mode=sale-images&ids=${missing.map(encodeURIComponent).join(',')}`,
    )
      .then((j) => { if (!cancelled) setImages((prev) => ({ ...prev, ...Object.fromEntries(j.images.map((x) => [x.productId, x.imageSrc])) })); })
      .catch((err) => { if (!cancelled) setImageError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [usable, images, target]);

  const imagesPending = usable.some((i) => !(i.productId in images));
  const blocked: string | null =
    !target ? '人物またはグループを選んでください。' :
    phase !== 'active' ? '楽天ブラックフライデーの開催中だけ作成できます（開催前・終了後は保存できません）。' :
    expiredSelected.length > 0 ? `承認から24時間を過ぎた商品があります（${expiredSelected.length}件）。商品ページで価格を確認し直して承認してください。` :
    usable.length === 0 ? `楽天ブラックフライデーの対象と確認・承認した商品を1〜${BF_MAX_ITEMS}件、「投稿に使う」で選んでください。` :
    imageError ? `商品画像を取得できませんでした：${imageError}` :
    imagesPending ? '商品画像を取得しています…' :
    null;

  const slideItems = useMemo<BfSlideItem[]>(() => usable.map((i) => ({ ...i, imageSrc: images[i.productId] ?? null })), [usable, images]);
  const signature = JSON.stringify([slideItems.map((i) => [i.productId, i.regularPrice, i.salePrice, i.discountKind, i.conditions, i.checkedAt, i.imageSrc?.length ?? 0]), blocked]);
  useEffect(() => {
    onChange({ items: slideItems, blocked });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function loadCandidates() {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const j = await fetchJson<{ candidates: BfSaleCandidate[]; totalOnSite: number }>(
        `/api/admin/story-maker/goods?type=${target.type}&name=${encodeURIComponent(target.name)}&mode=sale`,
      );
      setCandidates(j.candidates);
      setTotal(j.totalOnSite);
      void loadAutoSuggestions(j.candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  /** 候補読込後に最大6件だけ公式楽天APIで照合。最新価格は下書きにのみ反映する。 */
  async function loadAutoSuggestions(loaded: BfSaleCandidate[]) {
    if (!target) return;
    setAutoLoading(true);
    setAutoItems({});
    setAutoRecommended([]);
    setAutoWarning(null);
    try {
      const { status, json } = await postBf<BfAutoResult>({ type: target.type, name: target.name }, BF_AUTO_API);
      if (status !== 200 || !Array.isArray(json.items)) throw new Error(json.error ?? `HTTP ${status}`);
      setAutoItems(Object.fromEntries(json.items.map((x) => [x.productId, x])));
      setAutoRecommended(json.recommendedIds);
      setAutoCheckedCount(json.checkedCount);
      setAutoWarning(json.warning);
      // 確認済みフラグ・通常価格・値引きの種類は自動設定しない。
      // 通信中に管理者が入力・編集した価格は上書きしない。
      const byId = new Map(loaded.map((x) => [x.productId, x]));
      setInputs((prev) => {
        const next = { ...prev };
        for (const item of json.items) {
          if (item.status !== 'available' || !byId.has(item.productId)) continue;
          const draft = currentPriceDraft(item.currentPrice);
          if (!draft || next[item.productId]?.salePrice) continue;
          const c = byId.get(item.productId)!;
          next[item.productId] = {
            ...EMPTY_VERIFICATION, ...next[item.productId],
            sourceUrl: next[item.productId]?.sourceUrl ?? c.pageUrl ?? '',
            checkedBy: next[item.productId]?.checkedBy ?? checker,
            salePrice: draft,
          };
        }
        return next;
      });
      // 上位おすすめを開く。すでに別の商品を編集中ならそのままにする。
      setOpenId((prev) => prev ?? json.recommendedIds[0] ?? null);
    } catch (err) {
      setAutoWarning(`自動照合できませんでした。手動で確認できます：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAutoLoading(false);
    }
  }

  const inputOf = (c: BfSaleCandidate): BfVerificationInput => inputs[c.productId] ?? { ...EMPTY_VERIFICATION, sourceUrl: c.pageUrl ?? '', checkedBy: checker };
  const setInput = (c: BfSaleCandidate, patch: Partial<BfVerificationInput>) => setInputs((prev) => ({ ...prev, [c.productId]: { ...inputOf(c), ...patch } }));

  /** 承認はサーバーで（サーバーの時刻で検証し、署名した承認を受け取る） */
  async function approve(c: BfSaleCandidate) {
    if (!target || approving) return;
    setApproving(c.productId);
    try {
      const { status, json } = await postBf<{ ok?: boolean; item?: BfApprovedItem; errors?: string[] }>({
        action: 'approve', type: target.type, name: target.name, productId: c.productId, input: inputOf(c),
      });
      syncClock(json.now);
      if (status !== 200 || !json.ok || !json.item) {
        setFormErrors((p) => ({ ...p, [c.productId]: json.errors ?? [json.error ?? `承認できませんでした（HTTP ${status}）。`] }));
        return;
      }
      const item = json.item;
      setFormErrors((p) => { const n = { ...p }; delete n[c.productId]; return n; });
      setApproved((p) => ({ ...p, [c.productId]: item }));
      setChecker(item.checkedBy);
      writeChecker(item.checkedBy);
      setOpenId(null);
      // 空きがあれば自動で「投稿に使う」に入れる（6件まで）
      setSelected((p) => (p.includes(c.productId) || p.length >= BF_MAX_ITEMS ? p : [...p, c.productId]));
    } catch (err) {
      setFormErrors((p) => ({ ...p, [c.productId]: [`サーバーで承認できませんでした：${err instanceof Error ? err.message : String(err)}`] }));
    } finally {
      setApproving(null);
    }
  }


  function revoke(id: string) {
    setApproved((p) => { const n = { ...p }; delete n[id]; return n; });
    setSelected((p) => p.filter((x) => x !== id));
  }

  function toggleUse(id: string, on: boolean) {
    setSelected((p) => (on ? (p.includes(id) || p.length >= BF_MAX_ITEMS ? p : [...p, id]) : p.filter((x) => x !== id)));
  }

  const maxRate = maxOffRate(usable);
  const approvedCount = Object.keys(approved).length;
  const candidateOrder = new Map(autoRecommended.map((id, i) => [id, i]));
  const displayedCandidates = candidates ? [...candidates].sort((a, b) =>
    (candidateOrder.get(a.productId) ?? Number.MAX_SAFE_INTEGER) - (candidateOrder.get(b.productId) ?? Number.MAX_SAFE_INTEGER),
  ) : [];

  return (
    <section className="rounded-xl border-2 border-amber-500 bg-stone-900 text-stone-100 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-amber-300">楽天BF：セール対象商品を選ぶ（確認・承認）</h2>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${phase === 'active' ? 'bg-amber-400 text-stone-900' : 'bg-stone-700 text-stone-300'}`}>
          {phase === 'active' ? '開催中' : phase === 'upcoming' ? '開催前' : '終了'}　{bfSalePeriodLabel()}
        </span>
      </div>
      <p className="text-xs text-stone-300 leading-relaxed">
        候補を読み込むと楽天公式APIで一部の商品を自動照合し、在庫があり価格を取得できたおすすめ商品を先に表示します。
        APIの現在価格は「セール価格」の<b className="text-amber-200">未確認の下書き</b>として入力します。
        <b className="text-amber-200">楽天BF対象か・通常価格・セール価格・適用条件</b>は商品ページで確認してから承認してください（API価格だけでBF対象と判断しません）。
        最大割引率は「投稿に使う」を選んだ承認済みの商品だけから計算します。
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void loadCandidates()} disabled={!target || loading} className="px-4 py-2 rounded-lg bg-amber-400 text-stone-900 font-black hover:bg-amber-300 disabled:opacity-40">
          {loading ? '読み込み中…' : candidates ? '候補を読み込み直す' : 'この推しの商品候補を読み込む'}
        </button>
        <label className="text-xs text-stone-300 flex items-center gap-1">確認者
          <input value={checker} onChange={(e) => setChecker(e.target.value)} placeholder="名前" maxLength={50} className="w-32 rounded px-2 py-1 text-sm text-stone-900" />
        </label>
        {!target && <span className="text-xs text-red-300">先に②で人物・グループを選んでください。</span>}
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}

      {candidates && (
        <>
          <div className="space-y-1 rounded-lg border border-amber-700 bg-stone-800/70 p-2 text-xs">
            {autoLoading ? <p className="text-amber-200">楽天公式APIで商品と現在価格を照合中…（最大6件・最大数秒）。商品は自動承認されません。</p> :
              <p className="text-amber-200">自動照合 {autoCheckedCount}件・おすすめ候補 {autoRecommended.length}件（上位に並べ替え済み・未承認）。{autoRecommended.length > 0 ? 'おすすめの確認欄を開きました。' : '価格を取得できない商品は従来どおり手動で確認できます。'}</p>}
            {autoWarning && <p className="text-orange-300">{autoWarning}</p>}
            <button type="button" onClick={() => void loadAutoSuggestions(candidates)} disabled={autoLoading || loading} className="underline text-amber-200 disabled:opacity-40">最新価格を再照合する</button>
          </div>
          <p className="text-xs text-stone-400">
            {target?.name} のページに公開中の関連商品 {total}件から {candidates.length}件（写真集・CD・Blu-ray・DVD・グッズを順番に）。
            承認済み {approvedCount}件・投稿に使う {usable.length}/{BF_MAX_ITEMS}件（3件まで3枚・4件以上で4枚）
            {maxRate !== null && <>・最大割引率 <b className="text-amber-300">{maxRate}%OFF</b></>}
          </p>
          <ul className="max-h-[560px] overflow-y-auto divide-y divide-stone-700 rounded-lg border border-stone-700 bg-stone-950">
            {displayedCandidates.map((c) => {
              const a = approved[c.productId];
              const api = autoItems[c.productId];
              const ok = a ? isApprovalUsable(a, now) : false;
              const inUse = selected.includes(c.productId);
              const inp = inputOf(c);
              const reg = parseYen(inp.regularPrice), sal = parseYen(inp.salePrice);
              const preview = reg !== null && sal !== null && sal < reg ? calcDiscount(reg, sal) : null;
              return (
                <li key={c.productId} className="p-3 text-sm">
                  <div className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.thumbUrl ? <img src={c.thumbUrl} alt="" className="w-14 h-14 object-contain bg-white rounded shrink-0" /> : <div className="w-14 h-14 bg-stone-700 rounded shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-amber-300 font-bold">{c.section}</div>
                      {autoRecommended.includes(c.productId) && <div className="text-[11px] font-bold text-emerald-300">★ 自動選定のおすすめ（楽天BF対象は未確認）</div>}
                      <div className="text-stone-100 line-clamp-2">{c.title}</div>
                      <div className="text-[11px] text-stone-400 mt-0.5">
                        {c.pageUrl ? <a href={c.pageUrl} target="_blank" rel="noopener noreferrer" className="underline text-amber-200">楽天の商品ページを開く</a> : '商品ページのURLが商品データにありません（確認元URLを入力）'}
                        {c.storedPrice !== null && <>　サイトに保存済みの価格 {formatYen(c.storedPrice)}（参考・取得日時不明のため使いません）</>}
                      </div>
                      {api && <div className="mt-1 text-[11px] text-cyan-200">
                        {api.status === 'available' && api.currentPrice !== null ? `楽天APIの現在価格 ${formatYen(api.currentPrice)}（未確認・BF価格とは限りません。商品ページで要確認）` :
                          api.status === 'out_of_stock' ? '楽天API：在庫ありと確認できません（おすすめから除外）' :
                          api.status === 'not_found' ? '楽天API：同一商品が見つかりません（手動確認）' : '楽天API：今回は取得できませんでした（手動確認）'}
                      </div>}
                      {a && (
                        <div className={`mt-1 text-xs ${ok ? 'text-emerald-300' : 'text-red-300'}`}>
                          {ok ? '✅ 承認済み' : '⚠ 承認の期限切れ（24時間経過またはセール終了）'}：{a.priceLabel} {formatYen(a.regularPrice)} → セール価格 {formatYen(a.salePrice)}（{formatYen(a.offAmount)} OFF・{a.offRate}%OFF）　適用条件：{a.conditions}　確認：{a.checkedBy} {new Date(a.checkedAt).toLocaleString('ja-JP')}　根拠：<a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">商品ページ</a>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0 text-xs">
                      {a && ok && (
                        <label className="flex items-center gap-1 font-bold text-amber-200">
                          <input type="checkbox" checked={inUse} disabled={!inUse && selected.length >= BF_MAX_ITEMS} onChange={(e) => toggleUse(c.productId, e.target.checked)} />投稿に使う
                        </label>
                      )}
                      <button type="button" onClick={() => setOpenId(openId === c.productId ? null : c.productId)} className="px-2 py-1 rounded border border-amber-400 text-amber-200 hover:bg-stone-800">
                        {a ? '確認し直す' : '確認・承認する'}
                      </button>
                      {a && <button type="button" onClick={() => revoke(c.productId)} className="text-stone-400 underline">承認を取り消す</button>}
                    </div>
                  </div>
                  {openId === c.productId && (
                    <div className="mt-3 rounded-lg bg-stone-800 p-3 space-y-2 text-xs">
                      <div className="grid sm:grid-cols-3 gap-2">
                        <label>商品ページでの価格の表記
                          <select value={inp.priceLabel} onChange={(e) => setInput(c, { priceLabel: e.target.value as BfPriceLabel })} className="mt-1 w-full rounded px-2 py-1 text-sm text-stone-900">
                            {BF_PRICE_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </label>
                        <label>{inp.priceLabel}（円）
                          <input inputMode="numeric" value={inp.regularPrice} onChange={(e) => setInput(c, { regularPrice: e.target.value })} placeholder="例 3300" className="mt-1 w-full rounded px-2 py-1 text-sm text-stone-900" />
                        </label>
                        <label>セール価格（円）
                          <input inputMode="numeric" value={inp.salePrice} onChange={(e) => setInput(c, { salePrice: e.target.value })} placeholder="例 2640" className="mt-1 w-full rounded px-2 py-1 text-sm text-stone-900" />
                        </label>
                      </div>
                      {api?.status === 'available' && api.currentPrice !== null && <p className="text-cyan-200">セール価格欄には楽天APIの現在価格 {formatYen(api.currentPrice)} を仮入力しています。通常価格・BF対象は取得できていません。楽天ページに記載の金額が異なる場合は必ず修正してください。</p>}
                      <div className="grid sm:grid-cols-2 gap-2">
                        <label>値引きの種類
                          <select value={inp.discountKind} onChange={(e) => setInput(c, { discountKind: e.target.value as BfDiscountKind | '' })} className="mt-1 w-full rounded px-2 py-1 text-sm text-stone-900">
                            <option value="">選んでください</option>
                            {BF_DISCOUNT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}{k.allowed ? '' : '（掲載不可）'}</option>)}
                          </select>
                        </label>
                        <label>適用条件{inp.discountKind === 'price-cut-conditional' ? '（必須）' : '（条件なしなら空欄）'}
                          <input value={inp.conditions} onChange={(e) => setInput(c, { conditions: e.target.value })} maxLength={BF_CONDITIONS_MAX} placeholder="例：先着500個限定・11/21 23:59まで" className="mt-1 w-full rounded px-2 py-1 text-sm text-stone-900" />
                        </label>
                      </div>
                      <label className="block">根拠URL（BFの対象表示と価格を確認した楽天の商品ページ）
                        <input value={inp.sourceUrl} onChange={(e) => setInput(c, { sourceUrl: e.target.value })} placeholder="https://item.rakuten.co.jp/…" className="mt-1 w-full rounded px-2 py-1 text-sm text-stone-900" />
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={inp.confirmed} onChange={(e) => setInput(c, { confirmed: e.target.checked })} className="mt-0.5" />
                        <span>この商品ページで、<b>楽天ブラックフライデーの対象であること</b>、上の<b>{inp.priceLabel}</b>・<b>セール価格</b>が表示されていること、<b>適用条件</b>を確認しました（ポイント倍率・買いまわり・クーポン・楽天カード等で購入者ごとに変わる金額は入れていません）。</span>
                      </label>
                      <label className="block">確認者
                        <input value={inp.checkedBy} onChange={(e) => setInput(c, { checkedBy: e.target.value })} maxLength={50} className="mt-1 w-40 rounded px-2 py-1 text-sm text-stone-900" />
                      </label>
                      <p className="text-stone-300">計算結果：{preview ? `${formatYen(preview.offAmount)} OFF・${preview.offRate}%OFF（小数点以下切り捨て）` : '2つの価格を入れると表示されます'}</p>
                      {formErrors[c.productId] && (
                        <ul className="list-disc pl-4 text-red-300">{formErrors[c.productId].map((e) => <li key={e}>{e}</li>)}</ul>
                      )}
                      <button type="button" onClick={() => void approve(c)} disabled={approving !== null} className="px-4 py-1.5 rounded-lg bg-amber-400 text-stone-900 font-black hover:bg-amber-300 disabled:opacity-50">{approving === c.productId ? 'サーバーで確認中…' : '承認する'}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className={`text-xs ${blocked ? 'text-amber-200' : 'text-emerald-300'}`}>{blocked ?? `投稿に使う商品 ${usable.length}件で画像を作れます。プレビューを確認して⑥から保存してください。`}</p>
    </section>
  );
}
