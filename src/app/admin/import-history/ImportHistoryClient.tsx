'use client';

import { useState } from 'react';
import type { ImportHistorySummary, ImportHistory, ImportType, ImportStatus } from '@/lib/import-history';

const TYPE_LABEL: Record<ImportType, string> = {
  person_csv:    '人物CSV',
  work_vod_csv:  '作品・配信統合CSV',
  vod_title_csv: '配信情報CSV',
};
const TYPE_BADGE: Record<ImportType, string> = {
  person_csv:    'bg-indigo-100 text-indigo-700',
  work_vod_csv:  'bg-violet-100 text-violet-700',
  vod_title_csv: 'bg-teal-100 text-teal-700',
};
const STATUS_LABEL: Record<ImportStatus, string> = {
  completed:     '成功',
  partial_error: '一部失敗',
  failed:        '失敗',
};
const STATUS_BADGE: Record<ImportStatus, string> = {
  completed:     'bg-green-100 text-green-700',
  partial_error: 'bg-amber-100 text-amber-700',
  failed:        'bg-red-100 text-red-700',
};
const ACTION_LABEL = { success: '成功', skip: 'スキップ', error: 'エラー' };
const ACTION_COLOR = {
  success: 'text-green-600',
  skip:    'text-gray-400',
  error:   'text-red-500',
};

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}秒`;
}

function downloadCsv(csvContent: string, fileName: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

interface DetailModalProps {
  historyId: string;
  onClose: () => void;
}

function DetailModal({ historyId, onClose }: DetailModalProps) {
  const [detail, setDetail] = useState<ImportHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useState(() => {
    fetch(`/api/admin/import-history?id=${historyId}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800 text-base">インポート詳細</h2>
            {detail && (
              <p className="text-xs text-gray-500 mt-0.5">
                {formatDate(detail.executedAt)}　{TYPE_LABEL[detail.importType]}
                {detail.fileName && <span className="ml-2 text-gray-400">({detail.fileName})</span>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 py-12">読み込み中…</div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-red-400 py-12">詳細の読み込みに失敗しました</div>
        ) : (
          <>
            {/* サマリー */}
            <div className="px-6 py-4 border-b border-gray-100">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
                {[
                  { label: '合計', value: detail.totalRows, color: 'text-slate-700' },
                  { label: '成功', value: detail.successCount, color: 'text-green-700' },
                  { label: 'スキップ', value: detail.skipCount, color: 'text-gray-500' },
                  { label: '失敗', value: detail.errorCount, color: 'text-red-600' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-50 rounded-xl py-3">
                    <div className={`text-2xl font-black ${color}`}>{value}</div>
                    <div className="text-gray-400 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                <span>処理時間: {formatDuration(detail.durationMs)}</span>
                <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[detail.status]}`}>
                  {STATUS_LABEL[detail.status]}
                </span>
                {detail.csvContent && (
                  <button
                    onClick={() => downloadCsv(
                      detail.csvContent!,
                      detail.fileName ?? `import_${detail.historyId}.csv`,
                    )}
                    className="ml-auto px-3 py-1 text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    CSVを再ダウンロード
                  </button>
                )}
              </div>
            </div>

            {/* 行一覧 */}
            <div className="flex-1 overflow-y-auto">
              {detail.rows.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-gray-400">行データがありません</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-left text-gray-500">
                      <th className="px-4 py-2 font-medium w-8">#</th>
                      <th className="px-4 py-2 font-medium">名前 / 作品</th>
                      <th className="px-4 py-2 font-medium w-20">結果</th>
                      <th className="px-4 py-2 font-medium">理由</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.rows.map((row, i) => (
                      <tr key={i} className={row.action === 'error' ? 'bg-red-50' : row.action === 'skip' ? 'opacity-60' : ''}>
                        <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2 font-medium text-slate-700">{row.label}</td>
                        <td className="px-4 py-2">
                          <span className={`font-medium ${ACTION_COLOR[row.action]}`}>
                            {ACTION_LABEL[row.action]}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-400">{row.reason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface Props {
  initialList: ImportHistorySummary[];
}

export default function ImportHistoryClient({ initialList }: Props) {
  const [list, setList] = useState(initialList);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ImportType | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/import-history');
      const data = await res.json();
      setList(data.list ?? []);
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = filterType === 'all' ? list : list.filter((h) => h.importType === filterType);

  const typeCounts: Partial<Record<ImportType | 'all', number>> = {
    all: list.length,
    person_csv:    list.filter((h) => h.importType === 'person_csv').length,
    work_vod_csv:  list.filter((h) => h.importType === 'work_vod_csv').length,
    vod_title_csv: list.filter((h) => h.importType === 'vod_title_csv').length,
  };

  return (
    <>
      {selectedId && (
        <DetailModal historyId={selectedId} onClose={() => setSelectedId(null)} />
      )}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-slate-700 text-sm">
            インポート履歴
            <span className="ml-2 text-gray-400 font-normal text-xs">{list.length}件</span>
          </h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-indigo-500 hover:underline disabled:opacity-40"
          >
            {refreshing ? '更新中…' : '更新'}
          </button>
        </div>

        {/* フィルタータブ */}
        <div className="flex overflow-x-auto border-b border-gray-100 text-xs">
          {(
            [
              { key: 'all' as const,           label: 'すべて' },
              { key: 'person_csv' as const,    label: '人物CSV' },
              { key: 'work_vod_csv' as const,  label: '作品・配信CSV' },
              { key: 'vod_title_csv' as const, label: '配信情報CSV' },
            ]
          )
            .filter(({ key }) => key === 'all' || (typeCounts[key] ?? 0) > 0)
            .map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterType(key)}
                className={`px-4 py-2.5 whitespace-nowrap font-medium transition-colors border-b-2 ${
                  filterType === key
                    ? 'border-indigo-500 text-indigo-700 bg-indigo-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
                <span className="ml-1 text-gray-400">({typeCounts[key] ?? 0})</span>
              </button>
            ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-gray-400">
            履歴がありません
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-4 py-2 font-medium">実行日時</th>
                  <th className="px-4 py-2 font-medium">種別</th>
                  <th className="px-4 py-2 font-medium">ファイル名</th>
                  <th className="px-4 py-2 font-medium text-right">合計</th>
                  <th className="px-4 py-2 font-medium text-right">成功</th>
                  <th className="px-4 py-2 font-medium text-right">スキップ</th>
                  <th className="px-4 py-2 font-medium text-right">失敗</th>
                  <th className="px-4 py-2 font-medium">状態</th>
                  <th className="px-4 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((h) => (
                  <tr key={h.historyId} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      {formatDate(h.executedAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[h.importType]}`}>
                        {TYPE_LABEL[h.importType]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 max-w-[160px] truncate" title={h.fileName}>
                      {h.fileName ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-700">{h.totalRows}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 font-medium">{h.successCount}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{h.skipCount}</td>
                    <td className="px-4 py-2.5 text-right text-red-500 font-medium">{h.errorCount > 0 ? h.errorCount : '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[h.status]}`}>
                        {STATUS_LABEL[h.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => setSelectedId(h.historyId)}
                        className="px-2 py-1 text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors"
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
