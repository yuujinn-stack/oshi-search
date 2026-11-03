'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import CopyButton from './CopyButton';
import type { SonkamoGroupOption } from './SonkamoTargetPicker';
import { nonReadableParts } from '@/lib/video-sonkamo-script';
import {
  SITE_CTA_OPTIONS,
  SITE_MAX_SECONDS,
  SITE_TARGET_SECONDS,
  SITE_TEMPLATE_SPECS,
  buildSiteCaption,
  buildSitePlan,
  checkSiteLines,
  estimateSiteSeconds,
  type SiteCtaKey,
  type SiteLine,
  type SiteLinks,
  type SiteSegment,
  type SiteSelection,
  type SiteTarget,
  type SiteTemplateId,
} from '@/lib/video-site-reel';

// 動画「サイト誘導リール」（10種類）の対象・締めの言葉・台本。
// 1. 対象（人物・グループ・作品・配信サービス・用途と予算・おすすめ作品）を選ぶ（選択肢は推しサーチの公開データから）
// 2. 「台本を生成」→ サーバーが対象をDBで確かめて正式なページのパスを付ける → 読み仮名（固定辞書・登録読み）を当てた台本
// 3. 音声用台本を一括コピーして CapCut へ。動画タイトル・投稿文案・推奨リンク先（UTM付き）もここでコピーできる
// 対象・締めの言葉・読みが変わったら台本は作り直す（作り直すまで生成できない）。区間・パスはジョブ作成時にサーバーが作り直す。

export interface SitePick {
  selection: SiteSelection;
  cta: SiteCtaKey;
  target: SiteTarget | null;
  segments: SiteSegment[] | null;
  lines: SiteLine[] | null;
  title: string | null;
  links: SiteLinks | null;
  scriptKey: string | null;
}

export const EMPTY_SITE_PICK: SitePick = { selection: { kind: 'person', name: '' }, cta: 'profile', target: null, segments: null, lines: null, title: null, links: null, scriptKey: null };

const selectionKey = (p: Pick<SitePick, 'selection' | 'cta'>, templateId: string) => JSON.stringify([templateId, p.selection, p.cta]);

export function sitePickReady(p: SitePick, templateId: string): boolean {
  return !!p.selection.name && !!p.lines && p.lines.every((l) => l.text.trim() && l.kana.trim()) && (p.scriptKey ?? '').startsWith(selectionKey(p, templateId));
}

/** 管理画面からジョブに送る入力（ページのパス・区間等はサーバーが付ける） */
export function siteTemplateInput(p: SitePick) {
  return { version: 1, siteSelection: p.selection, cta: { key: p.cta }, lines: p.lines };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

type CastWork = { workId: string; title: string; year: number | null; cast: string[] };

export default function SiteReelPicker({
  templateId,
  persons,
  groups,
  fixedReadings,
  value,
  onChange,
}: {
  templateId: SiteTemplateId;
  persons: PersonOption[];
  groups: SonkamoGroupOption[];
  fixedReadings: Record<string, string>;
  value: SitePick;
  onChange: (next: SitePick) => void;
}) {
  const spec = SITE_TEMPLATE_SPECS[templateId];
  const sel = value.selection;
  const [readings, setReadings] = useState<Record<string, string> | null>(null);
  const [readingInputs, setReadingInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  // 選択肢（推しサーチの公開データ）
  const [groupMembers, setGroupMembers] = useState<string[] | null>(null);
  const [castWorks, setCastWorks] = useState<CastWork[] | null>(null);
  const [photobookPersons, setPhotobookPersons] = useState<Array<{ name: string; count: number }> | null>(null);
  const [providers, setProviders] = useState<Array<{ slug: string; name: string; workCount: number }> | null>(null);
  const [providerPersons, setProviderPersons] = useState<Array<{ name: string; workCount: number }> | null>(null);
  const [shopping, setShopping] = useState<{ uses: Array<{ value: string; label: string }>; budgets: Array<{ value: string; label: string }> } | null>(null);
  const [cardWorks, setCardWorks] = useState<Array<{ id: string; title: string; year: number | null }> | null>(null);

  const loadReadings = useCallback(async () => {
    try {
      const data = await getJson<{ readings?: Array<{ sourceText: string; reading: string }> }>('/api/admin/video-jobs/pronunciation-readings');
      setReadings(Object.fromEntries((data.readings ?? []).map((r) => [r.sourceText, r.reading])));
    } catch (err) {
      setNote({ kind: 'error', text: `登録済みの読みを読み込めませんでした: ${String(err instanceof Error ? err.message : err)}` });
    }
  }, []);
  useEffect(() => {
    void loadReadings();
  }, [loadReadings]);

  // テンプレートごとの選択肢
  useEffect(() => {
    const fail = (err: unknown) => setNote({ kind: 'error', text: `選択肢を読み込めませんでした: ${String(err instanceof Error ? err.message : err)}` });
    if (templateId === 'site_photobook_search') void getJson<{ persons: Array<{ name: string; count: number }> }>('/api/admin/video-jobs/site-candidates?kind=photobookPersons').then((d) => setPhotobookPersons(d.persons), fail);
    if (templateId === 'site_vod_service_search') void getJson<{ providers: Array<{ slug: string; name: string; workCount: number }> }>('/api/admin/video-jobs/site-candidates?kind=providers').then((d) => setProviders(d.providers), fail);
    if (templateId === 'site_shopping_diagnosis') void getJson<NonNullable<typeof shopping>>('/api/admin/video-jobs/site-candidates?kind=shoppingOptions').then(setShopping, fail);
  }, [templateId]);
  useEffect(() => {
    setGroupMembers(null);
    setCastWorks(null);
    setCardWorks(null);
    if (!sel.name) return;
    const fail = (err: unknown) => setNote({ kind: 'error', text: `選択肢を読み込めませんでした: ${String(err instanceof Error ? err.message : err)}` });
    const q = encodeURIComponent(sel.name);
    if (templateId === 'site_group_member_search') void getJson<{ members: string[] }>(`/api/admin/video-jobs/site-candidates?kind=groupMembers&name=${q}`).then((d) => setGroupMembers(d.members), fail);
    if (templateId === 'site_work_cast_search') void getJson<{ works: CastWork[] }>(`/api/admin/video-jobs/site-candidates?kind=castWorks&name=${q}`).then((d) => setCastWorks(d.works), fail);
    if (templateId === 'site_fan_card_demo') void getJson<{ works: Array<{ id: string; title: string; year: number | null }> }>(`/api/admin/video-jobs/site-candidates?kind=cardWorks&name=${q}`).then((d) => setCardWorks(d.works), fail);
  }, [templateId, sel.name]);
  useEffect(() => {
    setProviderPersons(null);
    if (templateId !== 'site_vod_service_search' || !sel.provider) return;
    void getJson<{ persons: Array<{ name: string; workCount: number }> }>(`/api/admin/video-jobs/site-candidates?kind=providerPersons&provider=${encodeURIComponent(sel.provider)}`).then(
      (d) => setProviderPersons(d.persons),
      (err) => setNote({ kind: 'error', text: String(err) }),
    );
  }, [templateId, sel.provider]);

  const readingsVersion = useMemo(() => `${readings ? Object.keys(readings).length : 0}/${Object.keys(fixedReadings).length}`, [readings, fixedReadings]);
  const setSelection = (patch: Partial<SiteSelection>) => {
    setUnresolved([]);
    onChange({ ...value, selection: { ...sel, ...patch } });
  };

  const generate = useCallback(
    async (base: SitePick) => {
      if (!readings) return;
      setNote(null);
      setBusy('generate');
      try {
        const { target } = await getJson<{ target: SiteTarget }>('/api/admin/video-jobs/site-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId, siteSelection: base.selection }),
        });
        const plan = buildSitePlan({ templateId, target, cta: base.cta, readings: { fixed: fixedReadings, registered: readings } });
        if (!plan.ok) {
          setNote({ kind: 'error', text: `台本を作れません: ${plan.missing.join(' / ')}` });
          onChange({ ...base, target: null, segments: null, lines: null, title: null, links: null, scriptKey: null });
          return;
        }
        setUnresolved(plan.unresolved);
        onChange({ ...base, target, segments: plan.segments, lines: plan.lines, title: plan.title, links: plan.links, scriptKey: selectionKey(base, templateId) + readingsVersion });
      } catch (err) {
        setNote({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
        onChange({ ...base, target: null, segments: null, lines: null, title: null, links: null, scriptKey: null });
      } finally {
        setBusy(null);
      }
    },
    [readings, templateId, fixedReadings, onChange, readingsVersion],
  );

  // 読みを登録したら（台本を作ってあれば）作り直す
  useEffect(() => {
    if (value.lines && value.scriptKey && value.scriptKey.startsWith(selectionKey(value, templateId)) && value.scriptKey !== selectionKey(value, templateId) + readingsVersion && readings) void generate(value);
  }, [value, templateId, readingsVersion, readings, generate]);

  async function registerReading(term: string) {
    const reading = (readingInputs[term] ?? '').trim();
    if (!reading) return;
    setBusy(term);
    setNote(null);
    try {
      await getJson('/api/admin/video-jobs/pronunciation-readings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceText: term, reading }) });
      setNote({ kind: 'ok', text: `「${term}」の読みを「${reading}」で登録しました。` });
      setReadingInputs((prev) => ({ ...prev, [term]: '' }));
      await loadReadings();
    } catch (err) {
      setNote({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(null);
    }
  }

  const stale = !!value.lines && !(value.scriptKey ?? '').startsWith(selectionKey(value, templateId));
  const lines = value.lines;
  const check = lines && value.segments ? checkSiteLines(value.segments, lines, templateId) : null;
  const unreadable = lines ? [...new Set(lines.flatMap((l) => nonReadableParts(l.kana)))] : [];
  const speechScript = lines ? lines.map((l) => l.kana).join('\n') : '';
  const editLine = (id: string, key: 'text' | 'kana', v: string) => onChange({ ...value, lines: (value.lines ?? []).map((l) => (l.id === id ? { ...l, [key]: v } : l)) });
  const caption = value.title && value.target ? buildSiteCaption({ templateId, title: value.title, target: value.target, cta: value.cta }) : null;
  const personList = (names: string[] | null) => (names ? persons.filter((p) => names.includes(p.name)) : persons);
  const selectedWork = castWorks?.find((w) => w.workId === sel.workId) ?? null;

  const personField = (label: string, list = persons) => (
    <label className="text-xs text-gray-600 block">
      {label}
      <PersonCombobox persons={list} value={sel.name} onChange={(n) => setSelection({ kind: 'person', name: n, member: null, workId: null, toPerson: null, workIds: [], persons: templateId === 'site_three_person_search' ? [n, ...(sel.persons ?? []).slice(1)] : null })} placeholder="人物を選択" />
    </label>
  );

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">{spec.guide}</p>

      {/* 1. 対象 */}
      <div className="space-y-2">
        {templateId === 'site_subscription_diagnosis' && (
          <div className="flex gap-4 text-xs">
            {(['person', 'group'] as const).map((k) => (
              <label key={k} className="cursor-pointer">
                <input type="radio" className="mr-1" checked={sel.kind === k} onChange={() => setSelection({ kind: k, name: '' })} />
                {k === 'person' ? '人物' : 'グループ'}
              </label>
            ))}
          </div>
        )}
        {(templateId === 'site_group_member_search' || (templateId === 'site_subscription_diagnosis' && sel.kind === 'group')) ? (
          <label className="text-xs text-gray-600 block">
            グループ
            <select value={sel.name} onChange={(e) => setSelection({ kind: 'group', name: e.target.value, member: null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
              <option value="">選択してください</option>
              {groups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        ) : templateId === 'site_photobook_search' ? (
          personField(`人物（写真集の一覧に掲載中の写真集がある人物 ${photobookPersons?.length ?? '…'}人）`, personList(photobookPersons?.map((p) => p.name) ?? []))
        ) : templateId === 'site_vod_service_search' ? (
          <div className="space-y-2">
            <label className="text-xs text-gray-600 block">
              配信サービス（トップページ「配信サービスから探す」）
              <select value={sel.provider ?? ''} onChange={(e) => setSelection({ provider: e.target.value || null, name: '', kind: 'person' })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="">選択してください</option>
                {(providers ?? []).map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}（{p.workCount}作品）
                  </option>
                ))}
              </select>
            </label>
            {sel.provider && (
              <label className="text-xs text-gray-600 block">
                人物（サービスのページ「配信作品から人物を探す」に出る人物）
                <select value={sel.name} onChange={(e) => setSelection({ kind: 'person', name: e.target.value })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
                  <option value="">選択してください</option>
                  {(providerPersons ?? []).map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}（{p.workCount}作品）
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : (
          personField(templateId === 'site_three_person_search' ? '1人目' : templateId === 'site_work_cast_search' ? '出演者A（この人の出演作品から作品名で絞り込む）' : '人物')
        )}

        {templateId === 'site_group_member_search' && sel.name && (
          <label className="text-xs text-gray-600 block">
            紹介するメンバー（グループページのメンバー欄に表示される {groupMembers?.length ?? '…'}人）
            <select value={sel.member ?? ''} onChange={(e) => setSelection({ member: e.target.value || null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
              <option value="">選択してください</option>
              {(groupMembers ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}

        {templateId === 'site_work_cast_search' && sel.name && (
          <div className="space-y-2">
            {castWorks && castWorks.length === 0 && <p className="text-xs text-amber-800 bg-amber-50 rounded p-2">⚠ {sel.name}の公開作品に、推しサーチに出演者が2人以上登録された作品がありません。別の人物を選んでください。</p>}
            {castWorks && castWorks.length > 0 && (
              <label className="text-xs text-gray-600 block">
                作品（出演者が2人以上登録された作品 {castWorks.length}件）
                <select value={sel.workId ?? ''} onChange={(e) => setSelection({ workId: e.target.value || null, toPerson: null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm max-w-full">
                  <option value="">選択してください</option>
                  {castWorks.map((w) => (
                    <option key={w.workId} value={w.workId}>
                      {w.title}
                      {w.year ? `（${w.year}）` : ''}・出演者 {w.cast.length}人
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedWork && (
              <label className="text-xs text-gray-600 block">
                出演者B（作品ページから開く人）
                <select value={sel.toPerson ?? ''} onChange={(e) => setSelection({ toPerson: e.target.value || null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
                  <option value="">選択してください</option>
                  {selectedWork.cast.filter((c) => c !== sel.name).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {templateId === 'site_three_person_search' && sel.name && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <label key={i} className="text-xs text-gray-600 block">
                {i + 1}人目{i === 2 ? '（省略すると2人。最後の人は関連商品を見せます）' : '（2人だけのときは関連商品を見せます）'}
                <PersonCombobox
                  persons={persons.filter((p) => p.name !== sel.name)}
                  value={(sel.persons ?? [])[i] ?? ''}
                  onChange={(n) => {
                    const ps = [sel.name, (sel.persons ?? [])[1] ?? '', (sel.persons ?? [])[2] ?? ''];
                    ps[i] = n;
                    setSelection({ persons: ps.filter(Boolean) });
                  }}
                  placeholder="人物を選択"
                />
              </label>
            ))}
          </div>
        )}

        {templateId === 'site_shopping_diagnosis' && (
          <div className="flex flex-wrap gap-4 text-xs text-gray-600">
            <label>
              用途
              <select value={sel.use ?? ''} onChange={(e) => setSelection({ use: e.target.value || null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="">選択してください</option>
                {(shopping?.uses ?? []).map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              予算
              <select value={sel.budget ?? ''} onChange={(e) => setSelection({ budget: e.target.value || null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="">選択してください</option>
                {(shopping?.budgets ?? []).map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {templateId === 'site_fan_card_demo' && sel.name && (
          <div className="space-y-2 text-xs">
            <p className="font-bold text-slate-700">おすすめ作品（1〜3件・選んだ順にカードに載ります）{(sel.workIds ?? []).length}/3</p>
            <div className="max-h-56 overflow-y-auto border border-gray-100 rounded divide-y divide-gray-50">
              {(cardWorks ?? []).map((w) => {
                const order = (sel.workIds ?? []).indexOf(w.id);
                return (
                  <label key={w.id} className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-violet-50">
                    <input
                      type="checkbox"
                      checked={order >= 0}
                      disabled={order < 0 && (sel.workIds ?? []).length >= 3}
                      onChange={() => setSelection({ workIds: order >= 0 ? (sel.workIds ?? []).filter((x) => x !== w.id) : [...(sel.workIds ?? []), w.id] })}
                    />
                    <span className="w-4 text-violet-700 font-bold">{order >= 0 ? order + 1 : ''}</span>
                    <span>
                      {w.title}
                      {w.year ? `（${w.year}）` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-4">
              {(['cool', 'cute'] as const).map((v) => (
                <label key={v} className="cursor-pointer">
                  <input type="radio" className="mr-1" checked={(sel.variant ?? 'cool') === v} onChange={() => setSelection({ variant: v })} />
                  {v === 'cool' ? 'ノーマル' : 'デコ'}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. 締めの言葉（1本に1つ） */}
      <div className="space-y-1 text-xs">
        <p className="font-bold text-slate-700">締めの言葉（動画ごとに1つ）</p>
        {(Object.keys(SITE_CTA_OPTIONS) as SiteCtaKey[]).map((k) => (
          <label key={k} className="block cursor-pointer">
            <input type="radio" className="mr-1" checked={value.cta === k} onChange={() => onChange({ ...value, cta: k })} />
            {SITE_CTA_OPTIONS[k].text}
            {k === 'profile' ? '（基本）' : '（別案）'}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" disabled={!sel.name || !readings || busy === 'generate'} onClick={() => void generate(value)} className="px-4 py-1.5 rounded bg-violet-600 text-white text-xs font-bold disabled:bg-gray-300">
          {busy === 'generate' ? '確認中…' : value.lines ? '台本を作り直す' : '台本を生成'}
        </button>
        {stale && <span className="text-xs text-amber-700">対象・締めの言葉が変わりました。台本を作り直してください。</span>}
      </div>
      {note && <p className={`text-xs ${note.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{note.text}</p>}

      {/* 3. 台本・投稿用の情報 */}
      {lines && value.segments && (
        <div className="space-y-3">
          {unresolved.length > 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
              <p className="font-bold text-amber-800">読み未登録の名前があります（登録すると台本を作り直します）</p>
              {unresolved.map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <span className="font-bold">{t}</span>
                  <input value={readingInputs[t] ?? ''} onChange={(e) => setReadingInputs((p) => ({ ...p, [t]: e.target.value }))} placeholder="ひらがなで" className="border border-gray-300 rounded px-2 py-0.5" />
                  <button type="button" disabled={busy === t || !(readingInputs[t] ?? '').trim()} onClick={() => void registerReading(t)} className="px-2 py-0.5 rounded border border-amber-600 text-amber-800 disabled:opacity-40">
                    登録
                  </button>
                </div>
              ))}
            </div>
          )}
          <table className="w-full text-xs border border-gray-200">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-2 py-1 w-40">区間</th>
                <th className="text-left px-2 py-1">字幕（台本）</th>
                <th className="text-left px-2 py-1">読み（音声用）</th>
                <th className="text-right px-2 py-1 w-20">見積もり</th>
              </tr>
            </thead>
            <tbody>
              {value.segments.map((s, i) => (
                <tr key={s.id} className="border-t border-gray-100 align-top">
                  <td className="px-2 py-1 text-gray-600">
                    {s.kind === 'hook' ? '冒頭' : s.kind === 'cta' ? '締め' : s.label}
                    {s.sub && s.kind !== 'step' && <span className="block text-gray-400">{s.sub}</span>}
                  </td>
                  <td className="px-2 py-1">
                    <input value={lines[i].text} disabled={s.kind === 'cta'} onChange={(e) => editLine(s.id, 'text', e.target.value)} className="w-full border border-gray-200 rounded px-1 py-0.5 disabled:bg-gray-50" />
                  </td>
                  <td className="px-2 py-1">
                    <input value={lines[i].kana} onChange={(e) => editLine(s.id, 'kana', e.target.value)} className={`w-full border rounded px-1 py-0.5 ${nonReadableParts(lines[i].kana).length > 0 ? 'border-red-400' : 'border-gray-200'}`} />
                  </td>
                  <td className={`px-2 py-1 text-right ${check?.overlong.includes(s.id) ? 'text-amber-700 font-bold' : 'text-gray-500'}`}>{estimateSiteSeconds(lines[i].kana).toFixed(1)}秒</td>
                </tr>
              ))}
            </tbody>
          </table>
          {check && (
            <p className={`text-xs ${check.tooLong ? 'text-red-600 font-bold' : check.total > SITE_TARGET_SECONDS ? 'text-amber-700' : 'text-gray-600'}`}>
              音声なし動画の長さの見積もり {check.total.toFixed(1)}秒（目安15〜{SITE_TARGET_SECONDS}秒・{SITE_MAX_SECONDS}秒まで）
              {check.tooLong ? '。長すぎるため生成できません。文を短くしてください' : ''}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <CopyButton text={speechScript} label="音声用台本（ひらがな）をコピー" primary disabled={unreadable.length > 0} disabledTitle={`読みに漢字・英字が残っています: ${unreadable.join('・')}`} />
            {unreadable.length > 0 && <span className="text-red-600">読みに漢字・英字が残っています: {unreadable.join('・')}</span>}
          </div>

          <div className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-2 text-xs border-t border-gray-100 pt-3">
            <span className="text-gray-500">動画タイトル</span>
            <span className="flex items-center gap-2">
              <span className="font-bold text-slate-800">{value.title}</span>
              {value.title && <CopyButton text={value.title} label="コピー" />}
            </span>
            <span className="text-gray-500">Instagram 投稿文案</span>
            <span className="space-y-1">
              <pre className="whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded p-2 font-sans">{caption}</pre>
              {caption && <CopyButton text={caption} label="投稿文をコピー" />}
            </span>
            <span className="text-gray-500">締めの言葉（CTA）</span>
            <span>{SITE_CTA_OPTIONS[value.cta].text}</span>
            {value.links && (
              <>
                <span className="text-gray-500">推奨リンク先URL</span>
                <span className="flex items-center gap-2 flex-wrap">
                  <code className="bg-gray-50 border border-gray-200 rounded px-1.5 break-all">{decodeURI(value.links.pageUrl)}</code>
                  <CopyButton text={value.links.pageUrl} label="URLをコピー" />
                  <span className="text-gray-500">推しサーチの正式なページ（将来ストーリーズのリンクスタンプにもこのURL）</span>
                </span>
                <span className="text-gray-500">UTM付きリンク</span>
                <span className="flex items-center gap-2 flex-wrap">
                  <code className="bg-gray-50 border border-gray-200 rounded px-1.5 break-all">{decodeURI(value.links.utmUrl)}</code>
                  <CopyButton text={value.links.utmUrl} label="コピー" primary />
                </span>
                <span className="text-gray-500">プロフィールのリンク用</span>
                <span className="flex items-center gap-2 flex-wrap">
                  <code className="bg-gray-50 border border-gray-200 rounded px-1.5 break-all">{value.links.profileUrl}</code>
                  <CopyButton text={value.links.profileUrl} label="コピー" />
                  <span className="text-gray-500">リールの中のURLは押せないため、動画では「{value.segments[value.segments.length - 1].sub}」を案内します</span>
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
