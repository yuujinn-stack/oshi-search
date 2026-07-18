import { neonSql } from '@/db/client';
import WorkRecoveryClient from './WorkRecoveryClient';
import type { WorkRecoveryItem } from '@/app/api/admin/work-recovery/route';

export const dynamic = 'force-dynamic';

export default async function WorkRecoveryPage() {
  // 初期データ（1ページ目）
  let initialWorks: WorkRecoveryItem[] = [];
  let initialTotal = 0;
  let dbError: string | null = null;

  try {
    const rows = await neonSql`
      SELECT person_name, id AS work_id, title, type, source,
             status AS current_status, checked_at, created_at, updated_at
      FROM works
      WHERE source = 'manual_csv' AND status = 'hidden' AND deleted = FALSE
      ORDER BY person_name, title
      LIMIT 100
    `;
    const countRows = await neonSql`
      SELECT COUNT(*)::int AS total FROM works
      WHERE source = 'manual_csv' AND status = 'hidden' AND deleted = FALSE
    `;
    initialTotal = (countRows[0]?.total as number) ?? 0;
    initialWorks = rows.map((r) => ({
      personName:    r.person_name as string,
      workId:        r.work_id as string,
      title:         r.title as string,
      type:          r.type as string,
      source:        r.source as string,
      currentStatus: r.current_status as string,
      checkedAt:     r.checked_at ? String(r.checked_at).slice(0, 19).replace('T', ' ') : null,
      createdAt:     String(r.created_at).slice(0, 19).replace('T', ' '),
      updatedAt:     String(r.updated_at).slice(0, 19).replace('T', ' '),
    }));
  } catch (err) {
    dbError = String(err);
  }

  const recoveryEnabled = process.env.DATA_RECOVERY_EXECUTION_ENABLED === 'true';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">作品データ復旧</h1>
        <p className="text-sm text-gray-500 mt-1">
          hidden 状態の manual_csv 作品を選択して safe に復旧します。
          dry-run → 確認 → 実行 の順に進めてください。
        </p>
      </div>

      {/* 環境変数ステータス */}
      <div className={`mb-4 px-4 py-3 rounded-xl border text-sm ${
        recoveryEnabled
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-yellow-50 border-yellow-200 text-yellow-700'
      }`}>
        {recoveryEnabled ? (
          <>✅ <strong>DATA_RECOVERY_EXECUTION_ENABLED=true</strong> — 実行モードが有効です</>
        ) : (
          <>
            ⚠️ <strong>DATA_RECOVERY_EXECUTION_ENABLED</strong> が未設定のため実行不可（dry-run のみ）。
            実行するには環境変数を <code className="font-mono">true</code> に設定してください。
          </>
        )}
      </div>

      {dbError ? (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
          DB エラー: {dbError}
        </div>
      ) : (
        <WorkRecoveryClient initialWorks={initialWorks} initialTotal={initialTotal} />
      )}
    </div>
  );
}
