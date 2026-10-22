'use client';

// 価格の確認待ちの承認・却下（/admin/price-refresh）。確認ダイアログで変更前後の価格を見てから実行する。
// 承認・却下の可否と価格の再確認はサーバー側（/api/admin/price-review）で行う。
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PendingPriceReview } from '@/lib/price-review-store';

const OPERATOR_KEY = 'price-review-operator';

const BLOCKER_LABEL: Record<NonNullable<PendingPriceReview['blocker']>, string> = {
  item_missing: '商品が削除された（または同じIDが複数）ため承認できません',
  price_changed: '保存済みの価格が変わったため承認できません',
  identity_changed: '商品ページURL等が変わったため承認できません',
  not_related: '判定が related ではないため承認できません',
  expired: '取得から日数が経っているため承認できません（却下は可）',
};

const yen = (n: number | null) => (n == null ? '—' : n > 0 ? `¥${n.toLocaleString()}` : '—');

function fmt(ms: number): string {
  return new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function change(r: PendingPriceReview): string {
  if (!(r.previousPrice > 0)) return '前回の価格なし';
  const diff = r.fetchedPrice - r.previousPrice;
  const rate = r.changeRate ?? diff / r.previousPrice;
  return `${diff > 0 ? '+' : diff < 0 ? '−' : ''}¥${Math.abs(diff).toLocaleString()}（${rate > 0 ? '+' : ''}${(rate * 100).toFixed(1)}%）`;
}

const reasonLabel = (reason: string) => (reason === 'price_change_30pct' ? '前回の価格から30%以上の変動' : reason === 'no_previous_price' ? '前回の価格が無い' : reason);

type Pending = { review: PendingPriceReview; action: 'approve' | 'reject' };
type Notice = { ok: boolean; message: string };

/** 価格更新の結果（Redis）を確認待ち（DB）に取り込む（画面の表示では書き込まないため、ボタンで行う） */
export function PriceReviewSyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  async function sync() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/price-review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNotice({ ok: !!data?.ok, message: data?.message ?? `取り込みに失敗しました（HTTP ${res.status}）` });
    } catch {
      setNotice({ ok: false, message: '通信に失敗しました' });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={sync} disabled={busy} className="px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 text-xs font-bold hover:bg-gray-50 disabled:opacity-60">
        {busy ? '取り込み中…' : '取り込む'}
      </button>
      {notice && <span role="status" className={notice.ok ? 'text-emerald-700' : 'text-red-600'}>{notice.ok ? '✓ ' : '× '}{notice.message}</span>}
    </span>
  );
}

export function PriceReviewQueue({ rows }: { rows: PendingPriceReview[] }) {
  const router = useRouter();
  const [operator, setOperator] = useState('');
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    try { setOperator(localStorage.getItem(OPERATOR_KEY) ?? ''); } catch { /* 保存できない環境 */ }
  }, []);

  const operatorOk = operator.trim().length > 0 && operator.trim().length <= 50;

  async function submit() {
    if (!confirming || busy) return;
    setBusy(true);
    const { review, action } = confirming;
    try {
      try { localStorage.setItem(OPERATOR_KEY, operator.trim()); } catch { /* 保存できない環境 */ }
      const res = await fetch('/api/admin/price-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action, id: review.id, expectedPreviousPrice: review.previousPrice, expectedFetchedPrice: review.fetchedPrice, operator: operator.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setNotice({ ok: !!data?.ok, message: data?.message ?? `処理に失敗しました（HTTP ${res.status}）` });
    } catch {
      setNotice({ ok: false, message: '通信に失敗しました（何も変更されていない可能性があります。画面を再読み込みして確認してください）' });
    } finally {
      setBusy(false);
      setConfirming(null);
      router.refresh();
    }
  }

  const buttons = (r: PendingPriceReview) => (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={!!r.blocker || !operatorOk}
        onClick={() => { setNotice(null); setConfirming({ review: r, action: 'approve' }); }}
        className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        承認
      </button>
      <button
        type="button"
        disabled={!operatorOk}
        onClick={() => { setNotice(null); setConfirming({ review: r, action: 'reject' }); }}
        className="px-3 py-1.5 rounded-md border border-red-300 text-red-600 bg-white text-xs font-bold hover:bg-red-50 disabled:text-gray-300 disabled:border-gray-200 disabled:cursor-not-allowed"
      >
        却下
      </button>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <label htmlFor="price-review-operator" className="text-xs font-bold text-slate-700">操作者名（履歴に残ります）</label>
        <input
          id="price-review-operator"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          maxLength={50}
          placeholder="例：田中"
          className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full sm:w-48"
        />
        {!operatorOk && <span className="text-xs text-amber-700">入力すると承認・却下できます</span>}
      </div>

      {notice && (
        <div role="status" className={`mb-3 rounded-lg border p-3 text-sm ${notice.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
          {notice.ok ? '✓ ' : '× '}{notice.message}
        </div>
      )}

      {/* PC：表 */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-full text-xs bg-white border border-gray-200">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-1 text-left">人物</th>
              <th className="px-2 py-1 text-left">カテゴリ</th>
              <th className="px-2 py-1 text-left">商品</th>
              <th className="px-2 py-1 text-right">保存中の価格</th>
              <th className="px-2 py-1 text-right">取得した価格</th>
              <th className="px-2 py-1 text-right">変動</th>
              <th className="px-2 py-1 text-left">理由</th>
              <th className="px-2 py-1 text-left">取得日時</th>
              <th className="px-2 py-1 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top">
                <td className="px-2 py-1.5 whitespace-nowrap">{r.personName}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.category}</td>
                <td className="px-2 py-1.5 max-w-xs">
                  <div className="line-clamp-2">{r.itemTitle ?? '（商品名なし）'}</div>
                  <div className="font-mono text-[10px] text-gray-400 break-all">{r.itemId}</div>
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{yen(r.currentPrice)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap font-bold">{yen(r.fetchedPrice)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{change(r)}</td>
                <td className="px-2 py-1.5">{reasonLabel(r.reason)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.fetchedAtMs)}</td>
                <td className="px-2 py-1.5">
                  {buttons(r)}
                  {r.blocker && <p className="text-[10px] text-amber-700 mt-1 max-w-[12rem]">{BLOCKER_LABEL[r.blocker]}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* スマートフォン：カード */}
      <ul className="md:hidden space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500">{r.personName} ／ {r.category}</div>
            <div className="text-sm font-bold text-slate-800 mt-0.5 line-clamp-2">{r.itemTitle ?? '（商品名なし）'}</div>
            <div className="font-mono text-[10px] text-gray-400 break-all">{r.itemId}</div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div><div className="text-gray-500">保存中の価格</div><div className="font-bold">{yen(r.currentPrice)}</div></div>
              <div><div className="text-gray-500">取得した価格</div><div className="font-bold">{yen(r.fetchedPrice)}</div></div>
              <div><div className="text-gray-500">変動</div><div>{change(r)}</div></div>
              <div><div className="text-gray-500">取得日時</div><div>{fmt(r.fetchedAtMs)}</div></div>
            </div>
            <div className="text-xs text-gray-500 mt-1">理由：{reasonLabel(r.reason)}</div>
            {r.blocker && <p className="text-xs text-amber-700 mt-1">{BLOCKER_LABEL[r.blocker]}</p>}
            <div className="mt-3 flex justify-end">{buttons(r)}</div>
          </li>
        ))}
      </ul>

      {/* 確認ダイアログ */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="price-review-dialog-title">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-5">
            <h3 id="price-review-dialog-title" className={`text-base font-black ${confirming.action === 'approve' ? 'text-emerald-700' : 'text-red-600'}`}>
              {confirming.action === 'approve' ? 'この価格を承認して反映しますか？' : 'この価格の変更案を却下しますか？'}
            </h3>
            <p className="text-xs text-gray-500 mt-1">{confirming.review.personName} ／ {confirming.review.category}</p>
            <p className="text-sm text-slate-800 mt-1 line-clamp-3">{confirming.review.itemTitle ?? confirming.review.itemId}</p>
            <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">変更前（保存中）</span><span className="font-bold">{yen(confirming.review.previousPrice)}</span></div>
              <div className="flex justify-between mt-1"><span className="text-gray-500">変更後（取得した価格）</span><span className="font-bold">{yen(confirming.review.fetchedPrice)}</span></div>
              <div className="flex justify-between mt-1"><span className="text-gray-500">変動</span><span>{change(confirming.review)}</span></div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {confirming.action === 'approve'
                ? '商品の価格と価格の取得日時だけを更新します（商品名・URL・画像・判定・表示状態・並び順は変わりません）。保存済みの価格が変わっていた場合は更新しません。'
                : '保存済みの価格は変更しません。同じ価格の変更案は今後表示しません（取得した価格が変われば再び確認待ちになります）。'}
            </p>
            <p className="text-xs text-gray-500 mt-1">操作者：{operator.trim()}</p>
            <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} disabled={busy} className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 bg-white hover:bg-gray-50">
                キャンセル
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className={`px-4 py-2 rounded-md text-sm font-bold text-white disabled:opacity-60 ${confirming.action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {busy ? '処理中…' : confirming.action === 'approve' ? '承認して価格を更新する' : '却下する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
