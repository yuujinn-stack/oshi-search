'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import type { WorkDedupGroup, WorkDedupStats, WorkDuplicateConfidence } from '@/lib/work-dedup';
import type { Pagination } from '@/app/api/admin/work-dedup/candidates/lib';
import {
  type ReviewApiData,
  type ReviewStats,
  type ReviewStatus,
  REVIEW_NOTE_MAX_LENGTH,
} from '@/lib/work-dedup-review';
import type { ApplyPreview } from '@/lib/work-dedup-apply';

// ─── 型 ────────────────────────────────────────────────────────────────────────

interface ApiResponse {
  groups:      WorkDedupGroup[];
  stats:       WorkDedupStats;
  pagination:  Pagination;
  reviews:     Record<string, ReviewApiData>;
  reviewStats: ReviewStats;
  applyEnabled: boolean;
}

interface ApiError {
  ok: false;
  error: { code: string; message: string };
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: ApiResponse }
  | { status: 'error'; code: string; httpStatus: number };

type ReviewFilterStatus = 'all' | 'pending' | 'approved_duplicate' | 'rejected_distinct' | 'on_hold' | 'stale';

/** 各グループの編集中状態（DB 保存前） */
interface EditState {
  status:      ReviewStatus;
  canonicalId: string;
  note:        string;
  saving:      boolean;
  savedAt:     string | null;
  saveError:   string | null;
  /** conflict 承認時の確認チェック */
  conflictAck: boolean;
}

// ─── 信頼度バッジ定義（WCAG AA 相当） ───────────────────────────────────────────

const CONFIDENCE_BADGE: Record<WorkDuplicateConfidence, { bg: string; text: string; label: string }> = {
  exact:    { bg: 'bg-red-800',    text: 'text-red-100',    label: 'EXACT'    },
  high:     { bg: 'bg-orange-800', text: 'text-orange-100', label: 'HIGH'     },
  medium:   { bg: 'bg-yellow-700', text: 'text-yellow-50',  label: 'MEDIUM'   },
  low:      { bg: 'bg-slate-600',  text: 'text-slate-100',  label: 'LOW'      },
  conflict: { bg: 'bg-slate-700',  text: 'text-slate-200',  label: 'CONFLICT' },
};

const CONFIDENCE_BORDER: Record<WorkDuplicateConfidence, string> = {
  exact:    'border-red-700',
  high:     'border-orange-700',
  medium:   'border-yellow-600',
  low:      'border-slate-500',
  conflict: 'border-slate-600',
};

const ALL_CONFIDENCES: WorkDuplicateConfidence[] = ['exact', 'high', 'medium', 'low', 'conflict'];

// ─── レビュー状態バッジ ────────────────────────────────────────────────────────

const REVIEW_STATUS_LABEL: Record<ReviewStatus | 'stale', string> = {
  pending:             '未判定',
  approved_duplicate:  '同一作品として承認済み',
  rejected_distinct:   '別作品として却下済み',
  on_hold:             '保留中',
  stale:               '候補変更により再確認が必要',
};

const REVIEW_STATUS_BADGE: Record<ReviewStatus | 'stale', string> = {
  pending:             'bg-slate-700 text-slate-300',
  approved_duplicate:  'bg-emerald-800 text-emerald-100',
  rejected_distinct:   'bg-red-900 text-red-200',
  on_hold:             'bg-yellow-800 text-yellow-100',
  stale:               'bg-orange-900 text-orange-200',
};

function getDisplayStatus(review: ReviewApiData | undefined): ReviewStatus | 'stale' {
  if (!review) return 'pending';
  if (review.stale) return 'stale';
  return review.reviewStatus;
}

// ─── 統計バー ───────────────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: WorkDedupStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {[
        { label: '全DBレコード',   value: stats.totalWorkRecords },
        { label: 'ユニークworkId', value: stats.uniqueWorkIds },
        { label: '候補グループ数', value: stats.duplicateCandidateGroups },
        { label: '候補作品数',     value: stats.duplicateCandidateWorks },
        { label: 'exact',          value: stats.exactGroups },
        { label: 'high',           value: stats.highGroups },
        { label: 'medium',         value: stats.mediumGroups },
        { label: 'conflict',       value: stats.conflictGroups },
      ].map(({ label, value }) => (
        <div key={label} className="bg-slate-800 rounded p-3 border border-slate-600">
          <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
          <div className="text-xs text-slate-300 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── レビュー進捗バー ──────────────────────────────────────────────────────────

function ReviewProgressBar({ rs }: { rs: ReviewStats }) {
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white">レビュー進捗</span>
        <span className="text-sm text-slate-300">{rs.completionRate}% 完了</span>
      </div>
      {/* プログレスバー */}
      <div className="w-full h-2 bg-slate-600 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${rs.completionRate}%` }}
          aria-valuenow={rs.completionRate}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
        {[
          { label: '全候補',      value: rs.total,    cls: 'text-slate-200' },
          { label: '未判定',      value: rs.pending,  cls: 'text-slate-300' },
          { label: '承認済み',    value: rs.approved, cls: 'text-emerald-300' },
          { label: '却下済み',    value: rs.rejected, cls: 'text-red-300' },
          { label: '保留',        value: rs.onHold,   cls: 'text-yellow-300' },
          { label: '再確認必要',  value: rs.stale,    cls: 'text-orange-300' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="text-center">
            <div className={`text-lg font-bold ${cls}`}>{value}</div>
            <div className="text-slate-400">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── セクション見出し ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-slate-300 uppercase tracking-widest mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── レビューフォーム ─────────────────────────────────────────────────────────

interface ReviewFormProps {
  groupId:           string;
  confidence:        WorkDuplicateConfidence;
  entries:           WorkDedupGroup['entries'];
  recommendedWorkId: string | null;
  review:            ReviewApiData | undefined;
  edit:              EditState;
  onChange:          (groupId: string, partial: Partial<EditState>) => void;
  onSave:            (groupId: string) => Promise<void>;
}

function ReviewForm({
  groupId, confidence, entries, recommendedWorkId, review, edit, onChange, onSave,
}: ReviewFormProps) {
  const isConflict = confidence === 'conflict';
  const displayStatus = getDisplayStatus(review);

  const handleStatusClick = (s: ReviewStatus) => {
    onChange(groupId, { status: s, conflictAck: false, saveError: null });
  };

  return (
    <div className="border border-slate-600 rounded-lg p-4 bg-slate-900 space-y-4">
      {/* 注意書き */}
      <p className="text-xs text-slate-400 italic">
        この操作はレビュー結果だけを保存します。作品データは統合されません。
      </p>

      {/* 現在の保存済み状態バッジ */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">現在の状態:</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${REVIEW_STATUS_BADGE[displayStatus]}`}>
          {REVIEW_STATUS_LABEL[displayStatus]}
        </span>
        {review?.reviewedAt && (
          <span className="text-xs text-slate-500">
            ({new Date(review.reviewedAt).toLocaleString('ja-JP')})
          </span>
        )}
      </div>

      {/* stale 警告 */}
      {displayStatus === 'stale' && (
        <div className="text-xs text-orange-200 bg-orange-950 border border-orange-700 rounded px-3 py-2">
          候補内の作品構成またはアルゴリズムバージョンが変更されました。内容を確認のうえ再判定してください。
        </div>
      )}

      {/* 状態ボタン */}
      <div>
        <div className="text-xs text-slate-400 mb-2">判定を選択してください</div>
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ['pending',            '未判定に戻す',       'bg-slate-700 text-slate-200 border-slate-500'],
              ['approved_duplicate', '同一作品として承認',  'bg-emerald-800 text-emerald-100 border-emerald-600'],
              ['rejected_distinct',  '別作品として却下',    'bg-red-900 text-red-200 border-red-700'],
              ['on_hold',            '保留',               'bg-yellow-800 text-yellow-100 border-yellow-600'],
            ] as const
          ).map(([s, label, cls]) => (
            <button
              key={s}
              type="button"
              onClick={() => handleStatusClick(s)}
              aria-pressed={edit.status === s}
              className={`text-xs px-3 py-1.5 rounded border font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                edit.status === s
                  ? cls + ' ring-2 ring-white ring-offset-1 ring-offset-slate-900'
                  : 'bg-slate-800 text-slate-300 border-slate-600 hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* conflict + 承認時の警告 */}
      {isConflict && edit.status === 'approved_duplicate' && (
        <div className="bg-yellow-950 border border-yellow-700 rounded px-3 py-3 space-y-2">
          <p className="text-xs text-yellow-200 font-semibold">
            ⚠ このグループには矛盾があります（公開年・作品種別・外部IDなど）。
            本当に同一作品として承認しますか？
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={edit.conflictAck}
              onChange={(e) => onChange(groupId, { conflictAck: e.target.checked })}
              className="accent-yellow-400"
            />
            <span className="text-xs text-yellow-300">矛盾を確認したうえで承認する</span>
          </label>
        </div>
      )}

      {/* canonical 選択（approved_duplicate 時のみ） */}
      {edit.status === 'approved_duplicate' && (
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            統合先canonical workId を選択
            <span className="text-red-400 ml-1">*必須</span>
          </label>
          <select
            value={edit.canonicalId}
            onChange={(e) => onChange(groupId, { canonicalId: e.target.value })}
            className="w-full bg-slate-800 border border-slate-500 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">選択してください</option>
            {entries.map((e) => (
              <option key={e.workId} value={e.workId}>
                {e.workId} ／ {e.title} ／ {e.type} ／ {e.releaseYear ?? '年不明'} ／ TMDb:{e.tmdbId ?? '—'}
                {e.workId === recommendedWorkId ? ' ★推奨' : ''}
              </option>
            ))}
          </select>
          {edit.canonicalId === recommendedWorkId && (
            <p className="text-xs text-emerald-400 mt-1">★ システム推奨候補が選択されています</p>
          )}
          {edit.canonicalId && edit.canonicalId !== recommendedWorkId && (
            <p className="text-xs text-slate-400 mt-1">管理者が手動で選択しました（推奨候補とは異なります）</p>
          )}
        </div>
      )}

      {/* 管理メモ */}
      <div>
        <label className="text-xs text-slate-400 block mb-1">
          管理メモ（任意・最大 {REVIEW_NOTE_MAX_LENGTH} 文字）
        </label>
        <textarea
          value={edit.note}
          onChange={(e) => onChange(groupId, { note: e.target.value })}
          maxLength={REVIEW_NOTE_MAX_LENGTH}
          rows={2}
          placeholder="判定の根拠や補足情報を記入..."
          className="w-full bg-slate-800 border border-slate-500 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <div className="text-xs text-slate-500 text-right">{edit.note.length}/{REVIEW_NOTE_MAX_LENGTH}</div>
      </div>

      {/* エラー */}
      {edit.saveError && (
        <div role="alert" className="text-xs text-red-200 bg-red-950 border border-red-700 rounded px-3 py-2">
          保存に失敗しました: {edit.saveError}
        </div>
      )}

      {/* 保存成功 */}
      {edit.savedAt && !edit.saveError && (
        <div className="text-xs text-emerald-300">
          ✓ 保存しました ({new Date(edit.savedAt).toLocaleString('ja-JP')})
        </div>
      )}

      {/* 保存ボタン */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onSave(groupId)}
          disabled={
            edit.saving ||
            (edit.status === 'approved_duplicate' && !edit.canonicalId) ||
            (isConflict && edit.status === 'approved_duplicate' && !edit.conflictAck)
          }
          className="text-sm px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded border border-blue-600 disabled:border-slate-600 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed"
        >
          {edit.saving ? '保存中…' : '保存'}
        </button>
        {edit.status === 'approved_duplicate' && !edit.canonicalId && (
          <span className="text-xs text-yellow-300">canonical を選択してください</span>
        )}
      </div>
    </div>
  );
}

// ─── 統合プレビューモーダル ───────────────────────────────────────────────────────

interface ApplyModalProps {
  groupId:         string;
  review:          ReviewApiData;
  preview:         ApplyPreview;
  applyEnabled:    boolean;
  onClose:         () => void;
  onApplySuccess:  () => void;
}

function ApplyModal({ groupId, review, preview, applyEnabled, onClose, onApplySuccess }: ApplyModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyDone, setApplyDone] = useState(false);

  const canSubmit =
    applyEnabled &&
    !applying &&
    !applyDone &&
    !preview.alreadyApplied &&
    !preview.isStale &&
    confirmText === '統合を実行';

  async function handleApply() {
    if (!canSubmit) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/admin/work-dedup/reviews/${groupId}/apply`, {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({
          confirmationText:         '統合を実行',
          expectedCanonicalWorkId:  preview.canonicalWorkId,
          expectedCandidateWorkIds: preview.currentWorkIds,
          expectedUpdatedAt:        review.updatedAt,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: { code: string; message: string } };
      if (!res.ok || !json.ok) {
        setApplyError(json.error?.message ?? `HTTP ${res.status}`);
        setApplying(false);
        return;
      }
      setApplyDone(true);
      setApplying(false);
      onApplySuccess();
    } catch {
      setApplyError('ネットワークエラーが発生しました');
      setApplying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="統合プレビュー"
    >
      <div className="bg-slate-800 border border-slate-600 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-600">
          <h2 className="text-white font-bold text-base">統合プレビュー</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl font-bold focus:outline-none focus:ring-2 focus:ring-slate-400 rounded px-1"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* already applied */}
          {preview.alreadyApplied && (
            <div className="bg-emerald-950 border border-emerald-700 rounded px-3 py-2 text-emerald-200 text-sm">
              このグループは適用済みです（適用日時: {preview.appliedAt ? new Date(preview.appliedAt).toLocaleString('ja-JP') : '不明'}）
            </div>
          )}

          {/* stale 警告 */}
          {preview.isStale && (
            <div className="bg-orange-950 border border-orange-700 rounded px-3 py-2 text-orange-200 text-sm">
              候補グループの構成が変更されました。再度プレビューを取得してください。
            </div>
          )}

          {/* 統合先 */}
          <div>
            <div className="text-xs text-slate-400 mb-1">canonical workId（統合先）</div>
            <div className="text-sm text-white font-mono bg-slate-900 rounded px-2 py-1">{preview.canonicalWorkId}</div>
          </div>

          {/* 重複workIds */}
          <div>
            <div className="text-xs text-slate-400 mb-1">統合対象（廃止）workId</div>
            <div className="space-y-1">
              {preview.duplicateWorkIds.map((id) => (
                <div key={id} className="text-sm text-red-300 font-mono bg-slate-900 rounded px-2 py-1">{id}</div>
              ))}
            </div>
          </div>

          {/* 統計 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {[
              { label: '人物リンク移動',    value: preview.personLinkChanges.filter((c) => c.action === 'move').length },
              { label: '人物リンク重複除去', value: preview.personLinkChanges.filter((c) => c.action === 'remove').length },
              { label: 'VOD追加数',          value: preview.vodProvidersMergedCount },
              { label: 'alias作成数',        value: preview.aliasesToCreate.length },
              { label: '非活性化work数',     value: preview.worksToDeactivate.length },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-700 rounded p-2 border border-slate-600">
                <div className="text-slate-300">{label}</div>
                <div className="text-white font-bold text-sm mt-0.5">{value}</div>
              </div>
            ))}
          </div>

          {/* APPLY_DISABLED 警告 */}
          {!applyEnabled && (
            <div className="bg-yellow-950 border border-yellow-700 rounded px-3 py-2 text-yellow-200 text-sm">
              現在、統合実行は無効です（WORK_DEDUP_APPLY_ENABLED=false）。プレビューのみ確認できます。
            </div>
          )}

          {/* 確認入力 + 実行ボタン */}
          {applyEnabled && !preview.alreadyApplied && !preview.isStale && (
            <div className="space-y-3 border-t border-slate-600 pt-3">
              <p className="text-xs text-yellow-200">
                この操作は元に戻せません。「統合を実行」と入力して確定してください。
              </p>
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  確認テキスト（「統合を実行」と入力）
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="統合を実行"
                  className="w-full bg-slate-900 border border-slate-500 rounded px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {applyError && (
                <div role="alert" className="text-xs text-red-200 bg-red-950 border border-red-700 rounded px-3 py-2">
                  エラー: {applyError}
                </div>
              )}

              {applyDone && (
                <div className="text-xs text-emerald-300 bg-emerald-950 border border-emerald-700 rounded px-3 py-2">
                  統合が完了しました。ページを再読み込みしてください。
                </div>
              )}

              <button
                type="button"
                onClick={handleApply}
                disabled={!canSubmit}
                className="w-full text-sm px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded border border-red-600 disabled:border-slate-600 font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed"
              >
                {applying ? '統合実行中…' : 'この1グループを統合する'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── グループカード ─────────────────────────────────────────────────────────────

interface GroupCardProps {
  group:       WorkDedupGroup;
  review:      ReviewApiData | undefined;
  edit:        EditState;
  applyEnabled: boolean;
  onChange:    (groupId: string, partial: Partial<EditState>) => void;
  onSave:      (groupId: string) => Promise<void>;
  onReload:    () => void;
}

function GroupCard({ group, review, edit, applyEnabled, onChange, onSave, onReload }: GroupCardProps) {
  const [open, setOpen] = useState(false);
  const [applyPreview, setApplyPreview] = useState<ApplyPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const detailId = useId();
  const plan = group.mergePlan;
  const badge = CONFIDENCE_BADGE[group.confidence];
  const displayStatus = getDisplayStatus(review);

  // 「統合プレビューを確認」ボタンの表示条件
  const canShowApplyButton =
    review?.reviewStatus === 'approved_duplicate' &&
    review?.selectedCanonicalWorkId &&
    !review?.stale &&
    !review?.appliedAt;

  async function handleOpenPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/admin/work-dedup/reviews/${group.groupId}/apply-preview`, {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
      });
      const json = await res.json() as { ok: boolean; preview?: ApplyPreview; error?: { code: string; message: string } };
      if (!res.ok || !json.ok) {
        setPreviewError(json.error?.message ?? `HTTP ${res.status}`);
        setPreviewLoading(false);
        return;
      }
      setApplyPreview(json.preview!);
      setShowModal(true);
    } catch {
      setPreviewError('ネットワークエラーが発生しました');
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <>
    {showModal && applyPreview && review && (
      <ApplyModal
        groupId={group.groupId}
        review={review}
        preview={applyPreview}
        applyEnabled={applyEnabled}
        onClose={() => setShowModal(false)}
        onApplySuccess={() => { setShowModal(false); onReload(); }}
      />
    )}
    <div className={`border rounded-lg bg-slate-800 overflow-hidden ${CONFIDENCE_BORDER[group.confidence]}`}>
      {/* ヘッダー */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400"
      >
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 ${badge.bg} ${badge.text}`}
          aria-label={`信頼度: ${group.confidence}`}
        >
          {badge.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm truncate">
            {group.entries[0]?.title ?? '（タイトル不明）'}
          </div>
          <div className="text-xs text-slate-300 mt-0.5">
            {group.entries.length}件の候補 ·{' '}
            {group.entries.map((e) => e.workId).join(', ')}
          </div>
        </div>
        {/* レビュー状態バッジ */}
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5 ${REVIEW_STATUS_BADGE[displayStatus]}`}>
          {REVIEW_STATUS_LABEL[displayStatus]}
        </span>
        <span className="text-slate-300 text-sm mt-0.5" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* 展開コンテンツ */}
      {open && (
        <div
          id={detailId}
          className="px-4 pb-5 border-t border-slate-600 pt-4 space-y-5"
        >
          {/* 判定根拠 */}
          {group.reasons.length > 0 && (
            <Section title="判定根拠">
              <ul className="text-sm text-slate-100 space-y-1 list-disc list-inside">
                {group.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </Section>
          )}

          {/* 矛盾点 */}
          {group.conflicts.length > 0 && (
            <Section title="矛盾点 / 要確認">
              <ul className="text-sm text-yellow-200 space-y-1 list-disc list-inside">
                {group.conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </Section>
          )}

          {/* 候補作品比較表 */}
          <Section title="候補作品">
            <div className="overflow-x-auto rounded border border-slate-600">
              <table className="text-xs w-full min-w-[700px]">
                <thead className="bg-slate-700">
                  <tr className="border-b border-slate-600">
                    {['workId', 'タイトル', '種別', '年', 'TMDb', 'ソース', '人物数', 'VOD', 'ステータス', '推奨/選択'].map((h) => (
                      <th key={h} className="text-left py-2 px-3 font-semibold text-slate-200 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {group.entries.map((e) => {
                    const isRecommended = e.workId === group.canonicalRecommendation.recommendedWorkId;
                    const isSelected    = e.workId === review?.selectedCanonicalWorkId;
                    const isEditing     = e.workId === edit.canonicalId;
                    return (
                      <tr key={e.workId} className={isRecommended ? 'bg-emerald-900/40' : ''}>
                        <td className="py-2 px-3 font-mono text-[11px] break-all text-slate-100">{e.workId}</td>
                        <td className="py-2 px-3 max-w-[160px] text-slate-100 truncate">{e.title}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.type}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.releaseYear ?? '—'}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.tmdbId ?? '—'}</td>
                        <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{e.source}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.personLinkCount}</td>
                        <td className="py-2 px-3 text-slate-200 whitespace-nowrap">{e.vodCount}</td>
                        <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{e.status}</td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {isRecommended && (
                            <span className="inline-block text-[9px] bg-emerald-700 text-emerald-100 px-1 py-0.5 rounded font-bold">★推奨</span>
                          )}
                          {isSelected && !isEditing && (
                            <span className="inline-block text-[9px] bg-blue-700 text-blue-100 px-1 py-0.5 rounded font-bold ml-1">保存済み</span>
                          )}
                          {isEditing && edit.status === 'approved_duplicate' && (
                            <span className="inline-block text-[9px] bg-indigo-700 text-indigo-100 px-1 py-0.5 rounded font-bold ml-1">選択中</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 統合計画（dry-run） */}
          <Section title="統合計画（dry-run / DB・Redis変更なし）">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {[
                { label: '人物リンク移動',      value: plan.personLinksToMove },
                { label: '人物リンク重複除去',  value: plan.personLinksToDeduplicate },
                { label: 'VOD移動',             value: plan.vodRecordsToMove },
                { label: 'VOD重複除去',         value: plan.vodRecordsToDeduplicate },
                { label: 'redirect作成',        value: plan.redirectsToCreate },
                { label: 'Redisランキング更新', value: plan.rankingEntriesToUpdate },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-700 rounded p-2 border border-slate-600">
                  <div className="text-slate-300">{label}</div>
                  <div className="text-white font-bold text-sm mt-0.5">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 bg-slate-600 border border-slate-400 text-white text-xs font-bold px-2 py-1 rounded">
                統合計画（参考値）
              </span>
            </div>
          </Section>

          {/* 統合プレビューボタン */}
          {canShowApplyButton && (
            <Section title="統合実行">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleOpenPreview}
                  disabled={previewLoading}
                  className="text-sm px-4 py-2 bg-amber-700 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-slate-400 text-white rounded border border-amber-600 disabled:border-slate-600 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed"
                >
                  {previewLoading ? 'プレビュー取得中…' : '統合プレビューを確認'}
                </button>
                {!applyEnabled && (
                  <p className="text-xs text-yellow-300">
                    現在、統合実行は無効です（WORK_DEDUP_APPLY_ENABLED=false）
                  </p>
                )}
                {previewError && (
                  <div role="alert" className="text-xs text-red-200 bg-red-950 border border-red-700 rounded px-3 py-2">
                    プレビュー取得エラー: {previewError}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* レビューフォーム */}
          <Section title="レビュー判定">
            <ReviewForm
              groupId={group.groupId}
              confidence={group.confidence}
              entries={group.entries}
              recommendedWorkId={group.canonicalRecommendation.recommendedWorkId}
              review={review}
              edit={edit}
              onChange={onChange}
              onSave={onSave}
            />
          </Section>
        </div>
      )}
    </div>
    </>
  );
}

// ─── ページネーション ────────────────────────────────────────────────────────────

function PaginationBar({
  pagination,
  onPage,
}: {
  pagination: Pagination;
  onPage: (page: number) => void;
}) {
  const { page, totalPages, total, limit } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  return (
    <nav aria-label="ページネーション" className="flex items-center justify-between mt-4 text-xs text-slate-300">
      <span>{total === 0 ? '0件' : `${from}–${to} / ${total}件`}</span>
      <div className="flex gap-1 items-center">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="前のページ"
          className="px-2 py-1 rounded border border-slate-500 text-slate-200 disabled:opacity-40 hover:bg-slate-700 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          ←
        </button>
        <span className="px-3 py-1 text-slate-200">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="次のページ"
          className="px-2 py-1 rounded border border-slate-500 text-slate-200 disabled:opacity-40 hover:bg-slate-700 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          →
        </button>
      </div>
    </nav>
  );
}

// ─── 編集状態の初期値を生成 ──────────────────────────────────────────────────────

function makeInitialEdit(review: ReviewApiData | undefined, recommendedWorkId: string | null): EditState {
  const stale = review?.stale ?? false;
  return {
    status:      stale ? 'pending' : (review?.reviewStatus ?? 'pending'),
    canonicalId: !stale && review?.selectedCanonicalWorkId
      ? review.selectedCanonicalWorkId
      : (recommendedWorkId ?? ''),
    note:        !stale ? (review?.reviewerNote ?? '') : '',
    saving:      false,
    savedAt:     null,
    saveError:   null,
    conflictAck: false,
  };
}

// ─── メインクライアント ──────────────────────────────────────────────────────────

export default function WorkDedupClient() {
  const [fetchState,    setFetchState]    = useState<FetchState>({ status: 'idle' });
  const [editMap,       setEditMap]       = useState<Record<string, EditState>>({});
  const [confidence,    setConfidence]    = useState<WorkDuplicateConfidence | 'all'>('all');
  const [reviewFilter,  setReviewFilter]  = useState<ReviewFilterStatus>('all');
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchInput,   setSearchInput]   = useState('');
  const [page,          setPage]          = useState(1);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    if (confidence !== 'all') params.set('confidence', confidence);
    if (searchQuery)          params.set('q', searchQuery);
    if (reviewFilter !== 'all') params.set('reviewStatus', reviewFilter);
    return `/api/admin/work-dedup/candidates?${params.toString()}`;
  }, [page, confidence, searchQuery, reviewFilter]);

  const load = useCallback(async () => {
    setFetchState({ status: 'loading' });
    try {
      const res = await fetch(buildUrl(), { credentials: 'same-origin' });
      if (!res.ok) {
        let code = 'HTTP_ERROR';
        try {
          const body = (await res.json()) as ApiError;
          code = body?.error?.code ?? 'HTTP_ERROR';
        } catch { /* ignore */ }
        setFetchState({ status: 'error', code, httpStatus: res.status });
        return;
      }
      const data = (await res.json()) as ApiResponse;
      setFetchState({ status: 'ok', data });

      // レビュー状態に基づいて editMap を初期化（既存のローカル編集は保持しない）
      setEditMap((prev) => {
        const next = { ...prev };
        for (const group of data.groups) {
          if (!next[group.groupId]) {
            const review = data.reviews[group.groupId];
            next[group.groupId] = makeInitialEdit(review, group.canonicalRecommendation.recommendedWorkId);
          }
        }
        return next;
      });
    } catch {
      setFetchState({ status: 'error', code: 'NETWORK_ERROR', httpStatus: 0 });
    }
  }, [buildUrl]);

  useEffect(() => { load(); }, [load]);

  function commitSearch() {
    setSearchQuery(searchInput);
    setPage(1);
  }

  function handleConfidenceChange(c: WorkDuplicateConfidence | 'all') {
    setConfidence(c);
    setPage(1);
  }

  function handleReviewFilterChange(r: ReviewFilterStatus) {
    setReviewFilter(r);
    setPage(1);
  }

  function handleEditChange(groupId: string, partial: Partial<EditState>) {
    setEditMap((prev) => ({
      ...prev,
      [groupId]: { ...prev[groupId], ...partial },
    }));
  }

  async function handleSave(groupId: string) {
    const edit = editMap[groupId];
    if (!edit || edit.saving) return;

    // ローカル検証
    if (edit.status === 'approved_duplicate' && !edit.canonicalId) return;

    setEditMap((prev) => ({
      ...prev,
      [groupId]: { ...prev[groupId], saving: true, saveError: null },
    }));

    try {
      const body: Record<string, unknown> = {
        reviewStatus: edit.status,
        reviewerNote: edit.note || null,
      };
      if (edit.status === 'approved_duplicate') {
        body.selectedCanonicalWorkId = edit.canonicalId;
      }

      const res = await fetch(`/api/admin/work-dedup/reviews/${groupId}`, {
        method:      'PUT',
        credentials: 'same-origin',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(body),
      });

      const json = (await res.json()) as { ok: boolean; data?: ReviewApiData; error?: { code: string; message: string } };

      if (!res.ok || !json.ok) {
        const msg = json.error?.message ?? `HTTP ${res.status}`;
        setEditMap((prev) => ({
          ...prev,
          [groupId]: { ...prev[groupId], saving: false, saveError: msg },
        }));
        return;
      }

      const savedReview = json.data!;
      const savedAt = new Date().toISOString();

      // 保存成功 → fetchState の reviews も更新
      setFetchState((prev) => {
        if (prev.status !== 'ok') return prev;
        const nextReviews = { ...prev.data.reviews, [groupId]: savedReview };
        // reviewStats の再計算（簡易）
        const approvedCount  = Object.values(nextReviews).filter((r) => !r.stale && r.reviewStatus === 'approved_duplicate').length;
        const rejectedCount  = Object.values(nextReviews).filter((r) => !r.stale && r.reviewStatus === 'rejected_distinct').length;
        const onHoldCount    = Object.values(nextReviews).filter((r) => !r.stale && r.reviewStatus === 'on_hold').length;
        const staleCount     = Object.values(nextReviews).filter((r) => r.stale).length;
        const total          = prev.data.reviewStats.total;
        const reviewed       = approvedCount + rejectedCount + onHoldCount;
        const pending        = total - reviewed - staleCount;
        const completionRate = total > 0 ? Math.round((reviewed / total) * 100) : 0;
        return {
          ...prev,
          data: {
            ...prev.data,
            reviews: nextReviews,
            reviewStats: { total, pending, approved: approvedCount, rejected: rejectedCount, onHold: onHoldCount, stale: staleCount, completionRate },
          },
        };
      });

      setEditMap((prev) => ({
        ...prev,
        [groupId]: { ...prev[groupId], saving: false, savedAt, saveError: null },
      }));
    } catch {
      setEditMap((prev) => ({
        ...prev,
        [groupId]: { ...prev[groupId], saving: false, saveError: 'ネットワークエラーが発生しました' },
      }));
    }
  }

  const stats       = fetchState.status === 'ok' ? fetchState.data.stats        : null;
  const groups      = fetchState.status === 'ok' ? fetchState.data.groups       : [];
  const pagination  = fetchState.status === 'ok' ? fetchState.data.pagination   : null;
  const reviews     = fetchState.status === 'ok' ? fetchState.data.reviews      : {};
  const reviewStats = fetchState.status === 'ok' ? fetchState.data.reviewStats  : null;
  const applyEnabled = fetchState.status === 'ok' ? (fetchState.data.applyEnabled ?? false) : false;

  return (
    <div>
      {/* ローディング */}
      {fetchState.status === 'loading' && (
        <div className="flex items-center gap-3 text-slate-200 text-sm py-10">
          <span
            className="animate-spin inline-block w-5 h-5 border-2 border-slate-500 border-t-white rounded-full"
            aria-hidden="true"
          />
          重複候補を取得中…（初回は10〜30秒かかる場合があります）
        </div>
      )}

      {/* エラー */}
      {fetchState.status === 'error' && (
        <div role="alert" className="bg-red-950 border border-red-600 rounded-lg p-4 mb-4">
          <div className="text-red-200 font-semibold text-sm mb-1">重複候補の取得に失敗しました</div>
          <div className="text-xs text-red-300 mb-3">
            エラーコード: <code className="bg-red-900 text-red-100 px-1 rounded">{fetchState.code}</code>
            {fetchState.httpStatus > 0 && (
              <span className="ml-2 text-red-300">HTTP {fetchState.httpStatus}</span>
            )}
          </div>
          {(fetchState.httpStatus === 401 || fetchState.httpStatus === 403) ? (
            <p className="text-xs text-yellow-200 mb-3">
              認証エラーです。ページを再読み込みするか、再ログインしてください。
            </p>
          ) : fetchState.code === 'NETWORK_ERROR' ? (
            <p className="text-xs text-yellow-200 mb-3">
              ネットワークエラーです。接続を確認して再試行してください。
            </p>
          ) : fetchState.code === 'REVIEWS_TABLE_MISSING' ? (
            <p className="text-xs text-yellow-200 mb-3">
              Preview DBにレビューテーブルが存在しません。<br />
              <code className="bg-red-900 text-red-100 px-1">drizzle/0004_work_dedup_reviews.sql</code> をPreview DBに適用してから再試行してください。
            </p>
          ) : (
            <p className="text-xs text-yellow-200 mb-3">
              サーバーエラーが発生しました。しばらく待ってから再試行してください。
              （サーバーログに詳細が記録されています）
            </p>
          )}
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded border border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* 正常データ */}
      {fetchState.status === 'ok' && (
        <>
          {stats && <StatsBar stats={stats} />}
          {reviewStats && <ReviewProgressBar rs={reviewStats} />}

          {/* フィルターバー */}
          <div className="space-y-2 mb-4">
            {/* confidence フィルター */}
            <div className="flex gap-1 flex-wrap" role="group" aria-label="信頼度フィルター">
              {(['all', ...ALL_CONFIDENCES] as const).map((c) => {
                const isActive = confidence === c;
                const count = c === 'all'
                  ? (stats?.duplicateCandidateGroups ?? 0)
                  : (stats ? (stats[`${c}Groups` as keyof typeof stats] as number) : 0);
                if (c === 'all') {
                  return (
                    <button key="all" type="button" aria-pressed={isActive}
                      onClick={() => handleConfidenceChange('all')}
                      className={`text-xs px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${isActive ? 'bg-white text-slate-900 border-white font-semibold' : 'bg-slate-800 text-slate-200 border-slate-500 hover:bg-slate-700'}`}
                    >
                      すべて ({count})
                    </button>
                  );
                }
                const b = CONFIDENCE_BADGE[c];
                return (
                  <button key={c} type="button" aria-pressed={isActive}
                    onClick={() => handleConfidenceChange(c)}
                    className={`text-xs px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${isActive ? 'bg-white text-slate-900 border-white font-semibold' : `${b.bg} ${b.text} border-transparent hover:opacity-90`}`}
                  >
                    {c} ({count})
                  </button>
                );
              })}
            </div>

            {/* レビュー状態フィルター */}
            <div className="flex gap-1 flex-wrap" role="group" aria-label="レビュー状態フィルター">
              {(
                [
                  ['all',               'すべて',      reviewStats?.total ?? 0],
                  ['pending',           '未判定',      reviewStats?.pending ?? 0],
                  ['approved_duplicate','承認済み',    reviewStats?.approved ?? 0],
                  ['rejected_distinct', '却下済み',    reviewStats?.rejected ?? 0],
                  ['on_hold',           '保留',        reviewStats?.onHold ?? 0],
                  ['stale',             '再確認必要',  reviewStats?.stale ?? 0],
                ] as [ReviewFilterStatus, string, number][]
              ).map(([s, label, count]) => (
                <button key={s} type="button" aria-pressed={reviewFilter === s}
                  onClick={() => handleReviewFilterChange(s)}
                  className={`text-xs px-2 py-1 rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                    reviewFilter === s
                      ? 'bg-white text-slate-900 border-white font-semibold'
                      : 'bg-slate-800 text-slate-300 border-slate-500 hover:bg-slate-700'
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>

            {/* 検索 */}
            <div className="flex">
              <label htmlFor="dedup-search" className="sr-only">タイトル・workIdで絞り込み</label>
              <input
                id="dedup-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitSearch()}
                placeholder="タイトル・workIdで絞り込み..."
                className="text-sm bg-slate-800 border border-slate-500 rounded-l px-3 py-1 text-white placeholder-slate-400 flex-1 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent"
              />
              <button
                type="button"
                onClick={commitSearch}
                className="text-xs px-3 py-1 bg-slate-700 border border-slate-500 border-l-0 rounded-r text-slate-200 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                検索
              </button>
            </div>
          </div>

          {/* 件数表示 */}
          {pagination && (
            <div className="text-xs text-slate-300 mb-3" aria-live="polite">
              {pagination.total === 0
                ? (searchQuery || confidence !== 'all' || reviewFilter !== 'all'
                    ? '条件に一致するグループがありません。'
                    : '重複候補は見つかりませんでした。')
                : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} / ${pagination.total}グループ`}
            </div>
          )}

          {/* グループ一覧 */}
          <div className="space-y-2">
            {groups.map((group) => {
              const review = reviews[group.groupId];
              const edit = editMap[group.groupId] ?? makeInitialEdit(review, group.canonicalRecommendation.recommendedWorkId);
              return (
                <GroupCard
                  key={group.groupId}
                  group={group}
                  review={review}
                  edit={edit}
                  applyEnabled={applyEnabled}
                  onChange={handleEditChange}
                  onSave={handleSave}
                  onReload={load}
                />
              );
            })}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <PaginationBar pagination={pagination} onPage={setPage} />
          )}
        </>
      )}
    </div>
  );
}
