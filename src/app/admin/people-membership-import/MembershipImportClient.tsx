'use client';

import { useState, useRef } from 'react';
import type { PreviewRow } from '@/app/api/admin/people-membership-import/route';

const FIELD_LABEL: Record<string, string> = {
  activityStatus:  '活動状態',
  generation:      '期別',
  joinedAt:        '加入日',
  leftAt:          '卒業/脱退日',
  currentGroupName:'現在G',
  formerGroupNames:'過去G',
  membershipNote:  '備考',
};

const STATUS_LABEL: Record<string, string> = {
  active:    '現役',
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus:    '休止中',
  retired:   '引退',
  unknown:   '不明',
};

const CSV_EXAMPLE = `name,groupName,activityStatus,generation,joinedAt,leftAt,currentGroupName,formerGroupNames,membershipNote
菅井友香,欅坂46,graduated,1期生,2015-08,2022-09,,欅坂46,
守屋茜,欅坂46,graduated,2期生,2017-08,2023-03,,欅坂46,
賀喜遥香,乃木坂46,active,4期生,2020-01-05,,乃木坂46,,
山下美月,乃木坂46,graduated,3期生,2017-08,2024-03,,乃木坂46,`;

interface ApplyResult {
  updated: number;
  skipped: number;
  groupsCreated: number;
  errors: string[];
}

interface PreviewData {
  rows: PreviewRow[];
  summary: { total: number; toUpdate: number; toSkip: number };
}

type Step = 'input' | 'preview' | 'done';

export default function MembershipImportClient() {
  const [step, setStep] = useState<Step>('input');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsv(ev.target?.result as string ?? '');
    reader.readAsText(file, 'utf-8');
  }

  async function handlePreview() {
    if (!csv.trim()) { setError('CSVを入力してください'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/people-membership-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, action: 'preview' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'プレビュー失敗'); return; }
      setPreview(data as PreviewData);
      setStep('preview');
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  async function handleApply() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/people-membership-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, action: 'apply' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '適用失敗'); return; }
      setResult(data as ApplyResult);
      setStep('done');
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  function reset() {
    setStep('input'); setCsv(''); setPreview(null); setResult(null); setError('');
  }

  // ── Step 1: 入力 ─────────────────────────────────────────────────────────
  if (step === 'input') {
    return (
      <div className="space-y-6">
        {/* フォーマット説明 */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs space-y-2">
          <p className="font-semibold text-slate-700">CSVフォーマット</p>
          <p className="text-gray-500">1行目はヘッダー行（列名）。name をキーに人物を特定します。</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2">
            {[
              ['name', '人物名（必須・キー）'],
              ['groupName', '所属グループ（GroupMeta自動作成に使用）'],
              ['activityStatus', 'active / graduated / withdrawn / hiatus / retired / unknown'],
              ['generation', '例: 1期生、2期'],
              ['joinedAt', '加入日 例: 2020-01'],
              ['leftAt', '卒業/脱退日 例: 2023-03'],
              ['currentGroupName', '現在の所属G（GroupMeta自動作成）'],
              ['formerGroupNames', 'カンマ区切り 例: 欅坂46,日向坂46'],
              ['membershipNote', '備考テキスト'],
            ].map(([col, desc]) => (
              <div key={col} className="flex gap-2">
                <code className="text-indigo-700 bg-indigo-50 px-1 rounded flex-shrink-0">{col}</code>
                <span className="text-gray-500">{desc}</span>
              </div>
            ))}
          </div>
          <p className="text-amber-700 font-medium mt-2">
            空欄 → 既存値を保持 ／ <code className="bg-amber-50 px-1 rounded">**clear**</code> → 値を削除
          </p>
        </div>

        {/* 入力エリア */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-slate-700">CSV入力</label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-indigo-600 hover:bg-indigo-50"
            >
              ファイルを選択
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            <button
              type="button"
              onClick={() => setCsv(CSV_EXAMPLE)}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50"
            >
              サンプルを挿入
            </button>
            {csv && (
              <span className="text-xs text-gray-400 ml-auto">
                {csv.trim().split('\n').length - 1}行
              </span>
            )}
          </div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={12}
            placeholder="name,groupName,activityStatus,generation,joinedAt,leftAt,currentGroupName,formerGroupNames,membershipNote"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={handlePreview}
            disabled={loading || !csv.trim()}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'プレビュー中…' : 'プレビュー →'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: プレビュー ────────────────────────────────────────────────────
  if (step === 'preview' && preview) {
    const { rows, summary } = preview;
    return (
      <div className="space-y-5">
        {/* サマリー */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '合計行数', value: summary.total, cls: 'bg-gray-50 border-gray-200 text-slate-700' },
            { label: '更新予定', value: summary.toUpdate, cls: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
            { label: 'スキップ', value: summary.toSkip, cls: 'bg-amber-50 border-amber-200 text-amber-700' },
          ].map((s) => (
            <div key={s.label} className={`border rounded-xl px-4 py-3 text-center ${s.cls}`}>
              <p className="text-xs mb-1">{s.label}</p>
              <p className="text-2xl font-black">{s.value}</p>
            </div>
          ))}
        </div>

        {/* 詳細テーブル */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-4 py-2 font-medium">名前</th>
                  <th className="px-4 py-2 font-medium">状態</th>
                  <th className="px-4 py-2 font-medium">変更内容</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, i) => (
                  <tr key={i} className={!row.found ? 'bg-gray-50 opacity-60' : row.hasChanges ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                      {row.name}
                      {row.groupName && <span className="text-gray-400 font-normal ml-1">({row.groupName})</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {!row.found ? (
                        <span className="text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">スキップ</span>
                      ) : !row.hasChanges ? (
                        <span className="text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">変更なし</span>
                      ) : (
                        <span className="text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">更新</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.hasChanges ? (
                        <div className="flex flex-wrap gap-1.5">
                          {row.changes.map((ch, j) => (
                            <span key={j} className="flex items-center gap-1 text-[11px]">
                              <span className="text-gray-500">{FIELD_LABEL[ch.field] ?? ch.field}:</span>
                              {ch.action === 'clear' ? (
                                <span className="line-through text-red-400">{ch.oldValue}</span>
                              ) : (
                                <>
                                  {ch.oldValue && <span className="line-through text-gray-300">{ch.field === 'activityStatus' ? (STATUS_LABEL[ch.oldValue] ?? ch.oldValue) : ch.oldValue}</span>}
                                  <span className="text-indigo-700 font-medium">
                                    {ch.field === 'activityStatus' ? (STATUS_LABEL[ch.newValue ?? ''] ?? ch.newValue) : ch.newValue}
                                  </span>
                                </>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3">
          <button onClick={handleApply} disabled={loading || summary.toUpdate === 0}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {loading ? '適用中…' : `${summary.toUpdate}件 を適用する`}
          </button>
          <button onClick={() => setStep('input')}
            className="px-4 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50">
            ← 修正する
          </button>
        </div>
      </div>
    );
  }

  // ── Step 3: 完了 ─────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '更新完了', value: result.updated, cls: 'bg-green-50 border-green-200 text-green-700' },
            { label: 'スキップ', value: result.skipped, cls: 'bg-gray-50 border-gray-200 text-gray-500' },
            { label: 'G自動作成', value: result.groupsCreated, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
            { label: 'エラー', value: result.errors.length, cls: result.errors.length > 0 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-50 border-gray-200 text-gray-400' },
          ].map((s) => (
            <div key={s.label} className={`border rounded-xl px-4 py-3 text-center ${s.cls}`}>
              <p className="text-xs mb-1">{s.label}</p>
              <p className="text-2xl font-black">{s.value}</p>
            </div>
          ))}
        </div>

        {result.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs space-y-1">
            <p className="font-semibold text-red-700">エラー詳細</p>
            {result.errors.map((e, i) => <p key={i} className="text-red-600">{e}</p>)}
          </div>
        )}

        <div className="flex gap-3">
          <a href="/admin/work-check"
            className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">
            作品管理で確認 →
          </a>
          <a href="/admin/groups"
            className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
            グループ管理 →
          </a>
          <button onClick={reset}
            className="px-4 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50">
            もう一度
          </button>
        </div>
      </div>
    );
  }

  return null;
}
