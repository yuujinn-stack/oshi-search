'use client';

// アフィリエイト広告管理 ＞ 推し活サービス タブ（グッズ制作・グッズ買取・ファッションレンタル）。
// VODアフィリエイト（AffiliateManager.tsx）とは別のデータ（oshikatsu_affiliate_*）を扱う。
// 広告タグは ASP が発行したものをそのまま保存する。保存前に checkAdTag（サーバー側でも同じ確認を行う）で
// 安全確認し、通らないタグは保存できない。タグを加工・修正する機能は意図的に持たない。

import { useMemo, useState } from 'react';
import type { OshikatsuAffiliateServiceWithCreatives, OshikatsuAffiliateCreative } from '@/lib/oshikatsu-affiliate/store';
import {
  CREATIVE_KINDS,
  OSHIKATSU_AFFILIATE_CATEGORIES,
  OSHIKATSU_AFFILIATE_PRESETS,
  OSHIKATSU_ASPS,
  OSHIKATSU_CATEGORY_PAGE_PATHS,
  OSHIKATSU_PAGE_SERVICE_KEYS,
  PARTNERSHIP_STATUSES,
  type CreativeKind,
  type PartnershipStatus,
} from '@/lib/oshikatsu-affiliate/constants';
import { checkAdTag } from '@/lib/oshikatsu-affiliate/ad-tag';
import { AD_STATUS_LABELS, getAdStatus, type AdStatus } from '@/lib/oshikatsu-affiliate/core';

type Service = OshikatsuAffiliateServiceWithCreatives;
type Creative = OshikatsuAffiliateCreative;

const API = '/api/admin/oshikatsu-affiliates';

const label = <T extends string>(list: { id: T; label?: string; name?: string }[], id: string) => {
  const hit = list.find((x) => x.id === id);
  return hit ? (hit.label ?? hit.name ?? id) : id;
};

const STATUS_BADGE: Record<PartnershipStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
  ended: 'bg-gray-200 text-gray-600',
};
const AD_BADGE: Record<AdStatus, string> = {
  live: 'bg-emerald-600 text-white',
  disabled: 'bg-gray-200 text-gray-600',
  not_approved: 'bg-amber-100 text-amber-800',
  no_creative: 'bg-amber-100 text-amber-800',
};

function fmt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `保存に失敗しました（${res.status}）`);
  return data as T;
}

function pageOf(s: { serviceKey: string; category: string }): string | null {
  const keys = OSHIKATSU_PAGE_SERVICE_KEYS[s.category as keyof typeof OSHIKATSU_PAGE_SERVICE_KEYS];
  const path = OSHIKATSU_CATEGORY_PAGE_PATHS[s.category as keyof typeof OSHIKATSU_CATEGORY_PAGE_PATHS];
  return keys?.includes(s.serviceKey) && path ? path : null;
}

// ─── 広告プレビュー ───────────────────────────────────────────────────────────
// 公開ページと同じくタグをそのまま表示する。スクリプトを実行しない sandbox の iframe に入れ、
// 透明な板で覆ってクリック（＝ASP側のクリック計測）を起こさない。
// 計測用画像は読み込まれるため、プレビューはボタンを押したときだけ表示する。
function AdPreview({ html }: { html: string }) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <button type="button" onClick={() => setShown(true)} className="text-xs font-semibold text-indigo-600 hover:underline">
        広告表示プレビューを開く
      </button>
    );
  }
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:8px;font:14px/1.6 sans-serif;color:#111}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  return (
    <div>
      <div className="relative inline-block max-w-full rounded-lg border border-dashed border-gray-300 bg-white">
        <iframe title="広告プレビュー" sandbox="" srcDoc={doc} className="block w-[340px] max-w-full h-[280px]" />
        <div className="absolute inset-0" aria-hidden="true" />
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        プレビューはクリックできません（誤クリックでASPのクリック数を増やさないため）。
        <button type="button" onClick={() => setShown(false)} className="ml-2 text-indigo-600 hover:underline">閉じる</button>
      </p>
    </div>
  );
}

function TagCheck({ aspId, html }: { aspId: string; html: string }) {
  const r = useMemo(() => checkAdTag(aspId, html), [aspId, html]);
  if (!html.trim()) return null;
  return r.ok ? (
    <p className="text-xs text-emerald-700">
      ✓ 安全確認OK（広告リンク {r.linkCount}件・画像 {r.imageCount}件・計測用1×1画像あり）。このまま改変せずに保存・表示します。
    </p>
  ) : (
    <ul className="text-xs text-red-600 list-disc pl-4">
      {r.errors.map((e) => <li key={e}>{e}</li>)}
    </ul>
  );
}

// ─── 広告素材フォーム（新規・編集共通） ─────────────────────────────────────────
function CreativeForm({
  aspId, initial, onSubmit, onCancel, submitLabel,
}: {
  aspId: string;
  initial?: Creative;
  onSubmit: (v: { name: string; kind: CreativeKind; adHtml: string; sortOrder: number }) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<CreativeKind>(initial?.kind ?? 'text');
  const [adHtml, setAdHtml] = useState(initial?.adHtml ?? '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = checkAdTag(aspId, adHtml).ok;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ name, kind, adHtml, sortOrder: Number(sortOrder) || 0 });
        } catch (err) {
          setError(String(err instanceof Error ? err.message : err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_100px]">
        <label className="text-xs font-semibold text-gray-600">素材名（管理用）
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100}
            placeholder="例: テキスト広告（通常広告）" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-gray-600">種類
          <select value={kind} onChange={(e) => setKind(e.target.value as CreativeKind)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {CREATIVE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">表示順
          <input type="number" min={0} max={999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="block text-xs font-semibold text-gray-600">ASPが発行した広告HTMLタグ（{label(OSHIKATSU_ASPS, aspId)}の「通常広告」タグを、そのまま全部貼り付け）
        <textarea value={adHtml} onChange={(e) => setAdHtml(e.target.value)} required rows={8} spellCheck={false}
          placeholder={'<a href="https://px.a8.net/svt/ejp?a8mat=..." rel="nofollow">...</a>\n<img border="0" width="1" height="1" src="https://www??.a8.net/0.gif?a8mat=..." alt="">'}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed" />
      </label>
      <TagCheck aspId={aspId} html={adHtml} />
      {ok && <AdPreview key={adHtml} html={adHtml} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !ok || !name.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {busy ? '保存中…' : submitLabel}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">キャンセル</button>}
      </div>
    </form>
  );
}

// ─── 案件フォーム（新規・編集共通） ─────────────────────────────────────────────
interface ServiceFormValue {
  serviceKey: string; serviceName: string; category: string; aspId: string;
  programId: string; officialUrl: string; partnershipStatus: PartnershipStatus; note: string;
}

function ServiceForm({
  initial, isNew, onSubmit, onCancel,
}: {
  initial: ServiceFormValue;
  isNew: boolean;
  onSubmit: (v: ServiceFormValue) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof ServiceFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setV({ ...v, [k]: e.target.value });
  };
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null); setSaved(false);
        try { await onSubmit(v); setSaved(true); }
        catch (err) { setError(String(err instanceof Error ? err.message : err)); }
        finally { setBusy(false); }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-gray-600">サービス名
          <input value={v.serviceName} onChange={set('serviceName')} required maxLength={100} className={input} />
        </label>
        <label className="text-xs font-semibold text-gray-600">サービスキー（公開ページとの結びつけ用・{isNew ? '登録後は変更不可' : '変更不可'}）
          <input value={v.serviceKey} onChange={set('serviceKey')} required disabled={!isNew} pattern="[a-z][a-z0-9_]{1,49}"
            placeholder="例: cherish_palette" className={`${input} font-mono disabled:bg-gray-100 disabled:text-gray-500`} />
        </label>
        <label className="text-xs font-semibold text-gray-600">ジャンル
          <select value={v.category} onChange={set('category')} className={input}>
            {OSHIKATSU_AFFILIATE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">ASP
          <select value={v.aspId} onChange={set('aspId')} className={input}>
            {OSHIKATSU_ASPS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">プログラムID（管理用・公開ページには出ません）
          <input value={v.programId} onChange={set('programId')} maxLength={100} placeholder="ASPの管理画面に表示されるID" className={`${input} font-mono`} />
        </label>
        <label className="text-xs font-semibold text-gray-600">提携状態
          <select value={v.partnershipStatus} onChange={set('partnershipStatus')} className={input}>
            {PARTNERSHIP_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600 sm:col-span-2">公式サイトURL（広告を出さないときの通常リンクは公開ページ側の設定を使います）
          <input type="url" value={v.officialUrl} onChange={set('officialUrl')} required className={input} />
        </label>
        <label className="text-xs font-semibold text-gray-600 sm:col-span-2">メモ（管理用・報酬条件などASP内部の情報はここだけに書く。公開ページには出ません）
          <textarea value={v.note} onChange={set('note')} rows={3} maxLength={2000} className={input} />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !isNew && <p className="text-sm text-emerald-700">保存しました</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {busy ? '保存中…' : isNew ? '案件を登録（広告は無効の状態で登録）' : '案件情報を保存'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">キャンセル</button>}
      </div>
    </form>
  );
}

// ─── 素材1件 ──────────────────────────────────────────────────────────────────
function CreativeRow({ creative, aspId, onChange, onDelete }: {
  creative: Creative; aspId: string;
  onChange: (c: Creative) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = checkAdTag(aspId, creative.adHtml).ok;

  const toggle = async () => {
    setBusy(true); setError(null);
    try { onChange(await call<Creative>(`${API}/creatives/${creative.id}`, 'PUT', { isActive: !creative.isActive })); }
    catch (err) { setError(String(err instanceof Error ? err.message : err)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try { await call(`${API}/creatives/${creative.id}`, 'DELETE'); onDelete(); }
    catch (err) { setError(String(err instanceof Error ? err.message : err)); setBusy(false); }
  };

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm text-slate-800">{creative.name}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{label(CREATIVE_KINDS, creative.kind)}</span>
        <span className="text-[11px] text-gray-400">表示順 {creative.sortOrder}</span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${creative.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>
          {creative.isActive ? '素材 有効' : '素材 無効'}
        </span>
        {!valid && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">安全確認NG（表示されません）</span>}
        <span className="text-[11px] text-gray-400">更新 {fmt(creative.updatedAt)}</span>
        <div className="ml-auto flex gap-2 text-xs">
          <button type="button" disabled={busy} onClick={toggle} className="text-indigo-600 hover:underline disabled:opacity-40">
            {creative.isActive ? '素材を無効にする' : '素材を有効にする'}
          </button>
          <button type="button" onClick={() => setEditing((x) => !x)} className="text-indigo-600 hover:underline">
            {editing ? '編集を閉じる' : 'タグを更新'}
          </button>
          {confirmDelete ? (
            <>
              <button type="button" disabled={busy} onClick={remove} className="font-bold text-red-600 hover:underline">本当に削除</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-gray-500 hover:underline">やめる</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-gray-400 hover:text-red-600">削除</button>
          )}
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {editing ? (
        <div className="mt-3">
          <CreativeForm
            aspId={aspId}
            initial={creative}
            submitLabel="この内容でタグを更新"
            onCancel={() => setEditing(false)}
            onSubmit={async (v) => {
              onChange(await call<Creative>(`${API}/creatives/${creative.id}`, 'PUT', v));
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[11px] text-gray-600">{creative.adHtml}</pre>
          {valid && <AdPreview html={creative.adHtml} />}
        </div>
      )}
    </li>
  );
}

// ─── 編集パネル ───────────────────────────────────────────────────────────────
function ServiceEditor({ service, onChange, onClose }: { service: Service; onChange: (s: Service) => void; onClose: () => void }) {
  const [adBusy, setAdBusy] = useState(false);
  const [adError, setAdError] = useState<string | null>(null);
  const [adding, setAdding] = useState(service.creatives.length === 0);
  const status = getAdStatus(service, service.creatives);
  const page = pageOf(service);

  const updateService = async (patch: Record<string, unknown>) => {
    const record = await call<Omit<Service, 'creatives'>>(`${API}/${service.id}`, 'PUT', patch);
    onChange({ ...service, ...record });
  };
  const toggleAd = async () => {
    setAdBusy(true); setAdError(null);
    try { await updateService({ isAdEnabled: !service.isAdEnabled }); }
    catch (err) { setAdError(String(err instanceof Error ? err.message : err)); }
    finally { setAdBusy(false); }
  };
  const replaceCreative = (c: Creative) =>
    onChange({ ...service, updatedAt: Date.now(), creatives: service.creatives.map((x) => (x.id === c.id ? c : x)) });

  return (
    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-800">{service.serviceName}</h3>
          <p className="text-xs text-gray-500">
            最終更新 {fmt(service.updatedAt)} ／ 掲載先：{page ? <a href={page} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{page} のサービス紹介カード</a> : '掲載ページ未作成（登録だけできます）'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">閉じる ✕</button>
      </div>

      {/* 広告掲載の有効・無効 */}
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-slate-700">広告掲載</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${AD_BADGE[status]}`}>{AD_STATUS_LABELS[status]}</span>
          <button type="button" disabled={adBusy} onClick={toggleAd}
            className={`ml-auto rounded-lg px-4 py-1.5 text-sm font-bold disabled:opacity-40 ${service.isAdEnabled ? 'bg-gray-200 text-gray-700' : 'bg-emerald-600 text-white'}`}>
            {adBusy ? '切り替え中…' : service.isAdEnabled ? '広告を無効にする' : '広告を有効にする'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          公開ページに広告タグが表示されるのは「提携状態が承認済み」「広告が有効」「有効な素材があり安全確認OK」のすべてを満たすときだけです。
          それ以外は公式サイトへの通常リンクのまま表示されます。切り替えると公開ページはすぐ再生成されます。
        </p>
        {adError && <p className="mt-1 text-xs text-red-600">{adError}</p>}
      </section>

      {/* 広告素材 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-700">広告素材（{service.creatives.length}件）</h4>
          {!adding && <button type="button" onClick={() => setAdding(true)} className="text-sm font-semibold text-indigo-600 hover:underline">＋ 広告タグを登録</button>}
        </div>
        <p className="text-xs text-gray-500">
          有効な素材が複数あるときは、表示順の小さいものを1つだけ表示します。タグは貼り付けたまま改変せずに表示します
          （リンクURLの抜き出し・文言や画像サイズの変更・計測用画像の削除はしません）。
        </p>
        {service.creatives.length > 0 && (
          <ul className="space-y-2">
            {service.creatives.map((c) => (
              <CreativeRow key={c.id} creative={c} aspId={service.aspId} onChange={replaceCreative}
                onDelete={() => onChange({ ...service, updatedAt: Date.now(), creatives: service.creatives.filter((x) => x.id !== c.id) })} />
            ))}
          </ul>
        )}
        {adding && (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <CreativeForm
              aspId={service.aspId}
              submitLabel="広告タグを登録"
              onCancel={service.creatives.length > 0 ? () => setAdding(false) : undefined}
              onSubmit={async (v) => {
                const c = await call<Creative>(`${API}/${service.id}/creatives`, 'POST', { ...v, isActive: true });
                onChange({ ...service, updatedAt: Date.now(), creatives: [...service.creatives, c] });
                setAdding(false);
              }}
            />
          </div>
        )}
      </section>

      {/* 案件情報 */}
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <h4 className="text-sm font-bold text-slate-700 mb-3">案件情報</h4>
        <ServiceForm
          isNew={false}
          initial={{
            serviceKey: service.serviceKey, serviceName: service.serviceName, category: service.category, aspId: service.aspId,
            programId: service.programId ?? '', officialUrl: service.officialUrl, partnershipStatus: service.partnershipStatus, note: service.note ?? '',
          }}
          onSubmit={async (v) => {
            const { serviceKey: _ignored, ...patch } = v;
            void _ignored;
            await updateService(patch);
          }}
        />
      </section>
    </div>
  );
}

// ─── 一覧 ─────────────────────────────────────────────────────────────────────
export default function OshikatsuAffiliateManager({ initialServices }: { initialServices: Service[] }) {
  const [services, setServices] = useState<Service[]>(initialServices);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  const missingPresets = OSHIKATSU_AFFILIATE_PRESETS.filter((p) => !services.some((s) => s.serviceKey === p.serviceKey));
  const open = services.find((s) => s.id === openId) ?? null;
  const replace = (s: Service) => setServices((list) => list.map((x) => (x.id === s.id ? s : x)));

  const registerPresets = async () => {
    setPresetBusy(true); setPresetError(null);
    try {
      const { created } = await call<{ created: Omit<Service, 'creatives'>[] }>(API, 'POST', { presets: true });
      setServices((list) => [...list, ...created.map((c) => ({ ...c, creatives: [] }))]);
    } catch (err) {
      setPresetError(String(err instanceof Error ? err.message : err));
    } finally {
      setPresetBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500 max-w-2xl">
        グッズ制作・グッズ買取・ファッションレンタルなど、推し活サービスのASP案件と広告タグを管理します。
        プログラムID・メモなどの管理情報は公開ページに表示されません。新しく登録した案件は、必ず広告無効の状態から始まります。
      </p>

      {missingPresets.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="text-amber-900">
            初期案件（{missingPresets.map((p) => p.serviceName).join('・')}）が未登録です。
            サービス名・ジャンル・ASP・公式URL・提携状態を入れた状態で登録します（プログラムIDは登録後に入力してください。広告は無効）。
          </p>
          <button type="button" disabled={presetBusy} onClick={registerPresets}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40">
            {presetBusy ? '登録中…' : '初期案件を登録'}
          </button>
          {presetError && <p className="mt-1 text-xs text-red-600">{presetError}</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">サービス名</th>
              <th className="px-3 py-2">ジャンル</th>
              <th className="px-3 py-2">ASP</th>
              <th className="px-3 py-2">提携状態</th>
              <th className="px-3 py-2">広告状態</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">案件はまだありません</td></tr>
            )}
            {services.map((s) => {
              const st = getAdStatus(s, s.creatives);
              return (
                <tr key={s.id} className={`border-t border-gray-100 ${s.id === openId ? 'bg-indigo-50/60' : ''}`}>
                  <td className="px-3 py-2 font-semibold text-slate-800">{s.serviceName}</td>
                  <td className="px-3 py-2 text-gray-600">{label(OSHIKATSU_AFFILIATE_CATEGORIES, s.category)}</td>
                  <td className="px-3 py-2 text-gray-600">{label(OSHIKATSU_ASPS, s.aspId)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[s.partnershipStatus] ?? ''}`}>
                      {label(PARTNERSHIP_STATUSES, s.partnershipStatus)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${AD_BADGE[st]}`}>{AD_STATUS_LABELS[st]}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => { setOpenId(s.id === openId ? null : s.id); setCreating(false); }}
                      className="rounded-lg border border-indigo-200 px-3 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
                      {s.id === openId ? '閉じる' : '管理する'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && <ServiceEditor key={open.id} service={open} onChange={replace} onClose={() => setOpenId(null)} />}

      {creating ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-base font-bold text-slate-800 mb-3">新規案件登録</h3>
          <ServiceForm
            isNew
            initial={{ serviceKey: '', serviceName: '', category: 'goods_making', aspId: 'a8', programId: '', officialUrl: '', partnershipStatus: 'pending', note: '' }}
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              const record = await call<Omit<Service, 'creatives'>>(API, 'POST', v);
              setServices((list) => [...list, { ...record, creatives: [] }]);
              setCreating(false);
              setOpenId(record.id);
            }}
          />
        </div>
      ) : (
        <button type="button" onClick={() => { setCreating(true); setOpenId(null); }}
          className="rounded-lg border border-dashed border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">
          ＋ 新規案件を登録
        </button>
      )}
    </div>
  );
}
