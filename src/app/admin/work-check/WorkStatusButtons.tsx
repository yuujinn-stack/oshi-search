'use client';

import type { WorkRecord, WorkStatus } from '@/types/work';

interface WorkStatusButtonsProps {
  work: WorkRecord;
  debugMode: boolean;
  recheckingWorkId: string | null;
  testingWorkId: string | null;
  onVerdict: (workId: string, status: WorkStatus) => void;
  onVodRecheck: (workId: string) => void;
  onPriorityToggle: (workId: string, current: boolean) => void;
  onTestJudge: (work: WorkRecord) => void;
  onDelete: (workId: string) => void;
}

export default function WorkStatusButtons({
  work,
  debugMode,
  recheckingWorkId,
  testingWorkId,
  onVerdict,
  onVodRecheck,
  onPriorityToggle,
  onTestJudge,
  onDelete,
}: WorkStatusButtonsProps) {
  return (
    <div className="flex flex-col gap-1 flex-shrink-0">
      <button
        onClick={() => onVerdict(work.id, 'auto_published')}
        disabled={work.status === 'auto_published'}
        className="text-xs px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-40"
      >
        公開
      </button>
      <button
        onClick={() => onVerdict(work.id, 'needs_review')}
        disabled={work.status === 'needs_review'}
        className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200 text-yellow-700 disabled:opacity-40"
      >
        確認待ち
      </button>
      <button
        onClick={() => onVerdict(work.id, 'hidden')}
        disabled={work.status === 'hidden'}
        className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-40"
      >
        非表示
      </button>
      {work.tmdbId && (
        <button
          onClick={() => onVodRecheck(work.id)}
          disabled={recheckingWorkId === work.id || work.vodCheckStatus === 'checking'}
          title="OpenAI Web検索でこの作品の配信情報を再確認"
          className="text-xs px-2 py-1 rounded bg-violet-100 hover:bg-violet-200 text-violet-700 disabled:opacity-40"
        >
          {recheckingWorkId === work.id ? '確認中...' : '🔍 再確認'}
        </button>
      )}
      {work.tmdbId && (
        <button
          onClick={() => onPriorityToggle(work.id, work.priorityRecheck ?? false)}
          title={work.priorityRecheck ? '優先再確認フラグを解除' : 'Cronで優先的にAI再確認するフラグを設定'}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            work.priorityRecheck
              ? 'bg-red-100 hover:bg-red-200 text-red-600'
              : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
          }`}
        >
          {work.priorityRecheck ? '🚨 優先解除' : '優先設定'}
        </button>
      )}
      {debugMode && (
        <button
          onClick={() => onTestJudge(work)}
          disabled={testingWorkId === work.id}
          className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-40"
        >
          {testingWorkId === work.id ? '判定中...' : 'テスト'}
        </button>
      )}
      <button
        onClick={() => {
          if (window.confirm(`「${work.title}」を削除しますか？\n（削除済みとしてマークされ、公開ページから非表示になります）`)) {
            onDelete(work.id);
          }
        }}
        className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-500"
      >
        削除
      </button>
    </div>
  );
}
