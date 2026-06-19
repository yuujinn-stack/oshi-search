'use client';

import { useState, useRef } from 'react';
import type { PersonPreviewRow } from '@/app/api/admin/people/import/route';

const SAMPLE_CSV = `name,groupName,genre,aliases,tmdbId,description
賀喜遥香,乃木坂46,坂道,"かっきー,賀喜ちゃん",,
遠藤さくら,乃木坂46,坂道,"さくちゃん,えんさく",,
井上和,乃木坂46,坂道,なぎ,,`;

// ─── バッジ ───────────────────────────────────────────────────────────────────
const ACTION_BADGE: Record<string, string> = {
  add:   'bg-green-100 text-green-700',
  skip:  'bg-gray-100 text-gray-500',
  error: 'bg-red-100 text-red-700',
};
const ACTION_LABEL: Record<string, string> = {
  add:   '新規追加',
  skip:  'スキップ',
  error: 'エラー',
};

// ─── 型 ──────────────────────────────────────────────────────────────────────
interface PreviewResult {
  rows: PersonPreviewRow[];
  addCount: number;
  skipCount: number;
  errorCount: number;
}

interface SaveResult {
  added: string[];
  skipped: string[];
  errors: string[];
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────
interface Props {
  initialCount: number;
}

export default function ImportForm({ initialCount }: Props) {
  const [csvText, setCsvText]           = useState('');
  const [preview, setPreview]           = useState<PreviewResult | null>(null);
  const [saveResult, setSaveResult]     = useState<SaveResult | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [importedCount, setImportedCount] = useState(initialCount);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── ファイル読み込み ────────────────────────────────────────────────────────
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) ?? '');
      setPreview(null);
      setSaveResult(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  // ── ドラッグ&ドロップ ────────────────────────────────────────────────────────
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) ?? '');
      setPreview(null);
      setSaveResult(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  // ── プレビュー ────────────────────────────────────────────────────────────
  async function handlePreview() {
    if (!csvText.trim()) { setError('CSVを入力してください'); return; }
    setLoading(true);
    setError('');
    setPreview(null);
    setSaveResult(null);
    try {
      const res = await fetch('/api/admin/people/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: csvText, commit: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'プレビューに失敗しました');
        return;
      }
      setPreview(data as PreviewResult);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  // ── 登録 ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!csvText.trim() || !preview || preview.addCount === 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/people/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: csvText, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '登録に失敗しました');
        return;
      }
      const result = data as SaveResult;
      setSaveResult(result);
      setImportedCount((prev) => prev + result.added.length);
      setPreview(null);
      setCsvText('');
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setCsvText('');
    setPreview(null);
    setSaveResult(null);
    setError('');
  }

  return (
    <div className="space-y-6">
      {/* 登録済み件数 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-3 flex items-center justify-between">
        <span className="text-sm text-indigo-700 font-medium">
          インポート済み人物: <strong>{importedCount}件</strong>
        </span>
        <a
          href="/admin/people/import"
          className="text-xs text-indigo-500 hover:underline"
          onClick={(e) => { e.preventDefault(); window.location.reload(); }}
        >
          一覧を更新
        </a>
      </div>

      {/* 成功メッセージ */}
      {saveResult && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
          <p className="font-bold text-green-800 mb-2">
            {saveResult.added.length}件を登録しました
          </p>
          {saveResult.added.length > 0 && (
            <div className="text-sm text-green-700 space-y-0.5">
              {saveResult.added.map((n) => (
                <div key={n}>✓ {n}</div>
              ))}
            </div>
          )}
          {saveResult.skipped.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              スキップ: {saveResult.skipped.join('、')}
            </p>
          )}
          {saveResult.errors.length > 0 && (
            <p className="text-xs text-red-600 mt-2">
              エラー: {saveResult.errors.join(' / ')}
            </p>
          )}
          <button
            onClick={handleReset}
            className="mt-3 text-xs text-green-600 underline hover:no-underline"
          >
            続けてインポートする
          </button>
        </div>
      )}

      {/* CSV入力エリア */}
      {!saveResult && (
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-slate-700 text-sm mb-1">CSV入力</h2>
            <p className="text-xs text-gray-500">
              列: <code className="bg-gray-100 px-1 rounded">name</code>（必須）、
              <code className="bg-gray-100 px-1 rounded">groupName</code>、
              <code className="bg-gray-100 px-1 rounded">genre</code>、
              <code className="bg-gray-100 px-1 rounded">aliases</code>、
              <code className="bg-gray-100 px-1 rounded">tmdbId</code>、
              <code className="bg-gray-100 px-1 rounded">description</code>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              aliases の区切り: <code>, 　、　|　/</code>　／　genre: 坂道 / 芸人 / テレビ / アーティスト / 俳優
            </p>
          </div>

          <div
            className="px-5 py-4"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <textarea
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); setPreview(null); setSaveResult(null); }}
              placeholder={SAMPLE_CSV}
              rows={10}
              className="w-full font-mono text-xs border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {/* ファイル選択 */}
              <label className="cursor-pointer px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                ファイルを選択
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFile}
                />
              </label>
              {/* サンプル挿入 */}
              <button
                type="button"
                onClick={() => { setCsvText(SAMPLE_CSV); setPreview(null); }}
                className="px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                サンプルを挿入
              </button>
              {csvText.trim() && (
                <button
                  type="button"
                  onClick={() => { setCsvText(''); setPreview(null); setError(''); }}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500"
                >
                  クリア
                </button>
              )}
              {/* プレビューボタン */}
              <button
                type="button"
                onClick={handlePreview}
                disabled={loading || !csvText.trim()}
                className="ml-auto px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                {loading ? '読み込み中…' : 'プレビュー'}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-5 pb-4">
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            </div>
          )}
        </div>
      )}

      {/* プレビュー結果 */}
      {preview && !saveResult && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* サマリー */}
          <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-4">
            <span className="font-bold text-slate-700 text-sm">プレビュー結果</span>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              新規追加 {preview.addCount}件
            </span>
            {preview.skipCount > 0 && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                スキップ {preview.skipCount}件
              </span>
            )}
            {preview.errorCount > 0 && (
              <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                エラー {preview.errorCount}件
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={loading || preview.addCount === 0}
              className="ml-auto px-5 py-1.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-40 transition-colors"
            >
              {loading ? '登録中…' : `${preview.addCount}件を登録する`}
            </button>
          </div>

          {/* テーブル */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium w-10">行</th>
                  <th className="px-3 py-2 font-medium">名前</th>
                  <th className="px-3 py-2 font-medium">グループ</th>
                  <th className="px-3 py-2 font-medium w-20">ジャンル</th>
                  <th className="px-3 py-2 font-medium">aliases</th>
                  <th className="px-3 py-2 font-medium w-16">TMDb ID</th>
                  <th className="px-3 py-2 font-medium w-24">ステータス</th>
                  <th className="px-3 py-2 font-medium">理由</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className={
                      row.action === 'error' ? 'bg-red-50' :
                      row.action === 'skip'  ? 'bg-gray-50 opacity-60' :
                      'hover:bg-indigo-50'
                    }
                  >
                    <td className="px-3 py-2 text-gray-400">{row.rowNum}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{row.name || '（空）'}</td>
                    <td className="px-3 py-2 text-gray-600">{row.group || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{row.genre}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {row.aliases.length > 0 ? row.aliases.join('、') : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {row.tmdbPersonId ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${ACTION_BADGE[row.action]}`}>
                        {ACTION_LABEL[row.action]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-400">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CSV 仕様メモ */}
      {!preview && !saveResult && (
        <details className="bg-gray-50 border border-gray-200 rounded-xl">
          <summary className="px-4 py-3 text-xs font-semibold text-gray-600 cursor-pointer select-none">
            CSV 仕様・ジャンル一覧
          </summary>
          <div className="px-4 pb-4 text-xs text-gray-500 space-y-2">
            <div>
              <p className="font-semibold text-gray-700 mb-1">必須列</p>
              <p><code className="bg-gray-100 px-1 rounded">name</code> — 人物名（重複は自動スキップ）</p>
            </div>
            <div>
              <p className="font-semibold text-gray-700 mb-1">任意列</p>
              <ul className="space-y-0.5 ml-2">
                <li><code className="bg-gray-100 px-1 rounded">groupName</code> — グループ名（例: 乃木坂46）</li>
                <li><code className="bg-gray-100 px-1 rounded">genre</code> — 坂道 / 芸人 / テレビ / アーティスト / 俳優</li>
                <li><code className="bg-gray-100 px-1 rounded">aliases</code> — 別名・愛称（区切り: , 、 | /）</li>
                <li><code className="bg-gray-100 px-1 rounded">tmdbId</code> — TMDb の person ID（数字）</li>
                <li><code className="bg-gray-100 px-1 rounded">description</code> — 説明・メモ</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-gray-700 mb-1">ジャンル推論（genre 列が空の場合）</p>
              <ul className="space-y-0.5 ml-2">
                <li>グループ名に「坂46」を含む → <strong>坂道</strong></li>
                <li>それ以外 → <strong>テレビ</strong>（手動で genre 列を指定推奨）</li>
              </ul>
            </div>
            <pre className="bg-white border border-gray-200 rounded p-2 overflow-x-auto leading-relaxed">
{`name,groupName,genre,aliases,tmdbId,description
賀喜遥香,乃木坂46,坂道,"かっきー,賀喜ちゃん",,
遠藤さくら,乃木坂46,坂道,さくちゃん|えんさく,,
吉本ばなな,,俳優,,,,小説家`}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}
