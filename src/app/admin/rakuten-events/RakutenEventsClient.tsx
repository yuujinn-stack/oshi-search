'use client';

// 楽天イベント管理（/admin/rakuten-events）の画面。
// 左：イベント一覧（開催前・開催中・終了）／右：選んだイベントの「イベント情報」「商品の紐付け」「SNS投稿文」。
// 入力の検証・確認状態のルールはサーバー（/api/admin/rakuten-events）でも同じ関数（src/lib/rakuten-event/core.ts）で行う。
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import { copyTextWithFallback } from '@/lib/clipboard-utils';
import {
  BENEFIT_SCOPES, BENEFIT_SCOPE_LABEL, BENEFIT_SCOPE_SHORT, CHECK_STATUSES, CHECK_STATUS_LABEL, ENTRY_REQUIRED, ENTRY_REQUIRED_LABEL,
  EVENT_STATUS_LABEL, EVENT_TYPES, EVENT_TYPE_LABEL, INSTAGRAM_MAX, RECHECK_AFTER_MS, THREADS_MAX, VISIBILITIES, VISIBILITY_LABEL, X_MAX,
  eventStatus, formatJstAdmin, generatePosts, toJstDateTimeLocal, xWeightedLength,
  type CheckStatus, type EventStatus, type RakutenEvent, type RakutenEventProduct,
} from '@/lib/rakuten-event/core';
import type { EventWithCounts, ProductSearchRow } from '@/lib/rakuten-event/store';
import type { ItemCheckInfo } from '@/lib/rakuten-event/item-check';

const OPERATOR_KEY = 'rakuten-event-operator';
const API = '/api/admin/rakuten-events';
const STORAGE_CATEGORIES = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'];

type Notice = { ok: boolean; message: string } | null;
type Tab = 'info' | 'products' | 'posts';

const STATUS_BADGE: Record<EventStatus, string> = {
  upcoming: 'bg-sky-100 text-sky-800',
  active: 'bg-emerald-100 text-emerald-800',
  ended: 'bg-gray-200 text-gray-600',
};
const CHECK_BADGE: Record<CheckStatus, string> = {
  confirmed: 'bg-emerald-100 text-emerald-800',
  needs_check: 'bg-amber-100 text-amber-800',
  excluded: 'bg-gray-200 text-gray-600',
};
const inputCls = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';
const labelCls = 'block text-xs font-bold text-slate-600 mb-1';
const btn = 'px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-60';
const btnPrimary = `${btn} bg-slate-800 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-gray-50`;
const btnDanger = `${btn} border border-red-300 bg-white text-red-600 hover:bg-red-50`;

async function post<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { ok?: boolean; message?: string; code?: string }> {
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return (data ?? { ok: false, message: `通信に失敗しました（HTTP ${res.status}）` }) as T & { ok?: boolean; message?: string };
  } catch {
    return { ok: false, message: '通信に失敗しました' } as T & { ok?: boolean; message?: string };
  }
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <p role="status" className={`text-xs mt-2 ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>{notice.ok ? '✓ ' : '× '}{notice.message}</p>;
}

// ── 画面全体 ────────────────────────────────────────────────────────────────────

export default function RakutenEventsClient({ initialEvents, persons, groups }: { initialEvents: EventWithCounts[]; persons: PersonOption[]; groups: string[] }) {
  const router = useRouter();
  const [operator, setOperator] = useState('');
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(initialEvents[0]?.id ?? 'new');
  const [tab, setTab] = useState<Tab>('info');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try { setOperator(localStorage.getItem(OPERATOR_KEY) ?? ''); } catch { /* ignore */ }
    // 開催状態（開催中→終了）を開いたままでも切り替えるため、1分ごとに現在時刻を更新する
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const saveOperator = (v: string) => {
    setOperator(v);
    try { localStorage.setItem(OPERATOR_KEY, v); } catch { /* ignore */ }
  };

  const selected = typeof selectedId === 'number' ? initialEvents.find((e) => e.id === selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="rakuten-event-operator" className="font-bold text-slate-600">操作者名</label>
        <input id="rakuten-event-operator" value={operator} onChange={(e) => saveOperator(e.target.value)} maxLength={50} placeholder="例：たなはら"
          className="rounded-md border border-gray-300 px-2 py-1 text-sm w-40" />
        <span className="text-gray-400">登録・確認状態の変更に記録します（この端末に保存）</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* イベント一覧 */}
        <aside className="bg-white rounded-lg border border-gray-200">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
            <h2 className="text-sm font-bold text-slate-700">イベント一覧（{initialEvents.length}）</h2>
            <button type="button" className={btnPrimary} onClick={() => { setSelectedId('new'); setTab('info'); }}>＋ 新規登録</button>
          </div>
          {initialEvents.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">まだイベントがありません。「新規登録」から追加してください。</p>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
              {initialEvents.map((e) => {
                const st = eventStatus(e, now);
                const active = selectedId === e.id;
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => setSelectedId(e.id)}
                      className={`w-full text-left px-3 py-2.5 ${active ? 'bg-indigo-50' : 'hover:bg-gray-50'} ${st === 'ended' ? 'opacity-70' : ''}`}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_BADGE[st]}`}>{EVENT_STATUS_LABEL[st]}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${e.visibility === 'published' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-500'}`}>
                          {e.visibility === 'published' ? '公開' : '非公開'}
                        </span>
                        <span className="text-[10px] text-gray-400">{EVENT_TYPE_LABEL[e.eventType]}</span>
                      </div>
                      <div className="text-sm font-bold text-slate-800 mt-1 break-all">{e.name}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{formatJstAdmin(e.startsAt)} 〜 {formatJstAdmin(e.endsAt)}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        商品：確認済み {e.counts.confirmed}・要確認 {e.counts.needs_check}・対象外 {e.counts.excluded}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* 詳細 */}
        <section className="bg-white rounded-lg border border-gray-200 min-w-0">
          {selectedId === 'new' ? (
            <div className="p-4">
              <h2 className="text-base font-bold text-slate-700 mb-3">イベントの新規登録</h2>
              <EventForm key="new" event={null} operator={operator} now={now}
                onSaved={(id) => { if (id) setSelectedId(id); router.refresh(); }} />
            </div>
          ) : selected ? (
            <EventDetail key={selected.id} event={selected} tab={tab} setTab={setTab} operator={operator} now={now} persons={persons} groups={groups}
              onChanged={() => router.refresh()} onDeleted={() => { setSelectedId(null); router.refresh(); }} />
          ) : (
            <p className="p-4 text-sm text-gray-500">左の一覧からイベントを選んでください。</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ── 詳細（タブ） ─────────────────────────────────────────────────────────────────

function EventDetail({ event, tab, setTab, operator, now, persons, groups, onChanged, onDeleted }: {
  event: EventWithCounts; tab: Tab; setTab: (t: Tab) => void; operator: string; now: number;
  persons: PersonOption[]; groups: string[]; onChanged: () => void; onDeleted: () => void;
}) {
  const [links, setLinks] = useState<RakutenEventProduct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const st = eventStatus(event, now);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API}?eventId=${event.id}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; products?: RakutenEventProduct[]; message?: string } | null;
      if (data?.ok && data.products) { setLinks(data.products); setLoadError(null); } else setLoadError(data?.message ?? '紐付けた商品を読み取れませんでした');
    } catch {
      setLoadError('通信に失敗しました');
    }
  }, [event.id]);
  useEffect(() => { void reload(); }, [reload]);

  const tabs: [Tab, string][] = [['info', 'イベント情報'], ['products', `商品の紐付け（${links?.length ?? '…'}）`], ['posts', 'SNS投稿文']];
  return (
    <div>
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${STATUS_BADGE[st]}`}>{EVENT_STATUS_LABEL[st]}</span>
          <h2 className="text-base font-bold text-slate-800 break-all">{event.name}</h2>
        </div>
        <p className="text-xs text-gray-500 mt-1">{formatJstAdmin(event.startsAt)} 〜 {formatJstAdmin(event.endsAt)}（日本時間）</p>
        {st === 'ended' && <p className="text-xs text-gray-600 mt-1">このイベントは終了しました。SNS投稿文は作成できません。</p>}
        {st !== 'ended' && event.lastCheckedAt != null && now - event.lastCheckedAt > RECHECK_AFTER_MS && (
          <p className="text-xs text-amber-700 mt-1">最終確認（{formatJstAdmin(event.lastCheckedAt)}）から24時間以上経っています。公式情報を再確認してください。</p>
        )}
      </div>
      <div className="flex border-b border-gray-200 mt-3 px-2 overflow-x-auto" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-slate-800 text-slate-800 font-bold' : 'border-transparent text-gray-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'info' && <EventForm event={event} operator={operator} now={now} onSaved={onChanged} onDeleted={onDeleted} />}
        {tab === 'products' && (
          <div className="space-y-6">
            {loadError && <p className="text-sm text-red-600">{loadError}</p>}
            <LinkedProducts event={event} links={links} operator={operator} onChanged={() => { void reload(); onChanged(); }} />
            <ProductSearch event={event} persons={persons} groups={groups} onLinked={() => { void reload(); onChanged(); }} />
          </div>
        )}
        {tab === 'posts' && <PostGenerator event={event} links={links ?? []} persons={persons} now={now} />}
      </div>
    </div>
  );
}

// ── イベント情報の登録・編集 ─────────────────────────────────────────────────────

interface FormState {
  name: string; eventType: string; startsAt: string; endsAt: string; officialUrl: string; entryRequired: string; entryUrl: string;
  conditions: string; benefit: string; benefitConditions: string; lastCheckedAt: string; visibility: string; note: string;
}
function toForm(e: RakutenEvent | null): FormState {
  return {
    name: e?.name ?? '', eventType: e?.eventType ?? 'marathon',
    startsAt: e ? toJstDateTimeLocal(e.startsAt) : '', endsAt: e ? toJstDateTimeLocal(e.endsAt) : '',
    officialUrl: e?.officialUrl ?? '', entryRequired: e?.entryRequired ?? 'unknown', entryUrl: e?.entryUrl ?? '',
    conditions: e?.conditions ?? '', benefit: e?.benefit ?? '', benefitConditions: e?.benefitConditions ?? '',
    lastCheckedAt: e?.lastCheckedAt != null ? toJstDateTimeLocal(e.lastCheckedAt) : '', visibility: e?.visibility ?? 'hidden', note: e?.note ?? '',
  };
}

function EventForm({ event, operator, now, onSaved, onDeleted }: { event: RakutenEvent | null; operator: string; now: number; onSaved: (id?: number) => void; onDeleted?: () => void }) {
  const [f, setF] = useState<FormState>(() => toForm(event));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true); setNotice(null);
    const r = event
      ? await post({ action: 'update', id: event.id, expectedUpdatedAt: event.updatedAt, event: f, operator })
      : await post<{ id?: number }>({ action: 'create', event: f, operator });
    setBusy(false);
    setNotice({ ok: !!r.ok, message: r.message ?? '' });
    if (r.ok) onSaved((r as { id?: number }).id);
  }
  async function remove() {
    if (!event) return;
    if (!window.confirm(`「${event.name}」を削除します。紐付けた商品の確認状態も削除されます（商品データ自体は変わりません）。よろしいですか？`)) return;
    setBusy(true);
    const r = await post({ action: 'delete', id: event.id });
    setBusy(false);
    setNotice({ ok: !!r.ok, message: r.message ?? '' });
    if (r.ok) onDeleted?.();
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-name">イベント名 *</label>
          <input id="ev-name" className={inputCls} value={f.name} onChange={set('name')} maxLength={100} placeholder="例：楽天お買い物マラソン（11月）" required />
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-type">イベントの種類 *</label>
          <select id="ev-type" className={inputCls} value={f.eventType} onChange={set('eventType')}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-vis">公開・非公開</label>
          <select id="ev-vis" className={inputCls} value={f.visibility} onChange={set('visibility')}>
            {VISIBILITIES.map((v) => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">公開にするには公式情報URLと最終確認日時が必要です。一般公開ページには表示しません。</p>
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-start">開催開始日時（日本時間）*</label>
          <input id="ev-start" type="datetime-local" className={inputCls} value={f.startsAt} onChange={set('startsAt')} required />
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-end">開催終了日時（日本時間）*</label>
          <input id="ev-end" type="datetime-local" className={inputCls} value={f.endsAt} onChange={set('endsAt')} required />
          <p className="text-[11px] text-gray-400 mt-1">この日時になった時点で「終了」と表示します（例：01:59 まで → 01:59 を入力）。</p>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-url">公式情報URL（楽天の公式ページ）</label>
          <input id="ev-url" type="url" className={inputCls} value={f.officialUrl} onChange={set('officialUrl')} placeholder="https://event.rakuten.co.jp/..." />
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-entry">エントリーの必要性</label>
          <select id="ev-entry" className={inputCls} value={f.entryRequired} onChange={set('entryRequired')}>
            {ENTRY_REQUIRED.map((v) => <option key={v} value={v}>{ENTRY_REQUIRED_LABEL[v]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-entry-url">エントリーページのURL（任意）</label>
          <input id="ev-entry-url" type="url" className={inputCls} value={f.entryUrl} onChange={set('entryUrl')} placeholder="https://event.rakuten.co.jp/..." />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-cond">参加条件</label>
          <textarea id="ev-cond" className={inputCls} rows={2} value={f.conditions} onChange={set('conditions')} placeholder="例：エントリーのうえ、期間中に1,000円（税込）以上のショップで買いまわり" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-benefit">ポイント倍率・割引内容</label>
          <textarea id="ev-benefit" className={inputCls} rows={2} value={f.benefit} onChange={set('benefit')} placeholder="例：ショップ買いまわりでポイント最大10倍" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-bcond">特典の適用条件</label>
          <textarea id="ev-bcond" className={inputCls} rows={2} value={f.benefitConditions} onChange={set('benefitConditions')} placeholder="例：ポイント上限あり。楽天カード利用など購入者の条件で変わります" />
          <p className="text-[11px] text-gray-400 mt-1">「最安値」「値下げ」「買い時」などの表現は投稿文に入れません（含まれている項目は投稿文から外します）。</p>
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-checked">最終確認日時（日本時間）</label>
          <div className="flex gap-2">
            <input id="ev-checked" type="datetime-local" className={inputCls} value={f.lastCheckedAt} onChange={set('lastCheckedAt')} />
            <button type="button" className={btnGhost} onClick={() => setF((p) => ({ ...p, lastCheckedAt: toJstDateTimeLocal(now) }))}>今</button>
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-note">メモ</label>
          <input id="ev-note" className={inputCls} value={f.note} onChange={set('note')} maxLength={1000} />
        </div>
      </div>
      {event?.updatedBy && <p className="text-[11px] text-gray-400">最終更新：{event.updatedBy}（{formatJstAdmin(event.updatedAt)}）</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={btnPrimary} disabled={busy || !operator.trim()}>{busy ? '保存中…' : event ? '変更を保存' : '登録する'}</button>
        {!operator.trim() && <span className="text-xs text-amber-700">上の「操作者名」を入力してください</span>}
        {event && <button type="button" className={`${btnDanger} ml-auto`} onClick={remove} disabled={busy}>削除</button>}
      </div>
      <NoticeLine notice={notice} />
    </form>
  );
}

// ── 紐付けた商品と確認状態 ───────────────────────────────────────────────────────

function LinkedProducts({ event, links, operator, onChanged }: { event: RakutenEvent; links: RakutenEventProduct[] | null; operator: string; onChanged: () => void }) {
  const [filter, setFilter] = useState<CheckStatus | 'all'>('all');
  if (links == null) return <p className="text-sm text-gray-500">読み込み中…</p>;
  const shown = filter === 'all' ? links : links.filter((l) => l.checkStatus === filter);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h3 className="text-sm font-bold text-slate-700">紐付けた商品（{links.length}）</h3>
        <select className="ml-auto rounded-md border border-gray-300 px-2 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as CheckStatus | 'all')} aria-label="確認状態で絞り込み">
          <option value="all">すべて</option>
          {CHECK_STATUSES.map((s) => <option key={s} value={s}>{CHECK_STATUS_LABEL[s]}（{links.filter((l) => l.checkStatus === s).length}）</option>)}
        </select>
      </div>
      <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 space-y-0.5 mb-3">
        <p>・「確認済み」は、楽天の公式ページで特典を確認できた場合だけ（確認元URL・確認日時が必要）。商品限定のセールは、その商品の特典を公式で確認できたときだけ「商品単体」で確認済みにします。</p>
        <p>・楽天カードの利用・買いまわり数など、購入者の条件で変わる特典は「購入者条件」に分けます（投稿文で商品の特典としては書きません）。</p>
        <p>・APIで取得できなかった・該当がなかっただけでは「対象外」にしないでください（対象外は理由の入力が必要です）。</p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500">紐付けた商品はありません。下の「商品を探して紐付け」から追加してください。</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((l) => <LinkRow key={`${l.id}-${l.updatedAt}`} event={event} link={l} operator={operator} onChanged={onChanged} />)}
        </ul>
      )}
    </div>
  );
}

function LinkRow({ event, link, operator, onChanged }: { event: RakutenEvent; link: RakutenEventProduct; operator: string; onChanged: () => void }) {
  const [v, setV] = useState({
    checkStatus: link.checkStatus as string, benefitScope: link.benefitScope as string, benefitNote: link.benefitNote ?? '',
    sourceUrl: link.sourceUrl ?? '', checkedAt: link.checkedAt != null ? toJstDateTimeLocal(link.checkedAt) : '', note: link.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [api, setApi] = useState<{ info?: ItemCheckInfo; message?: string } | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true); setNotice(null);
    const r = await post({ action: 'update_link', eventId: event.id, linkId: link.id, link: v, operator });
    setBusy(false);
    setNotice({ ok: !!r.ok, message: r.message ?? '' });
    if (r.ok) onChanged();
  }
  async function unlink() {
    if (!window.confirm('この商品の紐付けを解除しますか？（商品データは変わりません）')) return;
    setBusy(true);
    const r = await post({ action: 'unlink', eventId: event.id, linkId: link.id });
    setBusy(false);
    if (r.ok) onChanged(); else setNotice({ ok: false, message: r.message ?? '' });
  }
  async function checkApi() {
    setBusy(true); setApi(null);
    const r = await post<{ info?: ItemCheckInfo }>({ action: 'check_item', eventId: event.id, linkId: link.id });
    setBusy(false);
    setApi(r.ok ? { info: r.info } : { message: r.message ?? '確認できませんでした' });
  }

  return (
    <li className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${CHECK_BADGE[link.checkStatus]}`}>{CHECK_STATUS_LABEL[link.checkStatus]}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{BENEFIT_SCOPE_SHORT[link.benefitScope]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-800 break-all">{link.productTitle ?? link.productId}</div>
          <div className="text-[11px] text-gray-500">{link.personName}／{link.category}／ID {link.productId}</div>
          {link.checkedBy && <div className="text-[11px] text-gray-400">確認：{link.checkedBy}{link.checkedAt != null ? `（${formatJstAdmin(link.checkedAt)}）` : ''}</div>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        <div>
          <label className={labelCls}>確認状態</label>
          <select className={inputCls} value={v.checkStatus} onChange={set('checkStatus')}>
            {CHECK_STATUSES.map((s) => <option key={s} value={s}>{CHECK_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>特典の範囲</label>
          <select className={inputCls} value={v.benefitScope} onChange={set('benefitScope')}>
            {BENEFIT_SCOPES.map((s) => <option key={s} value={s}>{BENEFIT_SCOPE_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>確認元URL（楽天の公式ページ）</label>
          <input type="url" className={inputCls} value={v.sourceUrl} onChange={set('sourceUrl')} placeholder="https://item.rakuten.co.jp/... / https://event.rakuten.co.jp/..." />
        </div>
        <div>
          <label className={labelCls}>確認日時（日本時間）</label>
          <div className="flex gap-2">
            <input type="datetime-local" className={inputCls} value={v.checkedAt} onChange={set('checkedAt')} />
            <button type="button" className={btnGhost} onClick={() => setV((p) => ({ ...p, checkedAt: toJstDateTimeLocal(Date.now()) }))}>今</button>
          </div>
        </div>
        <div>
          <label className={labelCls}>特典の内容（任意・200文字まで）</label>
          <input className={inputCls} value={v.benefitNote} onChange={set('benefitNote')} maxLength={200} placeholder="例：ポイント5倍" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>メモ（対象外の場合は理由）</label>
          <input className={inputCls} value={v.note} onChange={set('note')} maxLength={1000} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || !operator.trim()}>保存</button>
        <button type="button" className={btnGhost} onClick={checkApi} disabled={busy}>楽天APIで現在の情報を確認</button>
        <button type="button" className={`${btnDanger} ml-auto`} onClick={unlink} disabled={busy}>紐付け解除</button>
      </div>
      <NoticeLine notice={notice} />
      {api && <ApiResult api={api} />}
    </li>
  );
}

function ApiResult({ api }: { api: { info?: ItemCheckInfo; message?: string } }) {
  if (!api.info) return <p className="text-xs text-amber-700 mt-2">{api.message}</p>;
  const i = api.info;
  const rows: [string, string][] = [
    ['商品コード', i.itemCode],
    ['価格（API取得時点）', i.itemPrice != null ? `¥${i.itemPrice.toLocaleString()}` : '—'],
    ['在庫', i.availability === 1 ? 'あり' : i.availability === 0 ? 'なし' : '—'],
    ['商品別ポイント倍率', i.pointRate != null && i.pointRate > 1 ? `${i.pointRate}倍` : '倍付けの情報なし'],
    ['ポイントアップ期間', i.pointRateStartTime || i.pointRateEndTime ? `${i.pointRateStartTime ?? '—'} 〜 ${i.pointRateEndTime ?? '—'}` : '—'],
    ['タイムセール期間', i.saleStartTime || i.saleEndTime ? `${i.saleStartTime ?? '—'} 〜 ${i.saleEndTime ?? '—'}` : '設定なし'],
    ['ショップ', i.shopName ?? '—'],
  ];
  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, val]) => (<Fragment key={k}><dt className="text-gray-500">{k}</dt><dd className="text-slate-800 break-all">{val}</dd></Fragment>))}
      </dl>
      <p className="text-[11px] text-gray-500 mt-1">
        取得：{formatJstAdmin(i.fetchedAt)}。表示のみで保存していません（商品の価格・確認状態は変わりません）。
        商品別のポイント倍率だけの情報で、ショップ単位・購入者条件（買いまわり・楽天カード等）の特典は含みません。24時間以内に終わる倍付けはAPIに出ません。
      </p>
    </div>
  );
}

// ── 商品の検索・紐付け ─────────────────────────────────────────────────────────

function ProductSearch({ event, persons, groups, onLinked }: { event: RakutenEvent; persons: PersonOption[]; groups: string[]; onLinked: () => void }) {
  const [personName, setPersonName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [categories, setCategories] = useState<string[]>(['写真集', 'CD', 'Blu-ray・DVD', 'グッズ']);
  const [keyword, setKeyword] = useState('');
  const [includeUnpublished, setIncludeUnpublished] = useState(false);
  const [rows, setRows] = useState<ProductSearchRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const keyOf = (r: ProductSearchRow) => `${r.personName}\u0000${r.category}\u0000${r.productId}`;

  async function search() {
    setBusy(true); setNotice(null); setPicked(new Set());
    const r = await post<{ rows?: ProductSearchRow[]; truncated?: boolean }>({
      action: 'search', personName: personName || undefined, groupName: personName ? undefined : groupName || undefined,
      categories, keyword, includeUnpublished, eventId: event.id,
    });
    setBusy(false);
    if (r.ok) { setRows(r.rows ?? []); setTruncated(!!r.truncated); } else { setRows(null); setNotice({ ok: false, message: r.message ?? '' }); }
  }
  async function link() {
    const items = (rows ?? []).filter((r) => picked.has(keyOf(r))).map((r) => ({ personName: r.personName, category: r.category, productId: r.productId }));
    if (!items.length) return;
    setBusy(true);
    const r = await post({ action: 'link', eventId: event.id, items });
    setBusy(false);
    setNotice({ ok: !!r.ok, message: r.message ?? '' });
    if (r.ok) { onLinked(); void search(); }
  }
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const selectable = (rows ?? []).filter((r) => !r.linkedStatus);

  return (
    <div className="border-t border-gray-200 pt-4">
      <h3 className="text-sm font-bold text-slate-700 mb-2">商品を探して紐付け（推しサーチに登録済みの楽天商品）</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>人物</label>
          <PersonCombobox persons={persons} value={personName} onChange={(n) => { setPersonName(n); if (n) setGroupName(''); }} allowEmpty emptyLabel="（グループで探す）" placeholder="人物名で検索" />
        </div>
        <div>
          <label className={labelCls} htmlFor="ps-group">グループ（人物を選ばない場合）</label>
          <select id="ps-group" className={inputCls} value={groupName} onChange={(e) => { setGroupName(e.target.value); if (e.target.value) setPersonName(''); }}>
            <option value="">—</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <span className={labelCls}>商品カテゴリ</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {STORAGE_CATEGORIES.map((c) => (
              <label key={c} className="inline-flex items-center gap-1">
                <input type="checkbox" checked={categories.includes(c)} onChange={(e) => setCategories((p) => e.target.checked ? [...p, c] : p.filter((x) => x !== c))} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="ps-kw">商品名のキーワード（任意）</label>
          <input id="ps-kw" className={inputCls} value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={100}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
        </div>
        <div className="flex items-end gap-3">
          <label className="inline-flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={includeUnpublished} onChange={(e) => setIncludeUnpublished(e.target.checked)} />
            非掲載（判定が related 以外）の商品も表示
          </label>
          <button type="button" className={`${btnPrimary} ml-auto`} onClick={search} disabled={busy || (!personName && !groupName)}>{busy ? '検索中…' : '検索'}</button>
        </div>
      </div>
      <NoticeLine notice={notice} />
      {rows && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-slate-600">
            <span>{rows.length}件{truncated ? '（上限のため一部のみ。キーワード・カテゴリで絞り込んでください）' : ''}</span>
            <button type="button" className={btnGhost} onClick={() => setPicked(new Set(selectable.slice(0, 50).map(keyOf)))} disabled={!selectable.length}>未紐付けを選択（50件まで）</button>
            <button type="button" className={btnGhost} onClick={() => setPicked(new Set())} disabled={!picked.size}>選択を解除</button>
            <button type="button" className={`${btnPrimary} ml-auto`} onClick={link} disabled={busy || !picked.size || picked.size > 50}>選択した{picked.size}件を紐付け</button>
          </div>
          {rows.length === 0 ? <p className="text-sm text-gray-500">該当する商品がありません。</p> : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md max-h-[50vh] overflow-y-auto">
              {rows.map((r) => {
                const k = keyOf(r);
                return (
                  <li key={k} className="flex items-start gap-2 px-3 py-2">
                    <input type="checkbox" className="mt-1" checked={picked.has(k)} disabled={!!r.linkedStatus} onChange={() => toggle(k)} aria-label={`${r.title}を選択`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800 break-all">{r.title || r.productId}</div>
                      <div className="text-[11px] text-gray-500">
                        {r.personName}／{r.category}{r.shopName ? `／${r.shopName}` : ''}{r.itemCode ? '' : '／楽天市場の商品コードなし'}
                        {r.verdict !== 'related' && <span className="ml-1 text-amber-700">（非掲載：{r.verdict ?? '未判定'}）</span>}
                      </div>
                    </div>
                    {r.linkedStatus && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${CHECK_BADGE[r.linkedStatus]}`}>紐付け済み：{CHECK_STATUS_LABEL[r.linkedStatus]}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── SNS投稿文 ───────────────────────────────────────────────────────────────────

function PostGenerator({ event, links, persons, now }: { event: RakutenEvent; links: RakutenEventProduct[]; persons: PersonOption[]; now: number }) {
  const linkedPersons = useMemo(() => [...new Set(links.map((l) => l.personName))], [links]);
  const [personName, setPersonName] = useState(linkedPersons[0] ?? '');
  useEffect(() => { if (!personName && linkedPersons[0]) setPersonName(linkedPersons[0]); }, [linkedPersons, personName]);
  const posts = useMemo(() => (personName ? generatePosts({ event, personName, products: links, nowMs: now }) : null), [event, personName, links, now]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>投稿する人物</label>
          <PersonCombobox persons={persons} value={personName} onChange={setPersonName} placeholder="人物名で検索" />
          {linkedPersons.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {linkedPersons.map((n) => (
                <button key={n} type="button" onClick={() => setPersonName(n)} className={`text-[11px] px-2 py-0.5 rounded-full border ${n === personName ? 'bg-slate-800 text-white border-slate-800' : 'border-gray-300 text-slate-600 hover:bg-gray-50'}`}>{n}</button>
              ))}
            </div>
          )}
        </div>
        <div className="text-[11px] text-gray-500 space-y-0.5">
          <p>・投稿文は自動では投稿しません。内容を確認し、コピーして手動で投稿してください。</p>
          <p>・リンクは推しサーチの人物ページ（SNSごとの参照元付き）。GA4 の参照元別に、流入と楽天商品のクリック（affiliate_click）を比べられます。</p>
          <p>・価格・「最安値」などの表現は入れていません。商品の特典は「確認済み」で範囲が商品単体／ショップ単位のものだけ載せます。</p>
          <p>・画像は作りません。商品画像・写真集の表紙をSNS素材に使わないでください。</p>
        </div>
      </div>
      {!personName ? <p className="text-sm text-gray-500">人物を選ぶと投稿文を作成します。</p> : posts?.blocked ? (
        <p className="rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">{posts.blocked}</p>
      ) : posts && (
        <>
          {posts.warnings.length > 0 && (
            <ul className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 list-disc pl-6 space-y-0.5">
              {posts.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <PostBox title="X" text={posts.x} count={`${xWeightedLength(posts.x)} / ${X_MAX}`} over={xWeightedLength(posts.x) > X_MAX} />
            <PostBox title="Threads" text={posts.threads} count={`${posts.threads.length} / ${THREADS_MAX}`} over={posts.threads.length > THREADS_MAX} />
            <PostBox title="Instagram フィード" text={posts.instagramFeed} count={`${posts.instagramFeed.length} / ${INSTAGRAM_MAX}`} over={posts.instagramFeed.length > INSTAGRAM_MAX} />
            <PostBox title="Instagram ストーリーズ" text={posts.instagramStory} />
          </div>
        </>
      )}
    </div>
  );
}

function PostBox({ title, text, count, over }: { title: string; text: string; count?: string; over?: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  async function copy() {
    const ok = await copyTextWithFallback(text);
    setCopied(ok);
    setTimeout(() => setCopied(null), 2000);
  }
  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
        <h4 className="text-sm font-bold text-slate-700">{title}</h4>
        {count && <span className={`text-[11px] ${over ? 'text-red-600 font-bold' : 'text-gray-400'}`}>{count}</span>}
        <button type="button" onClick={copy} className={`${btnPrimary} ml-auto`}>{copied ? 'コピーしました' : copied === false ? 'コピーできません' : 'コピー'}</button>
      </div>
      <pre className="whitespace-pre-wrap break-all p-3 text-[13px] leading-relaxed text-slate-800 font-sans">{text}</pre>
    </div>
  );
}
