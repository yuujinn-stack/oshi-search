'use client';

// 楽天イベント管理（/admin/rakuten-events）の画面。
// 左：イベント候補（5と0のつく日のカレンダー・不定期イベント）とイベント一覧。
// 右：選んだイベントを ①公式条件 → ②紹介候補（登録済み商品から抽出・複数選択・API確認・紐付け）→ ③特典の確認 → ④SNS投稿文 の順に操作する。
// 入力の検証・確認状態のルール・重複登録の判定はサーバー（/api/admin/rakuten-events）でも同じ関数で行う。
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import { copyTextWithFallback } from '@/lib/clipboard-utils';
import {
  BENEFIT_SCOPES, BENEFIT_SCOPE_LABEL, BENEFIT_SCOPE_SHORT, CHECK_STATUSES, CHECK_STATUS_LABEL, ENTRY_REQUIRED, ENTRY_REQUIRED_LABEL,
  EVENT_STATUS_LABEL, EVENT_TYPES, EVENT_TYPE_LABEL, INSTAGRAM_MAX, RECHECK_AFTER_MS, THREADS_MAX, VISIBILITIES, VISIBILITY_LABEL, X_MAX,
  eventStatus, formatJstAdmin, isOfficiallyConfirmed, isRakutenProductPageUrl, productPageUrlOf, toJstDateTimeLocal, xWeightedLength,
  type CheckStatus, type EventStatus, type ItemCheckInfo, type RakutenEvent,
} from '@/lib/rakuten-event/core';
import {
  PREVIEW_MARK, POST_PATTERNS, POST_PATTERN_LABEL, generatePosts, personPath, threadsLength, type PostPattern, type PostTarget,
} from '@/lib/rakuten-event/posts';
import { candidateRegistered, fiveZeroCandidates, irregularCandidates, type EventCandidate } from '@/lib/rakuten-event/candidates';
import { API_STATE_LABEL, PRIORITY_LABEL, candidatePriority, type ApiCheckState, type Priority } from '@/lib/rakuten-event/priority';
import type { EventProductRow, EventWithCounts, ProductSearchRow } from '@/lib/rakuten-event/store';
import { classifyProductDetailed } from '@/lib/product-curation';
import type { ProductCategory } from '@/types/person';

const DISPLAY_SECTIONS = ['写真集・書籍', 'CD', 'Blu-ray・DVD', 'グッズ', 'その他'] as const;
/** 公開ページと同じ表示分類（保存カテゴリと違うときは根拠も見せる） */
function displayOf(title: string | null | undefined, category: string, itemUrl: string | null | undefined) {
  return classifyProductDetailed(title ?? '', category as ProductCategory, itemUrl ?? '');
}
const STORED_AS_SECTION: Record<string, string> = { 写真集: '写真集・書籍', '本・雑誌': '写真集・書籍', CD: 'CD', 'Blu-ray・DVD': 'Blu-ray・DVD', グッズ: 'グッズ', 中古: '中古' };
/** 楽天APIで確認するときの手段（画面の表示用。実際のキーはサーバーが商品データから決める） */
function apiMeans(r: { itemCode: string | null; itemUrl: string | null; affiliateUrl?: string | null }): string {
  if (r.itemCode) return '楽天市場の商品コードあり';
  const page = productPageUrlOf(r.itemUrl) ?? productPageUrlOf(r.affiliateUrl ?? null) ?? '';
  return page.includes('books.rakuten.co.jp/rb/') ? '楽天ブックスの商品番号あり' : '商品コード・商品番号なし';
}

const OPERATOR_KEY = 'rakuten-event-operator';
const COPY_HISTORY_KEY = 'rakuten-event-copy-history';
const API = '/api/admin/rakuten-events';
const STORAGE_CATEGORIES = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'];
const LINK_CHUNK = 50;
const CHECK_CHUNK = 20;

type GroupInfo = Record<string, { path: string; members: string[] }>;
type LinkedRow = EventProductRow & { api?: ApiCheckState };
type SearchRow = ProductSearchRow & { api: ApiCheckState };
type Notice = { ok: boolean; message: string } | null;
type Tab = 'info' | 'candidates' | 'linked' | 'posts';

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
const PRIORITY_BADGE: Record<Priority['level'], string> = { high: 'bg-rose-100 text-rose-800', mid: 'bg-sky-100 text-sky-800', low: 'bg-gray-100 text-gray-500' };
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

function ConfirmBadge({ e }: { e: RakutenEvent }) {
  return isOfficiallyConfirmed(e)
    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">公式確認済み</span>
    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">未確認（開催候補）</span>;
}

// ── 画面全体 ────────────────────────────────────────────────────────────────────

export default function RakutenEventsClient({ initialEvents, persons, groups, groupInfo }: {
  initialEvents: EventWithCounts[]; persons: PersonOption[]; groups: string[]; groupInfo: GroupInfo;
}) {
  const router = useRouter();
  const [operator, setOperator] = useState('');
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(initialEvents[0]?.id ?? 'new');
  const [prefill, setPrefill] = useState<EventCandidate | null>(null);
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
  const startFromCandidate = (c: EventCandidate | null) => { setPrefill(c); setSelectedId('new'); setTab('info'); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="rakuten-event-operator" className="font-bold text-slate-600">操作者名</label>
        <input id="rakuten-event-operator" value={operator} onChange={(e) => saveOperator(e.target.value)} maxLength={50} placeholder="例：たなはら"
          className="rounded-md border border-gray-300 px-2 py-1 text-sm w-40" />
        <span className="text-gray-400">登録・確認状態の変更に記録します（この端末に保存）</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <EventCandidates events={initialEvents} now={now} onPick={startFromCandidate} onOpen={(id) => { setSelectedId(id); setTab('info'); }} />
          {/* イベント一覧 */}
          <aside className="bg-white rounded-lg border border-gray-200">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
              <h2 className="text-sm font-bold text-slate-700">登録済みのイベント（{initialEvents.length}）</h2>
              <button type="button" className={btnGhost} onClick={() => startFromCandidate(null)}>＋ 空欄から登録</button>
            </div>
            {initialEvents.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">まだイベントがありません。上の「イベント候補」から登録してください。</p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                {initialEvents.map((e) => {
                  const st = eventStatus(e, now);
                  const active = selectedId === e.id;
                  return (
                    <li key={e.id}>
                      <button type="button" onClick={() => setSelectedId(e.id)}
                        className={`w-full text-left px-3 py-2.5 ${active ? 'bg-indigo-50' : 'hover:bg-gray-50'} ${st === 'ended' ? 'opacity-70' : ''}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_BADGE[st]}`}>{EVENT_STATUS_LABEL[st]}</span>
                          <ConfirmBadge e={e} />
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${e.visibility === 'published' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-500'}`}>
                            {e.visibility === 'published' ? '公開' : '非公開'}
                          </span>
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
        </div>

        {/* 詳細 */}
        <section className="bg-white rounded-lg border border-gray-200 min-w-0">
          {selectedId === 'new' ? (
            <div className="p-4">
              <h2 className="text-base font-bold text-slate-700 mb-3">{prefill ? '候補からイベントを登録' : 'イベントの新規登録'}</h2>
              <EventForm key={prefill?.key ?? 'new'} event={null} prefill={prefill} operator={operator} now={now}
                onSaved={(id) => { if (id) { setSelectedId(id); setTab('candidates'); } setPrefill(null); router.refresh(); }} />
            </div>
          ) : selected ? (
            <EventDetail key={selected.id} event={selected} tab={tab} setTab={setTab} operator={operator} now={now} persons={persons} groups={groups} groupInfo={groupInfo}
              onChanged={() => router.refresh()} onDeleted={() => { setSelectedId(null); router.refresh(); }} />
          ) : (
            <p className="p-4 text-sm text-gray-500">左の一覧からイベントを選ぶか、イベント候補から登録してください。</p>
          )}
        </section>
      </div>
    </div>
  );
}

// ── イベント候補 ─────────────────────────────────────────────────────────────────

function EventCandidates({ events, now, onPick, onOpen }: { events: EventWithCounts[]; now: number; onPick: (c: EventCandidate) => void; onOpen: (id: number) => void }) {
  const jst = new Date(now + 9 * 3600_000);
  const [ym, setYm] = useState({ y: jst.getUTCFullYear(), m: jst.getUTCMonth() + 1 });
  const shift = (d: number) => setYm((p) => { const t = new Date(Date.UTC(p.y, p.m - 1 + d, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 }; });
  const five = fiveZeroCandidates(ym.y, ym.m);
  const irregular = irregularCandidates(ym.y, ym.m);
  return (
    <aside className="bg-white rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
        <h2 className="text-sm font-bold text-slate-700">イベント候補</h2>
        <div className="ml-auto flex items-center gap-1 text-xs">
          <button type="button" className={btnGhost} onClick={() => shift(-1)} aria-label="前の月">←</button>
          <span className="font-bold text-slate-700 w-20 text-center">{ym.y}年{ym.m}月</span>
          <button type="button" className={btnGhost} onClick={() => shift(1)} aria-label="次の月">→</button>
        </div>
      </div>
      <div className="p-3 space-y-3">
        <p className="text-[11px] text-gray-500">
          候補は「開催候補（公式未確認）」です。楽天にイベント日程のAPIは無いため自動取得はしていません。公式ページで開催・条件を確認してから登録・公開してください。
        </p>
        <div>
          <h3 className="text-xs font-bold text-slate-600 mb-1">5と0のつく日（毎月5・10・15・20・25・30日）</h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {five.map((c) => {
              const dup = candidateRegistered(events, c);
              const past = (Date.parse(`${c.endsAt}:00+09:00`) || 0) <= now;
              return (
                <li key={c.key}>
                  {dup ? (
                    <button type="button" onClick={() => onOpen(dup.id)} className="w-full text-left rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs">
                      <span className="font-bold text-emerald-800">{c.name.replace('5と0のつく日', '').replace(/[（）]/g, '')}</span>
                      <span className="block text-[10px] text-emerald-700">登録済み → 開く</span>
                    </button>
                  ) : (
                    <button type="button" onClick={() => onPick(c)} disabled={past} className="w-full text-left rounded-md border border-gray-300 px-2 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-40">
                      <span className="font-bold text-slate-700">{c.name.replace('5と0のつく日', '').replace(/[（）]/g, '')}</span>
                      <span className="block text-[10px] text-gray-500">{past ? '過去の日付' : '候補から登録'}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-bold text-slate-600 mb-1">不定期のイベント（日時は公式ページを見て入力）</h3>
          <ul className="space-y-1.5">
            {irregular.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <button type="button" onClick={() => onPick(c)} className={`${btnGhost} flex-1 text-left`}>{EVENT_TYPE_LABEL[c.eventType]}</button>
                {c.officialUrl
                  ? <a href={c.officialUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-600 hover:underline whitespace-nowrap">公式ページ ↗</a>
                  : <span className="text-[11px] text-gray-400 whitespace-nowrap">公式URL未確認</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}

// ── 詳細（ステップのタブ） ───────────────────────────────────────────────────────

function EventDetail({ event, tab, setTab, operator, now, persons, groups, groupInfo, onChanged, onDeleted }: {
  event: EventWithCounts; tab: Tab; setTab: (t: Tab) => void; operator: string; now: number;
  persons: PersonOption[]; groups: string[]; groupInfo: GroupInfo; onChanged: () => void; onDeleted: () => void;
}) {
  const [links, setLinks] = useState<LinkedRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const st = eventStatus(event, now);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API}?eventId=${event.id}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; products?: LinkedRow[]; message?: string } | null;
      if (data?.ok && data.products) { setLinks(data.products); setLoadError(null); } else setLoadError(data?.message ?? '紐付けた商品を読み取れませんでした');
    } catch {
      setLoadError('通信に失敗しました');
    }
  }, [event.id]);
  useEffect(() => { void reload(); }, [reload]);

  const tabs: [Tab, string][] = [
    ['info', '① 公式条件'],
    ['candidates', '② 紹介候補を選ぶ'],
    ['linked', `③ 特典の確認（${links?.length ?? '…'}）`],
    ['posts', '④ SNS投稿文'],
  ];
  return (
    <div>
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded ${STATUS_BADGE[st]}`}>{EVENT_STATUS_LABEL[st]}</span>
          <ConfirmBadge e={event} />
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
        {loadError && <p className="text-sm text-red-600 mb-3">{loadError}</p>}
        {tab === 'info' && <EventForm event={event} prefill={null} operator={operator} now={now} onSaved={onChanged} onDeleted={onDeleted} />}
        {tab === 'candidates' && (
          <ProductCandidates event={event} persons={persons} groups={groups} groupInfo={groupInfo} now={now}
            onLinked={() => { void reload(); onChanged(); }} onGoLinked={() => setTab('linked')} />
        )}
        {tab === 'linked' && <LinkedProducts event={event} links={links} operator={operator} now={now} onChanged={() => { void reload(); onChanged(); }} />}
        {tab === 'posts' && <PostGenerator event={event} links={links ?? []} persons={persons} groups={groups} groupInfo={groupInfo} now={now} />}
      </div>
    </div>
  );
}

// ── ① イベント情報の登録・編集 ───────────────────────────────────────────────────

interface FormState {
  name: string; eventType: string; startsAt: string; endsAt: string; officialUrl: string; entryRequired: string; entryUrl: string;
  conditions: string; benefit: string; benefitConditions: string; lastCheckedAt: string; visibility: string; note: string;
}
function toForm(e: RakutenEvent | null, c: EventCandidate | null): FormState {
  return {
    name: e?.name ?? c?.name ?? '', eventType: e?.eventType ?? c?.eventType ?? 'marathon',
    startsAt: e ? toJstDateTimeLocal(e.startsAt) : c?.startsAt ?? '', endsAt: e ? toJstDateTimeLocal(e.endsAt) : c?.endsAt ?? '',
    officialUrl: e?.officialUrl ?? c?.officialUrl ?? '', entryRequired: e?.entryRequired ?? 'unknown', entryUrl: e?.entryUrl ?? '',
    conditions: e?.conditions ?? '', benefit: e?.benefit ?? '', benefitConditions: e?.benefitConditions ?? '',
    lastCheckedAt: e?.lastCheckedAt != null ? toJstDateTimeLocal(e.lastCheckedAt) : '', visibility: e?.visibility ?? 'hidden', note: e?.note ?? '',
  };
}

function EventForm({ event, prefill, operator, now, onSaved, onDeleted }: {
  event: RakutenEvent | null; prefill: EventCandidate | null; operator: string; now: number; onSaved: (id?: number) => void; onDeleted?: () => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(event, prefill));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const confirmed = !!f.officialUrl.trim() && !!f.lastCheckedAt;

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
      {prefill && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{prefill.hint}</p>}
      {/* 公式確認 */}
      <div className={`rounded-md border p-3 text-xs ${confirmed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{confirmed ? '公式確認済み' : '未確認（開催候補）'}</span>
          {f.officialUrl && isUrl(f.officialUrl) && (
            <a href={f.officialUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">公式ページを開いて確認 ↗</a>
          )}
          <button type="button" className={`${btnGhost} ml-auto`} disabled={!f.officialUrl.trim()}
            onClick={() => setF((p) => ({ ...p, lastCheckedAt: toJstDateTimeLocal(now) }))}>
            公式ページで期間・条件を確認した（最終確認日時を今に）
          </button>
        </div>
        <p className="mt-1">開催期間・エントリー・倍率・条件は、公式ページで確認した内容を入力してください。確認するまで投稿文は「プレビュー」になり、公開用にはコピーできません。</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-name">イベント名 *</label>
          <input id="ev-name" className={inputCls} value={f.name} onChange={set('name')} maxLength={100} placeholder="例：楽天お買い物マラソン（11月）" required />
          <p className="text-[11px] text-gray-400 mt-1">投稿文の冒頭に入ります。X に収まるよう30文字程度までにしてください。</p>
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
          <textarea id="ev-cond" className={inputCls} rows={2} value={f.conditions} onChange={set('conditions')} placeholder="例：エントリーのうえ、楽天カードで支払い" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-benefit">ポイント倍率・割引内容（購入者の条件で変わる特典はその旨も）</label>
          <textarea id="ev-benefit" className={inputCls} rows={2} value={f.benefit} onChange={set('benefit')} placeholder="例：楽天カード利用でポイント4倍" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="ev-bcond">特典の適用条件</label>
          <textarea id="ev-bcond" className={inputCls} rows={2} value={f.benefitConditions} onChange={set('benefitConditions')} placeholder="例：獲得上限あり（公式ページ参照）" />
          <p className="text-[11px] text-gray-400 mt-1">「最安値」「値下げ」「絶対お得」などの表現は投稿文に入れません（含まれている項目は投稿文から外します）。</p>
        </div>
        <div>
          <label className={labelCls} htmlFor="ev-checked">最終確認日時（日本時間）</label>
          <input id="ev-checked" type="datetime-local" className={inputCls} value={f.lastCheckedAt} onChange={set('lastCheckedAt')} />
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

function isUrl(v: string): boolean {
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
}

// ── ② 紹介候補（登録済み商品から抽出） ─────────────────────────────────────────────

type SortKey = 'priority' | 'title' | 'person' | 'category';

function ProductCandidates({ event, persons, groups, groupInfo, now, onLinked, onGoLinked }: {
  event: RakutenEvent; persons: PersonOption[]; groups: string[]; groupInfo: GroupInfo; now: number; onLinked: () => void; onGoLinked: () => void;
}) {
  const [personName, setPersonName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [categories, setCategories] = useState<string[]>(['写真集', '本・雑誌', 'CD', 'Blu-ray・DVD', 'グッズ']);
  const [keyword, setKeyword] = useState('');
  const [includeUnpublished, setIncludeUnpublished] = useState(false);
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // 絞り込み・並べ替え（画面内だけ）
  const [fCat, setFCat] = useState('');
  const [fSection, setFSection] = useState('');
  const [fCode, setFCode] = useState<'' | 'yes' | 'no'>('');
  const [fApi, setFApi] = useState<'' | ApiCheckState['code']>('');
  const [fLink, setFLink] = useState<'' | 'unlinked' | 'linked'>('');
  const [fLevel, setFLevel] = useState<'' | Priority['level']>('');
  const [sort, setSort] = useState<SortKey>('priority');

  const groupOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [g, info] of Object.entries(groupInfo)) for (const n of info.members) m.set(n, [...(m.get(n) ?? []), g]);
    return m;
  }, [groupInfo]);
  const keyOf = (r: { personName: string; category: string; productId: string }) => `${r.personName}\u0000${r.category}\u0000${r.productId}`;

  async function search() {
    setBusy(true); setNotice(null); setPicked(new Set());
    const r = await post<{ rows?: SearchRow[]; truncated?: boolean }>({
      action: 'search', personName: personName || undefined, groupName: personName ? undefined : groupName || undefined,
      categories, keyword, includeUnpublished, eventId: event.id,
    });
    setBusy(false);
    if (r.ok) { setRows(r.rows ?? []); setTruncated(!!r.truncated); } else { setRows(null); setNotice({ ok: false, message: r.message ?? '' }); }
  }

  const enriched = useMemo(() => (rows ?? []).map((r) => ({
    r,
    disp: displayOf(r.title, r.category, r.itemUrl),
    pr: candidatePriority({ category: r.category, title: r.title, itemUrl: r.itemUrl, verdict: r.verdict, isUsed: r.isUsed, itemCode: r.itemCode, linkedStatus: r.linkedStatus, api: r.api }, now),
  })), [rows, now]);
  const shown = useMemo(() => {
    const list = enriched.filter(({ r, pr, disp }) =>
      (!fCat || r.category === fCat)
      && (!fSection || (fSection === '中古' ? r.category === '中古' || r.isUsed : r.category !== '中古' && disp.section === fSection))
      && (!fCode || (fCode === 'yes') === !!r.itemCode)
      && (!fApi || r.api.code === fApi)
      && (!fLink || (fLink === 'linked') === !!r.linkedStatus)
      && (!fLevel || pr.level === fLevel));
    const cmp: Record<SortKey, (a: typeof list[number], b: typeof list[number]) => number> = {
      priority: (a, b) => b.pr.score - a.pr.score || a.r.title.localeCompare(b.r.title, 'ja'),
      title: (a, b) => a.r.title.localeCompare(b.r.title, 'ja'),
      person: (a, b) => a.r.personName.localeCompare(b.r.personName, 'ja') || b.pr.score - a.pr.score,
      category: (a, b) => a.r.category.localeCompare(b.r.category, 'ja') || b.pr.score - a.pr.score,
    };
    return [...list].sort(cmp[sort]);
  }, [enriched, fCat, fSection, fCode, fApi, fLink, fLevel, sort]);

  const pickedRows = (rows ?? []).filter((r) => picked.has(keyOf(r)));
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const selectTop = (n: number) => setPicked(new Set(shown.filter(({ r }) => !r.linkedStatus).slice(0, n).map(({ r }) => keyOf(r))));

  async function checkApi() {
    const targets = pickedRows.filter((r) => r.api.code === 'unchecked').slice(0, CHECK_CHUNK);
    if (!targets.length) { setNotice({ ok: false, message: '楽天APIで未確認の商品（楽天市場の商品コードか楽天ブックスの商品番号がある商品）を選んでください' }); return; }
    setBusy(true); setNotice(null);
    const r = await post<{ results?: { personName: string; category: string; productId: string; result: { code: string; info?: ItemCheckInfo } }[] }>({
      action: 'check_items', items: targets.map((t) => ({ personName: t.personName, category: t.category, productId: t.productId })),
    });
    setBusy(false);
    setNotice({ ok: !!r.ok, message: r.message ?? '' });
    if (r.ok && r.results) {
      const m = new Map(r.results.map((x) => [keyOf(x), x.result]));
      setRows((prev) => (prev ?? []).map((row) => {
        const res = m.get(keyOf(row));
        if (!res) return row;
        const api: ApiCheckState = res.code === 'ok' && res.info ? { code: 'ok', info: res.info } : res.code === 'not_found' ? { code: 'not_found', fetchedAt: Date.now() } : row.api;
        return { ...row, api };
      }));
    }
  }

  async function link() {
    const items = pickedRows.filter((r) => !r.linkedStatus).map((r) => ({ personName: r.personName, category: r.category, productId: r.productId }));
    if (!items.length) return;
    setBusy(true); setNotice(null);
    let linked = 0, skipped = 0, failed: string | null = null;
    // 既存の上限（1回50件）に合わせて分けて送る。商品データ自体は変更しない
    for (let i = 0; i < items.length; i += LINK_CHUNK) {
      const r = await post<{ linked?: number; skipped?: number }>({ action: 'link', eventId: event.id, items: items.slice(i, i + LINK_CHUNK) });
      if (!r.ok) { failed = r.message ?? '紐付けに失敗しました'; break; }
      linked += r.linked ?? 0; skipped += r.skipped ?? 0;
    }
    setBusy(false);
    setNotice(failed ? { ok: false, message: `${linked}件を紐付けた後に失敗しました：${failed}` } : { ok: true, message: `${linked}件を「要確認」で紐付けました${skipped ? `（${skipped}件は紐付け済み等で追加なし）` : ''}。③で特典を確認してください` });
    onLinked();
    void search();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 space-y-0.5">
        <p>・ここは「紹介候補」を探す画面です。優先度は確認する順番の目安で、イベントの特典対象かどうかは判断していません（特典の確認は③）。</p>
        <p>・商品コードの無い商品（楽天ブックスの商品など）も候補に残します。APIで確認できないだけで、対象外ではありません。</p>
        <p>・楽天APIは選んだ商品だけを確認します（1回20件まで・24時間は結果を再利用）。商品データ（価格など）は変更しません。</p>
      </div>
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
            非掲載（判定が related 以外）も表示
          </label>
          <button type="button" className={`${btnPrimary} ml-auto`} onClick={search} disabled={busy || (!personName && !groupName)}>{busy ? '処理中…' : '候補を抽出'}</button>
        </div>
      </div>
      <NoticeLine notice={notice} />

      {rows && (
        <div className="space-y-2">
          {/* 絞り込み・並べ替え */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select className="rounded-md border border-gray-300 px-2 py-1" value={fSection} onChange={(e) => setFSection(e.target.value)} aria-label="表示カテゴリ">
              <option value="">表示カテゴリ：すべて</option>
              {[...DISPLAY_SECTIONS, '中古'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="rounded-md border border-gray-300 px-2 py-1" value={fCat} onChange={(e) => setFCat(e.target.value)} aria-label="保存カテゴリ">
              <option value="">保存カテゴリ：すべて</option>
              {STORAGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="rounded-md border border-gray-300 px-2 py-1" value={fCode} onChange={(e) => setFCode(e.target.value as typeof fCode)} aria-label="楽天市場の商品コード">
              <option value="">楽天市場の商品コード：すべて</option><option value="yes">あり</option><option value="no">なし</option>
            </select>
            <select className="rounded-md border border-gray-300 px-2 py-1" value={fApi} onChange={(e) => setFApi(e.target.value as typeof fApi)} aria-label="API確認">
              <option value="">API確認：すべて</option>
              {(Object.keys(API_STATE_LABEL) as ApiCheckState['code'][]).map((k) => <option key={k} value={k}>{API_STATE_LABEL[k]}</option>)}
            </select>
            <select className="rounded-md border border-gray-300 px-2 py-1" value={fLink} onChange={(e) => setFLink(e.target.value as typeof fLink)} aria-label="紐付け">
              <option value="">紐付け：すべて</option><option value="unlinked">未紐付け</option><option value="linked">紐付け済み</option>
            </select>
            <select className="rounded-md border border-gray-300 px-2 py-1" value={fLevel} onChange={(e) => setFLevel(e.target.value as typeof fLevel)} aria-label="優先度">
              <option value="">優先度：すべて</option><option value="high">高</option><option value="mid">中</option><option value="low">低</option>
            </select>
            <select className="rounded-md border border-gray-300 px-2 py-1" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="並べ替え">
              <option value="priority">優先度の高い順</option><option value="title">商品名順</option><option value="person">人物順</option><option value="category">カテゴリ順</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>{shown.length} / {rows.length}件{truncated ? '（上限500件のため一部のみ。カテゴリ・キーワードで絞り込んでください）' : ''}</span>
            <span className="font-bold text-slate-800">選択中 {picked.size}件</span>
            <button type="button" className={btnGhost} onClick={() => selectTop(20)} disabled={!shown.length}>表示中の上位20件を選択</button>
            <button type="button" className={btnGhost} onClick={() => selectTop(50)} disabled={!shown.length}>上位50件を選択</button>
            <button type="button" className={btnGhost} onClick={() => setPicked(new Set())} disabled={!picked.size}>選択を解除</button>
            <span className="ml-auto flex flex-wrap gap-2">
              <button type="button" className={btnGhost} onClick={checkApi} disabled={busy || !pickedRows.some((r) => r.api.code === 'unchecked')}>
                選んだ商品を楽天APIで確認（{Math.min(CHECK_CHUNK, pickedRows.filter((r) => r.api.code === 'unchecked').length)}件）
              </button>
              <button type="button" className={btnPrimary} onClick={link} disabled={busy || !pickedRows.some((r) => !r.linkedStatus)}>
                選んだ{pickedRows.filter((r) => !r.linkedStatus).length}件をイベントに紐付け
              </button>
              <button type="button" className={btnGhost} onClick={onGoLinked}>③ 特典の確認へ →</button>
            </span>
          </div>
          {shown.length === 0 ? <p className="text-sm text-gray-500">該当する商品がありません。</p> : (
            <div className="border border-gray-200 rounded-md max-h-[60vh] overflow-auto">
              <table className="w-full text-xs min-w-[860px]">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr>
                    <th className="p-2 w-8"><span className="sr-only">選択</span></th>
                    <th className="p-2 text-left">優先度・理由</th>
                    <th className="p-2 text-left">商品名</th>
                    <th className="p-2 text-left">人物・グループ</th>
                    <th className="p-2 text-left">表示カテゴリ（保存カテゴリ）</th>
                    <th className="p-2 text-left">楽天APIでの確認</th>
                    <th className="p-2 text-left">特典の確認（紐付け）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.map(({ r, pr, disp }) => {
                    const k = keyOf(r);
                    return (
                      <tr key={k} className={picked.has(k) ? 'bg-indigo-50' : ''}>
                        <td className="p-2 align-top">
                          <input type="checkbox" checked={picked.has(k)} disabled={!!r.linkedStatus} onChange={() => toggle(k)} aria-label={`${r.title}を選択`} />
                        </td>
                        <td className="p-2 align-top w-56">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_BADGE[pr.level]}`}>{PRIORITY_LABEL[pr.level]}（{pr.score}）</span>
                          <ul className="mt-1 text-[10px] text-gray-500 space-y-0.5">{pr.reasons.map((x) => <li key={x}>・{x}</li>)}</ul>
                        </td>
                        <td className="p-2 align-top text-slate-800 break-all">
                          {productPageUrlOf(r.itemUrl) ? <a href={productPageUrlOf(r.itemUrl)!} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.title || r.productId}</a> : (r.title || r.productId)}
                          {r.shopName && <div className="text-[10px] text-gray-400">{r.shopName}</div>}
                        </td>
                        <td className="p-2 align-top">{r.personName}<div className="text-[10px] text-gray-400">{(groupOf.get(r.personName) ?? []).join('・')}</div></td>
                        <td className="p-2 align-top">
                          <SectionCell section={r.category === '中古' || r.isUsed ? '中古' : disp.section} stored={r.category} basis={disp.basis} reason={disp.reason} needsReview={disp.needsReview} />
                          {r.verdict !== 'related' && <div className="text-[10px] text-amber-700">非掲載（{r.verdict ?? '未判定'}）</div>}
                        </td>
                        <td className="p-2 align-top">
                          <div>{apiMeans(r)}</div>
                          <div className="text-[10px] text-gray-500">{API_STATE_LABEL[r.api.code]}</div>
                          {r.api.code === 'ok' && <ApiSummary info={r.api.info} />}
                        </td>
                        <td className="p-2 align-top">
                          {r.linkedStatus ? (
                            <>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${CHECK_BADGE[r.linkedStatus]}`}>{CHECK_STATUS_LABEL[r.linkedStatus]}</span>
                              {r.linkedScope && <div className="text-[10px] text-gray-500 mt-0.5">{BENEFIT_SCOPE_SHORT[r.linkedScope as keyof typeof BENEFIT_SCOPE_SHORT] ?? r.linkedScope}</div>}
                              {r.linkedSourceUrl && <a href={r.linkedSourceUrl} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-indigo-600 break-all hover:underline">確認元 ↗</a>}
                              {r.linkedCheckedAt != null && <div className="text-[10px] text-gray-400">{formatJstAdmin(r.linkedCheckedAt)}</div>}
                            </>
                          ) : <span className="text-[10px] text-gray-400">未紐付け</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 表示カテゴリと、保存カテゴリ・根拠（商品名から変えた場合・要確認の場合に見せる） */
function SectionCell({ section, stored, basis, reason, needsReview }: { section: string; stored: string; basis: string; reason: string; needsReview: boolean }) {
  const changed = section !== (STORED_AS_SECTION[stored] ?? stored);
  return (
    <div>
      <span className={`font-bold ${needsReview ? 'text-amber-700' : 'text-slate-700'}`}>{needsReview ? '要確認' : section}</span>
      {(changed || needsReview) && (
        <div className="text-[10px] text-gray-500">保存：{stored}／{basis === 'title' ? '商品名から判定' : basis === 'product_number' ? '商品番号の根拠' : basis === 'none' ? '判定できず' : '保存カテゴリ'}：{reason}</div>
      )}
      {!changed && !needsReview && <div className="text-[10px] text-gray-400">保存：{stored}</div>}
    </div>
  );
}

function ApiSummary({ info }: { info: ItemCheckInfo }) {
  if (info.source === 'books') {
    return (
      <div className="text-[10px] text-slate-600 mt-0.5 space-y-0.5">
        <div>楽天ブックス：{info.availability === 1 ? '購入可' : '購入できない（品切れ等）'}{info.itemPrice != null ? `／${info.itemPrice.toLocaleString()}円` : ''}</div>
        <div className="text-gray-400">ポイント倍率は API に無い／{formatJstAdmin(info.fetchedAt)}取得</div>
      </div>
    );
  }
  return (
    <div className="text-[10px] text-slate-600 mt-0.5 space-y-0.5">
      <div>在庫：{info.availability === 1 ? 'あり' : info.availability === 0 ? 'なし' : '—'}{info.itemPrice != null ? `／${info.itemPrice.toLocaleString()}円` : ''}</div>
      <div>商品別倍率：{info.pointRate != null && info.pointRate > 1 ? `${info.pointRate}倍${info.pointRateEndTime ? `（〜${info.pointRateEndTime}）` : ''}` : 'なし'}</div>
      {(info.saleStartTime || info.saleEndTime) && <div>タイムセール：{info.saleStartTime ?? '—'}〜{info.saleEndTime ?? '—'}</div>}
      <div className="text-gray-400">{formatJstAdmin(info.fetchedAt)}取得</div>
    </div>
  );
}

// ── ③ 紐付けた商品と特典の確認 ───────────────────────────────────────────────────

function LinkedProducts({ event, links, operator, now, onChanged }: { event: RakutenEvent; links: LinkedRow[] | null; operator: string; now: number; onChanged: () => void }) {
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
        <p><b>A 商品単体</b>：商品限定の値下げ・ポイントアップ。その商品の楽天の商品ページで確認できた場合だけ「確認済み」にできます（お得速報型に使えます）。</p>
        <p><b>B ショップ単位</b>／<b>C 購入者条件</b>（楽天カード・買いまわり等）：投稿文で商品単体の割引としては書きません。</p>
        <p><b>D 未確認</b>：「要確認」のままにします。APIで取得できなかっただけでは「対象外」にしないでください（対象外は理由の入力が必要）。</p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500">紐付けた商品はありません。②で紹介候補を選んで紐付けてください。</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((l) => <LinkRow key={`${l.id}-${l.updatedAt}`} event={event} link={l} operator={operator} now={now} onChanged={onChanged} />)}
        </ul>
      )}
    </div>
  );
}

function LinkRow({ event, link, operator, now, onChanged }: { event: RakutenEvent; link: LinkedRow; operator: string; now: number; onChanged: () => void }) {
  const [v, setV] = useState({
    checkStatus: link.checkStatus as string, benefitScope: link.benefitScope as string, benefitNote: link.benefitNote ?? '',
    sourceUrl: link.sourceUrl ?? '', checkedAt: link.checkedAt != null ? toJstDateTimeLocal(link.checkedAt) : '', note: link.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [api, setApi] = useState<{ info?: ItemCheckInfo; message?: string } | null>(link.api?.code === 'ok' ? { info: link.api.info } : null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  // 管理画面の確認用リンク・確認元は、アフィリエイトの計測リンクではなく商品ページ（クリックを計測させない）
  const pageUrl = productPageUrlOf(link.itemUrl);
  const disp = displayOf(link.productTitle, link.category, link.itemUrl);
  const itemScopeNeedsProductUrl = v.checkStatus === 'confirmed' && v.benefitScope === 'item' && !!v.sourceUrl && !isRakutenProductPageUrl(v.sourceUrl);

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
          <div className="text-sm font-bold text-slate-800 break-all">
            {pageUrl ? <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{link.productTitle ?? link.productId} ↗</a> : (link.productTitle ?? link.productId)}
          </div>
          <div className="text-[11px] text-gray-500">{link.personName}／ID {link.productId}／{apiMeans(link)}</div>
          <div className="text-[11px]"><SectionCell section={link.category === '中古' ? '中古' : disp.section} stored={link.category} basis={disp.basis} reason={disp.reason} needsReview={link.category !== '中古' && disp.needsReview} /></div>
          {link.missing && <div className="text-[11px] text-red-600">商品データに見つかりません（削除・ID変更の可能性）</div>}
          {link.verdict && link.verdict !== 'related' && <div className="text-[11px] text-amber-700">サイトに非掲載（{link.verdict}）</div>}
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
          <label className={labelCls}>確認元URL（楽天の公式ページ。商品単体の特典は商品ページ）</label>
          <div className="flex gap-2">
            <input type="url" className={inputCls} value={v.sourceUrl} onChange={set('sourceUrl')} placeholder="https://item.rakuten.co.jp/... / https://event.rakuten.co.jp/..." />
            {pageUrl && (
              <button type="button" className={`${btnGhost} whitespace-nowrap`} onClick={() => setV((p) => ({ ...p, sourceUrl: pageUrl }))}>商品ページURLを入れる</button>
            )}
          </div>
          {itemScopeNeedsProductUrl && <p className="text-[11px] text-amber-700 mt-1">商品単体の特典の確認元は、その商品の楽天の商品ページにしてください。</p>}
        </div>
        <div>
          <label className={labelCls}>確認日時（日本時間）</label>
          <div className="flex gap-2">
            <input type="datetime-local" className={inputCls} value={v.checkedAt} onChange={set('checkedAt')} />
            <button type="button" className={btnGhost} onClick={() => setV((p) => ({ ...p, checkedAt: toJstDateTimeLocal(Date.now()) }))}>今</button>
          </div>
        </div>
        <div>
          <label className={labelCls}>確認した特典の内容（任意・200文字まで）</label>
          <input className={inputCls} value={v.benefitNote} onChange={set('benefitNote')} maxLength={200} placeholder="例：ポイント5倍（商品ページに記載）" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>メモ（対象外の場合は理由）</label>
          <input className={inputCls} value={v.note} onChange={set('note')} maxLength={1000} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" className={btnPrimary} onClick={save} disabled={busy || !operator.trim()}>保存</button>
        <button type="button" className={btnGhost} onClick={checkApi} disabled={busy || link.api?.code === 'no_item_code'}>{link.api?.code === 'no_item_code' ? '商品コード・商品番号なし（API確認不可）' : '楽天APIで現在の情報を確認'}</button>
        <button type="button" className={`${btnDanger} ml-auto`} onClick={unlink} disabled={busy}>紐付け解除</button>
      </div>
      <NoticeLine notice={notice} />
      {api && <ApiResult api={api} now={now} />}
    </li>
  );
}

function ApiResult({ api, now }: { api: { info?: ItemCheckInfo; message?: string }; now: number }) {
  if (!api.info) return <p className="text-xs text-amber-700 mt-2">{api.message}</p>;
  const i = api.info;
  if (i.source === 'books') {
    return (
      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
        <p>楽天ブックス（商品番号で照合）：{i.availability === 1 ? '購入できる' : '購入できない（品切れ・販売終了等）'}{i.itemPrice != null ? `／価格 ${i.itemPrice.toLocaleString()}円（取得時点）` : ''}</p>
        <p className="text-[11px] text-gray-500 mt-1">取得：{formatJstAdmin(i.fetchedAt)}。楽天ブックスの API にはポイント倍率・特典の項目が無いため、特典は公式ページで確認してください。表示のみで商品データには保存していません。</p>
      </div>
    );
  }
  const rows: [string, string][] = [
    ['商品コード', i.itemCode],
    ['価格（API取得時点）', i.itemPrice != null ? `${i.itemPrice.toLocaleString()}円` : '—'],
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
        取得：{formatJstAdmin(i.fetchedAt)}{now - i.fetchedAt > 3600_000 ? '（1時間以上前）' : ''}。表示のみで商品データには保存していません（24時間は再利用）。
        商品別のポイント倍率だけの情報で、ショップ単位・購入者条件（買いまわり・楽天カード等）の特典は含みません。24時間以内に終わる倍付けはAPIに出ません。
      </p>
    </div>
  );
}

// ── ④ SNS投稿文 ─────────────────────────────────────────────────────────────────

function loadCopyHistory(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(COPY_HISTORY_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}
function saveCopyHistory(key: string) {
  try {
    const h = loadCopyHistory();
    h[key] = Date.now();
    // 古い記録は捨てる（30日）
    for (const [k, t] of Object.entries(h)) if (Date.now() - t > 30 * 86400_000) delete h[k];
    localStorage.setItem(COPY_HISTORY_KEY, JSON.stringify(h));
  } catch { /* ignore */ }
}

function PostGenerator({ event, links, persons, groups, groupInfo, now }: {
  event: RakutenEvent; links: LinkedRow[]; persons: PersonOption[]; groups: string[]; groupInfo: GroupInfo; now: number;
}) {
  const linkedPersons = useMemo(() => [...new Set(links.map((l) => l.personName))], [links]);
  const [pattern, setPattern] = useState<PostPattern>('oshi');
  const [kind, setKind] = useState<'person' | 'group'>('person');
  const [personName, setPersonName] = useState(linkedPersons[0] ?? '');
  const [groupName, setGroupName] = useState('');
  const [history, setHistory] = useState<Record<string, number>>({});
  useEffect(() => { setHistory(loadCopyHistory()); }, []);
  useEffect(() => { if (!personName && linkedPersons[0]) setPersonName(linkedPersons[0]); }, [linkedPersons, personName]);

  const target = useMemo<PostTarget | null>(() => (kind === 'person'
    ? (personName ? { kind: 'person', name: personName, path: personPath(personName) } : null)
    : (groupName && groupInfo[groupName] ? { kind: 'group', name: groupName, path: groupInfo[groupName].path } : null)), [kind, personName, groupName, groupInfo]);
  const apiInfo = useMemo(() => Object.fromEntries(links.map((l) => [l.id, l.api?.code === 'ok' ? l.api.info : undefined])), [links]);
  const posts = useMemo(() => generatePosts({
    event, pattern, target, products: links, apiInfo, nowMs: now,
    memberNames: target?.kind === 'group' ? groupInfo[target.name]?.members ?? [] : undefined,
  }), [event, pattern, target, links, apiInfo, now, groupInfo]);
  const preview = posts.readiness.blockers.length > 0;
  const historyKey = `${event.id}|${pattern}|${target?.kind ?? '-'}|${target?.name ?? '-'}`;
  const lastCopied = history[historyKey];
  const onCopied = () => { saveCopyHistory(historyKey); setHistory(loadCopyHistory()); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <span className={labelCls}>投稿の型</span>
          <div className="space-y-1">
            {POST_PATTERNS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="radio" name="post-pattern" checked={pattern === p} onChange={() => setPattern(p)} />
                {POST_PATTERN_LABEL[p]}
              </label>
            ))}
          </div>
        </div>
        <div>
          <span className={labelCls}>投稿の対象{pattern === 'info' ? '（任意）' : ''}</span>
          <div className="flex gap-3 text-sm mb-1">
            <label className="inline-flex items-center gap-1"><input type="radio" checked={kind === 'person'} onChange={() => setKind('person')} />人物</label>
            <label className="inline-flex items-center gap-1"><input type="radio" checked={kind === 'group'} onChange={() => setKind('group')} />グループ</label>
          </div>
          {kind === 'person' ? (
            <>
              <PersonCombobox persons={persons} value={personName} onChange={setPersonName} placeholder="人物名で検索" allowEmpty emptyLabel="（指定しない）" />
              {linkedPersons.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {linkedPersons.map((n) => (
                    <button key={n} type="button" onClick={() => setPersonName(n)} className={`text-[11px] px-2 py-0.5 rounded-full border ${n === personName ? 'bg-slate-800 text-white border-slate-800' : 'border-gray-300 text-slate-600 hover:bg-gray-50'}`}>{n}</button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <select className={inputCls} value={groupName} onChange={(e) => setGroupName(e.target.value)} aria-label="グループ">
              <option value="">—</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 space-y-0.5">
        <p>・自動では投稿しません。内容を確認し、コピーして手動で投稿してください。リンクは推しサーチのページ（SNSごとの参照元付き）だけで、楽天のアフィリエイトURLは載せません。</p>
        <p>・GA4 の参照元（utm_source）・キャンペーン（rakuten_event_番号）別に、SNSからの流入と楽天商品のクリック（affiliate_click）を比べられます。</p>
        <p>・画像は作りません。商品画像・写真集の表紙をSNS素材に使わないでください。</p>
      </div>

      {posts.blocked ? (
        <p className="rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">{posts.blocked}</p>
      ) : (
        <>
          {preview && (
            <div className="rounded-md border-2 border-red-300 bg-red-50 p-3 text-xs text-red-800">
              <p className="font-bold">テストプレビュー（このままでは投稿できません）</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">{posts.readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              <p className="mt-1">公開用のコピーはできません。「プレビューをコピー」は先頭に「{PREVIEW_MARK}」が付きます。</p>
            </div>
          )}
          {posts.warnings.length > 0 && (
            <ul className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 list-disc pl-6 space-y-0.5">
              {posts.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {lastCopied && now - lastCopied < 24 * 3600_000 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              この端末で、同じイベント・型・対象の投稿文を{formatJstAdmin(lastCopied)}にコピーしています。同じ内容を何度も投稿しないよう、型や対象を変えることも検討してください。
            </p>
          )}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <PostBox title="X" text={posts.x} preview={preview} onCopied={onCopied} count={`${xWeightedLength(posts.x)} / ${X_MAX}（URLは23字・日本語は2字で計算）`} over={xWeightedLength(posts.x) > X_MAX} />
            <PostBox title="Threads" text={posts.threads} preview={preview} onCopied={onCopied} count={`${threadsLength(posts.threads)} / ${THREADS_MAX}`} over={threadsLength(posts.threads) > THREADS_MAX} />
            <PostBox title="Instagram フィード（本文のURLは押せないためプロフィールのリンクへ案内）" text={posts.instagramFeed} preview={preview} onCopied={onCopied} count={`${posts.instagramFeed.length} / ${INSTAGRAM_MAX}`} over={posts.instagramFeed.length > INSTAGRAM_MAX} />
            <div className="space-y-2">
              <PostBox title="Instagram ストーリーズ（画像に載せる文）" text={posts.instagramStory} preview={preview} onCopied={onCopied} />
              <PostBox title="ストーリーズのリンクスタンプ用URL" text={posts.storyLinkUrl} preview={preview} onCopied={onCopied} isUrl />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PostBox({ title, text, count, over, preview, isUrl, onCopied }: {
  title: string; text: string; count?: string; over?: boolean; preview: boolean; isUrl?: boolean; onCopied: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(kind: 'public' | 'preview') {
    // URL のプレビューは印を付けると使えなくなるため、URL はプレビュー時はコピーさせない
    const value = kind === 'preview' ? `${PREVIEW_MARK}\n${text}` : text;
    const ok = await copyTextWithFallback(value);
    setCopied(ok ? (kind === 'preview' ? 'プレビューをコピーしました' : 'コピーしました') : 'コピーできません');
    if (ok && kind === 'public') onCopied();
    setTimeout(() => setCopied(null), 2000);
  }
  return (
    <div className={`rounded-lg border ${preview ? 'border-red-200 border-dashed' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200">
        <h4 className="text-sm font-bold text-slate-700">{title}</h4>
        {count && <span className={`text-[11px] ${over ? 'text-red-600 font-bold' : 'text-gray-400'}`}>{count}</span>}
        <span className="ml-auto flex gap-2">
          {preview ? (
            !isUrl && <button type="button" onClick={() => copy('preview')} className={btnGhost}>{copied ?? 'プレビューをコピー'}</button>
          ) : (
            <button type="button" onClick={() => copy('public')} disabled={over} className={btnPrimary}>{copied ?? (isUrl ? 'URLをコピー' : 'コピー')}</button>
          )}
        </span>
      </div>
      <pre className={`whitespace-pre-wrap break-all p-3 text-[13px] leading-relaxed font-sans ${preview ? 'text-slate-500' : 'text-slate-800'}`}>{text}</pre>
    </div>
  );
}
