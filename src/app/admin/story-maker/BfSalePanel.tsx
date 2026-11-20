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
 */

import { useEffect, useMemo, useState } from 'react';
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
  verifyBfItem,
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

export default function BfSalePanel({ target, onChange }: { target: StoryTarget | null; onChange: (s: BfPanelState) => void }) {
  const [now, setNow] = useState(() => Date.now());
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

  useEffect(() => { setChecker(readChecker()); }, []);
  // 開催状態・承認の期限を見直す（開いたままでも30秒ごと）
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const inputOf = (c: BfSaleCandidate): BfVerificationInput => inputs[c.productId] ?? { ...EMPTY_VERIFICATION, sourceUrl: c.pageUrl ?? '', checkedBy: checker };
  const setInput = (c: BfSaleCandidate, patch: Partial<BfVerificationInput>) => setInputs((prev) => ({ ...prev, [c.productId]: { ...inputOf(c), ...patch } }));

  function approve(c: BfSaleCandidate) {
    const t = Date.now();
    setNow(t);
    const r = verifyBfItem(c, inputOf(c), t);
    if (!r.ok) { setFormErrors((p) => ({ ...p, [c.productId]: r.errors })); return; }
    setFormErrors((p) => { const n = { ...p }; delete n[c.productId]; return n; });
    setApproved((p) => ({ ...p, [c.productId]: r.item }));
    setChecker(r.item.checkedBy);
    writeChecker(r.item.checkedBy);
    setOpenId(null);
    // 空きがあれば自動で「投稿に使う」に入れる（6件まで）
    setSelected((p) => (p.includes(c.productId) || p.length >= BF_MAX_ITEMS ? p : [...p, c.productId]));
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

  return (
    <section className="rounded-xl border-2 border-amber-500 bg-stone-900 text-stone-100 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-amber-300">楽天BF：セール対象商品を選ぶ（確認・承認）</h2>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${phase === 'active' ? 'bg-amber-400 text-stone-900' : 'bg-stone-700 text-stone-300'}`}>
          {phase === 'active' ? '開催中' : phase === 'upcoming' ? '開催前' : '終了'}　{bfSalePeriodLabel()}
        </span>
      </div>
      <p className="text-xs text-stone-300 leading-relaxed">
        推しサーチの商品データには、楽天ブラックフライデーの対象かどうか・通常価格・セール価格がありません。
        候補の商品ページを開き、<b className="text-amber-200">BF の対象であること</b>と<b className="text-amber-200">2つの価格</b>を確認して入力・承認した商品だけが投稿に載ります（推測で価格・割引率を入れません）。
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
          <p className="text-xs text-stone-400">
            {target?.name} のページに公開中の関連商品 {total}件から {candidates.length}件（写真集・CD・Blu-ray・DVD・グッズを順番に）。
            承認済み {approvedCount}件・投稿に使う {usable.length}/{BF_MAX_ITEMS}件（3件まで3枚・4件以上で4枚）
            {maxRate !== null && <>・最大割引率 <b className="text-amber-300">{maxRate}%OFF</b></>}
          </p>
          <ul className="max-h-[560px] overflow-y-auto divide-y divide-stone-700 rounded-lg border border-stone-700 bg-stone-950">
            {candidates.map((c) => {
              const a = approved[c.productId];
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
                      <div className="text-stone-100 line-clamp-2">{c.title}</div>
                      <div className="text-[11px] text-stone-400 mt-0.5">
                        {c.pageUrl ? <a href={c.pageUrl} target="_blank" rel="noopener noreferrer" className="underline text-amber-200">楽天の商品ページを開く</a> : '商品ページのURLが商品データにありません（確認元URLを入力）'}
                        {c.storedPrice !== null && <>　サイトに保存済みの価格 {formatYen(c.storedPrice)}（参考・取得日時不明のため使いません）</>}
                      </div>
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
                      <button type="button" onClick={() => approve(c)} className="px-4 py-1.5 rounded-lg bg-amber-400 text-stone-900 font-black hover:bg-amber-300">承認する</button>
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
