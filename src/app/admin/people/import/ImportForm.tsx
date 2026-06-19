'use client';

import { useState, useRef } from 'react';
import type { PersonPreviewRow } from '@/app/api/admin/people/import/route';
import type { DataFetchStatus } from '@/lib/imported-persons';

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

const FETCH_STATUS_LABEL: Record<DataFetchStatus, string> = {
  not_started:   '未取得',
  processing:    '取得中',
  completed:     '取得完了',
  partial_error: '一部失敗',
  failed:        '失敗',
};
const FETCH_STATUS_COLOR: Record<DataFetchStatus, string> = {
  not_started:   'text-gray-400',
  processing:    'text-blue-600',
  completed:     'text-green-600',
  partial_error: 'text-amber-600',
  failed:        'text-red-600',
};

// ─── 型 ──────────────────────────────────────────────────────────────────────
type Phase = 'input' | 'preview' | 'fetching' | 'done';

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

interface FetchResult {
  name: string;
  status: DataFetchStatus;
  error?: string;
}

interface Props {
  initialCount: number;
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────
export default function ImportForm({ initialCount }: Props) {
  const [phase, setPhase]         = useState<Phase>('input');
  const [csvText, setCsvText]     = useState('');
  const [preview, setPreview]     = useState<PreviewResult | null>(null);
  const [autoFetch, setAutoFetch] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [importedCount, setImportedCount] = useState(initialCount);

  // 登録結果
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

  // 取得進捗
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [fetchResults, setFetchResults]   = useState<FetchResult[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  // ── ファイル読み込み ────────────────────────────────────────────────────────
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) ?? '');
      setPreview(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) ?? '');
      setPreview(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  // ── プレビュー ────────────────────────────────────────────────────────────
  async function handlePreview() {
    if (!csvText.trim()) { setError('CSVを入力してください'); return; }
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const res = await fetch('/api/admin/people/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: csvText, commit: false }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'プレビューに失敗しました'); return; }
      setPreview(data as PreviewResult);
      setPhase('preview');
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  // ── 単一人物の取得（fetch API 呼び出し）────────────────────────────────────
  async function fetchOnePerson(name: string): Promise<FetchResult> {
    try {
      const res = await fetch('/api/admin/people/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      return {
        name,
        status: (data.status as DataFetchStatus) ?? 'failed',
        error:  data.error,
      };
    } catch (err) {
      return { name, status: 'failed', error: String(err) };
    }
  }

  // ── 登録（+ 任意で自動取得）─────────────────────────────────────────────────
  async function handleSave() {
    if (!csvText.trim() || !preview || preview.addCount === 0) return;
    setLoading(true);
    setError('');
    try {
      // CSV 保存
      const res = await fetch('/api/admin/people/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: csvText, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '登録に失敗しました'); return; }

      const result = data as SaveResult;
      setSaveResult(result);
      setImportedCount((prev) => prev + result.added.length);
      setCsvText('');
      setPreview(null);

      // 自動取得
      if (autoFetch && result.added.length > 0) {
        setPhase('fetching');
        setFetchResults([]);
        const targets = result.added;

        for (let i = 0; i < targets.length; i++) {
          setFetchProgress({ current: i + 1, total: targets.length, name: targets[i] });
          const fr = await fetchOnePerson(targets[i]);
          setFetchResults((prev) => [...prev, fr]);
        }
        setFetchProgress(null);
      }

      setPhase('done');
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setPhase('input');
    setCsvText('');
    setPreview(null);
    setSaveResult(null);
    setFetchResults([]);
    setFetchProgress(null);
    setError('');
  }

  // ── 取得中 ───────────────────────────────────────────────────────────────
  if (phase === 'fetching' && fetchProgress) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center">
        <div className="text-blue-700 font-bold text-lg mb-2">
          データ取得中… {fetchProgress.current} / {fetchProgress.total}
        </div>
        <div className="text-sm text-blue-600 mb-4">{fetchProgress.name}</div>
        {/* プログレスバー */}
        <div className="w-full bg-blue-100 rounded-full h-2 mb-4">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(fetchProgress.current / fetchProgress.total) * 100}%` }}
          />
        </div>
        {/* これまでの結果 */}
        {fetchResults.length > 0 && (
          <div className="text-left mt-4 space-y-1 max-h-40 overflow-y-auto">
            {fetchResults.map((fr) => (
              <div key={fr.name} className="flex items-center gap-2 text-xs">
                <span className={FETCH_STATUS_COLOR[fr.status]}>
                  {fr.status === 'completed' ? '✓' : fr.status === 'partial_error' ? '△' : '✕'}
                </span>
                <span className="text-slate-700">{fr.name}</span>
                <span className={`text-xs ${FETCH_STATUS_COLOR[fr.status]}`}>
                  {FETCH_STATUS_LABEL[fr.status]}
                </span>
                {fr.error && (
                  <span className="text-red-400 truncate max-w-[200px]">{fr.error}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-blue-400 mt-3">処理を中断しないでください</p>
      </div>
    );
  }

  // ── 完了 ────────────────────────────────────────────────────────────────
  if (phase === 'done' && saveResult) {
    const fetchCompleted     = fetchResults.filter((r) => r.status === 'completed').length;
    const fetchPartialError  = fetchResults.filter((r) => r.status === 'partial_error').length;
    const fetchFailed        = fetchResults.filter((r) => r.status === 'failed').length;
    const fetchNotRun        = saveResult.added.length - fetchResults.length;
    const didFetch           = fetchResults.length > 0;

    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-4">
        <h2 className="font-bold text-green-800 text-base">登録完了</h2>

        {/* 登録サマリー */}
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div className="bg-white rounded-xl border border-green-100 py-3">
            <div className="text-2xl font-black text-green-700">{saveResult.added.length}</div>
            <div className="text-gray-500 mt-0.5">新規登録</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 py-3">
            <div className="text-2xl font-black text-gray-400">{saveResult.skipped.length}</div>
            <div className="text-gray-400 mt-0.5">スキップ</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 py-3">
            <div className="text-2xl font-black text-red-400">{saveResult.errors.length}</div>
            <div className="text-gray-400 mt-0.5">エラー</div>
          </div>
        </div>

        {/* 取得サマリー */}
        {didFetch && (
          <div className="bg-white rounded-xl border border-green-100 p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">データ取得結果</p>
            <div className="flex flex-wrap gap-3 text-xs">
              {fetchCompleted > 0 && (
                <span className="text-green-600 font-medium">✓ 取得完了 {fetchCompleted}件</span>
              )}
              {fetchPartialError > 0 && (
                <span className="text-amber-600 font-medium">△ 一部失敗 {fetchPartialError}件</span>
              )}
              {fetchFailed > 0 && (
                <span className="text-red-500 font-medium">✕ 失敗 {fetchFailed}件</span>
              )}
              {fetchNotRun > 0 && (
                <span className="text-gray-400">未取得 {fetchNotRun}件</span>
              )}
            </div>
            {/* エラー詳細 */}
            {fetchResults.filter((r) => r.error).length > 0 && (
              <div className="mt-2 space-y-0.5">
                {fetchResults
                  .filter((r) => r.error)
                  .map((r) => (
                    <p key={r.name} className="text-xs text-red-500">
                      {r.name}: {r.error}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}

        {!didFetch && saveResult.added.length > 0 && (
          <p className="text-xs text-gray-500">
            ページ下部の人物一覧から「データ取得」ボタンで出演作品・楽天商品を取得できます。
          </p>
        )}

        {/* アクション */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors"
          >
            続けてインポートする
          </button>
          <a
            href="/admin/product-check"
            className="px-4 py-2 text-sm text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            商品確認画面
          </a>
          <a
            href="/admin/work-check"
            className="px-4 py-2 text-sm text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            作品確認画面
          </a>
        </div>
      </div>
    );
  }

  // ── 入力 / プレビュー 画面 ────────────────────────────────────────────────
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

      {/* CSV入力エリア */}
      {phase === 'input' && (
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
              onChange={(e) => { setCsvText(e.target.value); setPreview(null); }}
              placeholder={SAMPLE_CSV}
              rows={10}
              className="w-full font-mono text-xs border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
            />
            <div className="flex flex-wrap items-center gap-2 mt-2">
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
      {phase === 'preview' && preview && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* サマリー + 登録ボタン */}
          <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
            <button
              onClick={() => { setPhase('input'); setPreview(null); }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              ← 戻る
            </button>
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

            {/* 自動取得チェックボックス + 登録ボタン */}
            <div className="ml-auto flex items-center gap-3 flex-shrink-0">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoFetch}
                  onChange={(e) => setAutoFetch(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span className="text-xs text-gray-600">登録後すぐデータ取得</span>
              </label>
              <button
                onClick={handleSave}
                disabled={loading || preview.addCount === 0}
                className="px-5 py-1.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-40 transition-colors"
              >
                {loading ? '登録中…' : `${preview.addCount}件を登録する`}
              </button>
            </div>
          </div>

          {autoFetch && (
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
              登録後、楽天商品（AI判定含む）と TMDb 出演作品を順番に取得します。
              人数が多い場合は数分かかります。
            </div>
          )}

          {error && (
            <div className="px-5 py-2 bg-red-50 border-b border-red-100">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

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
                    <td className="px-3 py-2 text-gray-400">{row.tmdbPersonId ?? '—'}</td>
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
      {phase === 'input' && !preview && (
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
吉本ばなな,,俳優,,,小説家`}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}
