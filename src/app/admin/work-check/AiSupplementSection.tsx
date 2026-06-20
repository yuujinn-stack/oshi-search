'use client';

import { useState } from 'react';
import type { AiSupplementPreviewRow } from '@/app/api/admin/work-ai-supplement/route';

interface PersonInfo {
  name: string;
  group: string;
}

interface PreviewResult {
  addCount: number;
  previewRows: AiSupplementPreviewRow[];
}

interface CommitResult {
  savedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
}

export default function AiSupplementSection({ persons }: { persons: PersonInfo[] }) {
  const [selectedPerson, setSelectedPerson] = useState('');
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState('');

  // 結果をリセット
  function reset() {
    setPreview(null);
    setCommitResult(null);
    setError('');
  }

  // AI補完候補を取得（ドライラン）
  async function handleFetchSuggestions() {
    if (!selectedPerson) { setError('人物を選択してください'); return; }
    setLoading(true);
    reset();
    try {
      const res = await fetch('/api/admin/work-ai-supplement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName: selectedPerson, commit: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? '取得に失敗しました');
      } else {
        setPreview(data as PreviewResult);
      }
    } catch {
      setError('通信エラーが発生しました');
    }
    setLoading(false);
  }

  // 候補を作品として追加（コミット）
  async function handleCommit() {
    if (!preview || preview.addCount === 0) return;
    setCommitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/work-ai-supplement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName: selectedPerson, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? '追加に失敗しました');
      } else {
        setCommitResult(data as CommitResult);
        setPreview(null);
      }
    } catch {
      setError('通信エラーが発生しました');
    }
    setCommitting(false);
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-6 bg-white space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-700">AI補完候補 → 作品として追加</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          OpenAIにTMDbにない出演作品の補完候補を問い合わせ、確認後にDBへ追加します。
        </p>
        <div className="mt-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-[10px] text-amber-700 space-y-0.5">
          <p>・source = <span className="font-mono">ai_supplement</span>、status = <span className="font-mono">auto_published</span></p>
          <p>・既存作品と同タイトルはスキップ。VOD情報はこの機能では登録しません。</p>
          <p>・OpenAI API（gpt-4o-mini）を消費します。1人あたり数秒かかります。</p>
        </div>
      </div>

      {/* 人物選択 + 取得ボタン */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={selectedPerson}
          onChange={(e) => { setSelectedPerson(e.target.value); reset(); }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
        >
          <option value="">人物を選択してください</option>
          {persons.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <button
          onClick={handleFetchSuggestions}
          disabled={loading || !selectedPerson || committing}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50 font-medium"
        >
          {loading ? '取得中...' : '🤖 AI補完候補を取得'}
        </button>
        {(preview || commitResult) && (
          <button
            onClick={reset}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            クリア
          </button>
        )}
      </div>

      {/* ローディング中 */}
      {loading && (
        <div className="text-xs text-violet-600 bg-violet-50 rounded-lg px-3 py-2">
          OpenAIに問い合わせ中です。数秒かかります...
        </div>
      )}

      {/* エラー */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* コミット完了 */}
      {commitResult && (
        <div className="text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-2 space-y-0.5">
          <p className="font-semibold text-green-700">
            追加完了: {commitResult.savedCount}件を作品として追加しました
          </p>
          {commitResult.skippedCount > 0 && (
            <p className="text-gray-500">重複スキップ: {commitResult.skippedCount}件</p>
          )}
          {commitResult.failedCount > 0 && (
            <p className="text-red-600">失敗: {commitResult.failedCount}件</p>
          )}
          {commitResult.errors.length > 0 && (
            <p className="text-orange-600 text-[11px]">
              {commitResult.errors.slice(0, 3).join(' / ')}
            </p>
          )}
        </div>
      )}

      {/* プレビュー */}
      {preview && (
        <div className="space-y-3">
          {/* サマリー */}
          <div className="flex flex-wrap gap-2 text-xs items-center">
            <span className="font-semibold text-slate-600">{selectedPerson} の補完候補:</span>
            {preview.addCount === 0 ? (
              <span className="text-gray-500">新規候補なし（既存作品と重複または補完なし）</span>
            ) : (
              <span className="bg-violet-100 text-violet-700 px-2 py-1 rounded-lg font-medium">
                追加予定 {preview.addCount}件
              </span>
            )}
          </div>

          {/* 候補テーブル */}
          {preview.previewRows.length > 0 && (
            <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-gray-500">
                    <th className="text-left p-1.5 border-b border-gray-200">タイトル</th>
                    <th className="text-left p-1.5 border-b border-gray-200">種別</th>
                    <th className="text-left p-1.5 border-b border-gray-200">年</th>
                    <th className="text-left p-1.5 border-b border-gray-200">AI判定理由</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="p-1.5 text-slate-700 max-w-[200px] truncate font-medium" title={row.title}>
                        {row.title}
                      </td>
                      <td className="p-1.5 text-gray-500 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                          row.type === 'movie' ? 'bg-blue-100 text-blue-700' : 'bg-teal-100 text-teal-700'
                        }`}>
                          {row.type === 'movie' ? '映画' : 'TV'}
                        </span>
                      </td>
                      <td className="p-1.5 text-gray-400 whitespace-nowrap">
                        {row.releaseYear ?? '—'}
                      </td>
                      <td className="p-1.5 text-gray-400 max-w-[220px] truncate" title={row.reason}>
                        {row.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 追加ボタン */}
          {preview.addCount > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleCommit}
                disabled={committing}
                className="text-xs px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-bold transition-colors disabled:opacity-50"
              >
                {committing
                  ? '追加中...'
                  : `作品として追加（${preview.addCount}件）`
                }
              </button>
              <p className="text-[10px] text-gray-400">
                source=ai_supplement / status=auto_published で登録します
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
