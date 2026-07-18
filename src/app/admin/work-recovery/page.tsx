import { neonSql } from '@/db/client';
import WorkRecoveryClient from './WorkRecoveryClient';
import ProductRecoveryClient from './ProductRecoveryClient';
import type { WorkRecoveryItem } from '@/app/api/admin/work-recovery/route';
import type { OrphanStat } from '@/app/api/admin/product-recovery/route';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export default async function WorkRecoveryPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  const activeTab = tab === 'products' ? 'products' : 'works';

  // ── 作品タブ: hidden manual_csv 作品一覧 ─────────────────────────────────────
  let initialWorks: WorkRecoveryItem[] = [];
  let initialTotal = 0;
  let worksError: string | null = null;

  if (activeTab === 'works') {
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
      worksError = String(err);
    }
  }

  // ── 商品タブ: 孤立 verdict 人物別集計 ────────────────────────────────────────
  let orphanStats: OrphanStat[] = [];
  let orphanTotal = 0;
  let orphanError: string | null = null;

  if (activeTab === 'products') {
    try {
      const rows = await neonSql`
        WITH product_ids AS (
          SELECT DISTINCT p.person_name, elem->>'id' AS product_id
          FROM products p,
          LATERAL jsonb_array_elements(p.items) AS elem
          WHERE jsonb_typeof(p.items) = 'array'
        )
        SELECT v.person_name, COUNT(*)::int AS orphan_count
        FROM verdicts v
        LEFT JOIN product_ids pi
          ON v.person_name = pi.person_name AND v.product_id = pi.product_id
        WHERE pi.product_id IS NULL
        GROUP BY v.person_name
        ORDER BY orphan_count DESC
      `;
      orphanStats = rows.map((r) => ({
        personName:  r.person_name as string,
        orphanCount: r.orphan_count as number,
      }));
      orphanTotal = orphanStats.reduce((s, r) => s + r.orphanCount, 0);
    } catch (err) {
      orphanError = String(err);
    }
  }

  const recoveryEnabled = process.env.DATA_RECOVERY_EXECUTION_ENABLED === 'true';

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">データ復旧</h1>
        <p className="text-sm text-gray-500 mt-1">
          データ消失したコンテンツの調査・復旧を行います。
        </p>
      </div>

      {/* 環境変数ステータス（作品タブのみ関係） */}
      {activeTab === 'works' && (
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
      )}

      {/* タブナビゲーション */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <a
          href="/admin/work-recovery?tab=works"
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'works'
              ? 'border-indigo-500 text-indigo-700 bg-indigo-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          作品
          {activeTab === 'works' && initialTotal > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-600 rounded-full">
              {initialTotal.toLocaleString()}
            </span>
          )}
        </a>
        <a
          href="/admin/work-recovery?tab=products"
          className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'products'
              ? 'border-orange-500 text-orange-700 bg-orange-50'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          商品（孤立 verdict）
          {activeTab === 'products' && orphanTotal > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-orange-100 text-orange-600 rounded-full">
              {orphanTotal.toLocaleString()}
            </span>
          )}
        </a>
      </div>

      {/* タブコンテンツ */}
      {activeTab === 'works' && (
        worksError ? (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            DB エラー: {worksError}
          </div>
        ) : (
          <WorkRecoveryClient initialWorks={initialWorks} initialTotal={initialTotal} />
        )
      )}

      {activeTab === 'products' && (
        orphanError ? (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            DB エラー: {orphanError}
          </div>
        ) : (
          <ProductRecoveryClient initialStats={orphanStats} initialTotal={orphanTotal} recoveryEnabled={recoveryEnabled} />
        )
      )}
    </div>
  );
}
