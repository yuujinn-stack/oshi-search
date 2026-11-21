'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { STORY_TEMPLATES, type StoryTemplateId } from '@/lib/story-maker/templates';
import { AB_TESTS } from '@/lib/story-maker/ab';
import type { AbTestKey, AbVariant } from '@/lib/story-maker/utm';
import {
  computeStoryMetrics,
  formatPercent,
  storyRecordsToCsv,
  summarizeAbTests,
  BF_PREVIEW_RECORD_MESSAGE,
  bfRecordSaveBlocked,
  type RecordSlideCount,
  type StoryPostRecord,
} from '@/lib/story-maker/metrics';
import { downloadBlob } from './png-export';
import type { BfApprovedItem } from '@/lib/story-maker/bf-sale';

export interface MetricsDraftContext {
  templateId: StoryTemplateId;
  targetName: string | null;
  targetType: 'person' | 'group' | null;
  abTest: AbTestKey | null;
  variants: { variant: AbVariant | null; slides: RecordSlideCount; utmCampaign: string; utmContent: string; url: string; linkSlide: number }[];
  /** 楽天BF・推し別セール紹介で掲載する承認済みの商品（記録に一緒に保存する） */
  saleItems?: BfApprovedItem[] | null;
}

type NumField = '' | string;
interface Draft {
  id: string;
  postedAt: string;
  templateId: StoryTemplateId;
  targetName: string;
  targetType: 'person' | 'group' | null;
  slideCount: RecordSlideCount;
  abTest: AbTestKey | null;
  abVariant: AbVariant | null;
  utmCampaign: string;
  utmContent: string;
  url: string;
  /** 3つ（既存）。4枚の投稿（楽天BF）だけ4つ */
  reach: NumField[];
  linkSlide: number;
  linkTaps: NumField;
  linkSlideReach: NumField;
  ga4Sessions: NumField;
  memo: string;
  saleItems?: BfApprovedItem[] | null;
  createdAt?: string;
}

function newId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const n2s = (v: number | null): NumField => (v === null ? '' : String(v));

function draftFromContext(ctx: MetricsDraftContext, variantIndex: number): Draft {
  const v = ctx.variants[variantIndex] ?? ctx.variants[0];
  return {
    id: newId(),
    postedAt: nowLocal(),
    templateId: ctx.templateId,
    targetName: ctx.targetName ?? '',
    targetType: ctx.targetType,
    slideCount: v.slides,
    abTest: ctx.abTest,
    abVariant: v.variant,
    utmCampaign: v.utmCampaign,
    utmContent: v.utmContent,
    url: v.url,
    reach: Array.from({ length: Math.max(3, v.slides) }, () => ''),
    linkSlide: v.linkSlide,
    linkTaps: '',
    linkSlideReach: '',
    ga4Sessions: '',
    memo: '',
    ...(ctx.saleItems ? { saleItems: ctx.saleItems } : {}),
  };
}

function draftFromRecord(r: StoryPostRecord): Draft {
  return {
    ...r,
    targetName: r.targetName ?? '',
    reach: Array.from({ length: Math.max(3, r.slideCount) }, (_, i) => n2s(r.reach[i] ?? null)),
    linkTaps: n2s(r.linkTaps),
    linkSlideReach: n2s(r.linkSlideReach),
    ga4Sessions: n2s(r.ga4Sessions),
  };
}

const tplTitle = (id: StoryTemplateId) => STORY_TEMPLATES.find((t) => t.id === id)?.title ?? id;
const abLabel = (k: AbTestKey | null) => AB_TESTS.find((t) => t.key === k)?.label ?? '';

function NumInput({ label, value, onChange, disabled, hint }: { label: string; value: NumField; onChange: (v: string) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`text-xs text-gray-600 ${disabled ? 'opacity-40' : ''}`}>
      {label}
      <input inputMode="numeric" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ''))} placeholder={hint ?? '未入力'} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" />
    </label>
  );
}

export default function StoryMetricsPanel({ ctx, envScope = '' }: { ctx: MetricsDraftContext; envScope?: string }) {
  const [records, setRecords] = useState<StoryPostRecord[]>([]);
  const [storage, setStorage] = useState<boolean | null>(null);
  const [scope, setScope] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/story-maker/posts', { cache: 'no-store' });
      const j = (await res.json()) as { records?: StoryPostRecord[]; storage?: boolean; scope?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `読み込みに失敗しました（${res.status}）`);
      setRecords(j.records ?? []);
      setStorage(j.storage ?? false);
      setScope(j.scope ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/story-maker/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: draft }),
      });
      const j = (await res.json()) as { record?: StoryPostRecord; error?: string };
      if (!res.ok || !j.record) throw new Error(j.error ?? `保存に失敗しました（${res.status}）`);
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('この記録を削除しますか？')) return;
    const res = await fetch(`/api/admin/story-maker/posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? '削除に失敗しました');
      return;
    }
    await load();
  }

  const ab = useMemo(() => summarizeAbTests(records), [records]);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-bold text-slate-800">📊 投稿効果の記録</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {ctx.variants.map((v, i) => (
            <button key={i} type="button" disabled={bfRecordSaveBlocked(ctx.templateId, envScope || scope)} onClick={() => setDraft(draftFromContext(ctx, i))} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed">
              ＋ いまの設定で記録を追加{v.variant ? `（${v.variant.toUpperCase()}）` : ''}
            </button>
          ))}
          <button type="button" disabled={records.length === 0} onClick={() => downloadBlob(new Blob([storyRecordsToCsv(records)], { type: 'text/csv;charset=utf-8' }), 'story-posts.csv')} className="px-3 py-1.5 rounded-lg border border-gray-300 disabled:opacity-40">CSVで書き出す</button>
        </div>
      </div>

      <details className="mb-3 text-xs text-gray-600 bg-slate-50 rounded-lg p-3">
        <summary className="cursor-pointer font-semibold text-slate-700">計測方法（クリックで表示）</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1 leading-relaxed">
          <li><b>リーチ・リンクスタンプのタップ数</b>：Instagramアプリでストーリーズを開き、各ページの「アクティビティ（インサイト）」の数字を手入力します。自動取得はしていません（Metricool 等の連携もこの画面には未接続）。</li>
          <li><b>GA4のサイト流入数</b>（任意）：GA4 の「レポート → 集客 → トラフィック獲得」で、セッションのキャンペーン＝utm_campaign、セッションの手動広告コンテンツ＝utm_content で絞り込んだセッション数を入力します。</li>
          <li><b>閲覧維持率</b>＝最後のページのリーチ ÷ 1枚目のリーチ（2枚以上の投稿のみ）。</li>
          <li><b>リンクタップ率</b>＝リンクスタンプのタップ数 ÷ リンク設置ページのリーチ（未入力ならそのページのリーチを使用）。</li>
          <li>未入力の値は計算に使わず「—」と表示します（推測で補いません）。A/B比較は件数が少ないうちは参考値です。</li>
          <li>ストーリーズは24時間で消えるため、インサイトは投稿後24時間以内（またはアーカイブ）に確認してください。</li>
        </ul>
      </details>

      {bfRecordSaveBlocked(ctx.templateId, envScope || scope) && (
        <p data-testid="bf-preview-record-blocked" className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2" role="note">{BF_PREVIEW_RECORD_MESSAGE}</p>
      )}
      {storage === false && <p className="mb-3 text-xs text-amber-700 bg-amber-50 rounded p-2">この環境では記録の保存先（Redis）が設定されていないため、記録を保存できません。本番の管理画面で記録してください。</p>}
      {scope && scope !== 'production' && storage && <p className="mb-3 text-xs text-gray-500">この環境（{scope}）の記録は本番とは別に保存されます。</p>}
      {error && <p className="mb-3 text-xs text-red-600 bg-red-50 rounded p-2" role="alert">{error}</p>}

      {draft && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50/40 p-3 space-y-3">
          <div className="grid sm:grid-cols-4 gap-2 text-xs text-gray-600">
            <label>投稿日時<input type="datetime-local" value={draft.postedAt} onChange={(e) => set({ postedAt: e.target.value })} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" /></label>
            <div>テンプレート<div className="mt-1 text-sm text-slate-800">{tplTitle(draft.templateId)}</div></div>
            <div>対象<div className="mt-1 text-sm text-slate-800">{draft.targetName || '（なし）'}</div></div>
            <div>枚数・パターン<div className="mt-1 text-sm text-slate-800">{draft.slideCount}枚{draft.abTest ? `／${abLabel(draft.abTest)} ${draft.abVariant?.toUpperCase()}` : ''}</div></div>
          </div>
          <div className="text-[11px] text-gray-500 font-mono break-all">{draft.utmCampaign} / {draft.utmContent}</div>
          <div className="grid sm:grid-cols-4 gap-2">
            {draft.reach.map((_, i) => (
              <NumInput key={i} label={`${i + 1}枚目のリーチ`} value={draft.reach[i]} disabled={i >= draft.slideCount}
                onChange={(v) => { const reach = [...draft.reach]; reach[i] = v; set({ reach }); }} />
            ))}
            <label className="text-xs text-gray-600">リンクを置いたページ
              <select value={draft.linkSlide} onChange={(e) => set({ linkSlide: Number(e.target.value) })} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm">
                {Array.from({ length: draft.slideCount }, (_, i) => <option key={i} value={i + 1}>{i + 1}枚目</option>)}
              </select>
            </label>
            <NumInput label="リンクスタンプのタップ数" value={draft.linkTaps} onChange={(v) => set({ linkTaps: v })} />
            <NumInput label="リンク設置ページのリーチ" value={draft.linkSlideReach} onChange={(v) => set({ linkSlideReach: v })} hint={`未入力＝${draft.linkSlide}枚目のリーチ`} />
            <NumInput label="GA4のサイト流入数（任意）" value={draft.ga4Sessions} onChange={(v) => set({ ga4Sessions: v })} />
          </div>
          <label className="block text-xs text-gray-600">メモ<input value={draft.memo} onChange={(e) => set({ memo: e.target.value })} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" /></label>
          {draft.saleItems && draft.saleItems.length > 0 && (
            <div className="text-xs text-gray-600">
              掲載したセール商品（承認欄の価格・根拠URL・適用条件・確認者・確認日時）も記録します：
              <ul className="mt-1 list-disc pl-4">
                {draft.saleItems.map((it) => <li key={it.productId}>{it.title.slice(0, 40)}　{it.priceLabel}{it.regularPrice.toLocaleString('ja-JP')}円 → {it.salePrice.toLocaleString('ja-JP')}円（{it.offRate}%OFF・適用条件：{it.conditions}・確認：{it.checkedBy} {new Date(it.checkedAt).toLocaleString('ja-JP')}・根拠：{it.sourceUrl}）</li>)}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={saving || bfRecordSaveBlocked(draft.templateId, envScope || scope)} onClick={save} className="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-sm font-bold disabled:opacity-40">{saving ? '保存中…' : '保存'}</button>
            {bfRecordSaveBlocked(draft.templateId, envScope || scope) && <span className="text-xs text-red-700 self-center">{BF_PREVIEW_RECORD_MESSAGE}</span>}
            <button type="button" onClick={() => setDraft(null)} className="px-4 py-1.5 rounded-lg border border-gray-300 text-sm">キャンセル</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-1.5 pr-2">投稿日時</th><th className="pr-2">テンプレート</th><th className="pr-2">対象</th><th className="pr-2">枚数</th><th className="pr-2">A/B</th>
              <th className="pr-2 text-right">リーチ 1/2/3</th><th className="pr-2 text-right">タップ</th><th className="pr-2 text-right">GA4</th>
              <th className="pr-2 text-right">閲覧維持率</th><th className="pr-2 text-right">タップ率</th><th />
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && <tr><td colSpan={11} className="py-4 text-center text-gray-400">まだ記録はありません。</td></tr>}
            {records.map((r) => {
              const m = computeStoryMetrics(r);
              return (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.postedAt.replace('T', ' ')}</td>
                  <td className="pr-2">{tplTitle(r.templateId).split('：')[0]}</td>
                  <td className="pr-2">{r.targetName ?? '—'}</td>
                  <td className="pr-2">{r.slideCount}枚</td>
                  <td className="pr-2">{r.abTest ? `${abLabel(r.abTest)} ${r.abVariant?.toUpperCase()}` : '—'}</td>
                  <td className="pr-2 text-right whitespace-nowrap">{r.reach.slice(0, r.slideCount).map((v) => (v === null || v === undefined ? '—' : v.toLocaleString())).join(' / ')}</td>
                  <td className="pr-2 text-right">{r.linkTaps?.toLocaleString() ?? '—'}</td>
                  <td className="pr-2 text-right">{r.ga4Sessions?.toLocaleString() ?? '—'}</td>
                  <td className="pr-2 text-right">{formatPercent(m.retention)}</td>
                  <td className="pr-2 text-right">{formatPercent(m.tapRate)}</td>
                  <td className="whitespace-nowrap">
                    <button type="button" className="text-violet-600 underline mr-2" onClick={() => setDraft(draftFromRecord(r))}>編集</button>
                    <button type="button" className="text-red-600 underline" onClick={() => remove(r.id)}>削除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ab.length > 0 && (
        <div className="mt-4">
          <h3 className="font-bold text-sm text-slate-700 mb-2">A/Bパターン別の成果</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-1.5 pr-2">テンプレート</th><th className="pr-2">比較</th><th className="pr-2">対象</th>
                  <th className="pr-2 text-right">A 件数</th><th className="pr-2 text-right">A タップ率</th><th className="pr-2 text-right">A 維持率</th>
                  <th className="pr-2 text-right">B 件数</th><th className="pr-2 text-right">B タップ率</th><th className="pr-2 text-right">B 維持率</th><th className="pr-2">タップ率が高い方</th>
                </tr>
              </thead>
              <tbody>
                {ab.map((g) => (
                  <tr key={g.key} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{tplTitle(g.templateId).split('：')[0]}</td>
                    <td className="pr-2">{abLabel(g.abTest)}</td>
                    <td className="pr-2">{g.targetName ?? '—'}</td>
                    <td className="pr-2 text-right">{g.a.posts}</td>
                    <td className="pr-2 text-right">{formatPercent(g.a.tapRate)}{g.a.linkReach > 0 ? `（${g.a.taps}/${g.a.linkReach}）` : ''}</td>
                    <td className="pr-2 text-right">{formatPercent(g.a.retention)}</td>
                    <td className="pr-2 text-right">{g.b.posts}</td>
                    <td className="pr-2 text-right">{formatPercent(g.b.tapRate)}{g.b.linkReach > 0 ? `（${g.b.taps}/${g.b.linkReach}）` : ''}</td>
                    <td className="pr-2 text-right">{formatPercent(g.b.retention)}</td>
                    <td className="pr-2 font-bold">{g.better ? g.better.toUpperCase() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">テンプレート×比較の種類×対象ごとに、入力済みの投稿のタップ数・リーチを合計して計算しています（統計的な有意差の判定はしていません）。</p>
        </div>
      )}
    </section>
  );
}
