// 読み取り専用フォレンジック調査ページ
// DB書き込み・削除・復旧処理は一切行わない
// ブランチ: audit/post-sync-missing-data
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { LogoutButton } from '@/components/admin/LogoutButton';
import HiddenWorksSearch, { type HiddenWorkRecord } from './HiddenWorksSearch';

export const dynamic = 'force-dynamic';

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['rows'])) return r['rows'] as T[];
  }
  return [];
}

function fmt(ts: unknown): string {
  if (!ts) return '—';
  if (ts instanceof Date) return ts.toISOString().replace('T', ' ').slice(0, 19);
  if (typeof ts === 'string') return ts.slice(0, 19).replace('T', ' ');
  return String(ts);
}

// manual_csv 作品の hidden 除外理由を生成
function makeExcludeReason(row: {
  source: string;
  ai_decision: string | null;
  ai_reason: string | null;
  checked_at: string | null;
}): string {
  if (row.source === 'manual_csv') {
    if (row.checked_at) return '管理者が手動で hidden に設定（checked_at あり）';
    return '管理者による手動非表示設定（work-verdict / work-verdict-bulk API）';
  }
  if (row.ai_decision === 'hidden') {
    const r = row.ai_reason ? `AI判定: ${row.ai_reason}` : 'AI判定で hidden';
    return row.checked_at ? `${r}（管理者確認済）` : r;
  }
  return 'status=hidden のため公開ページから除外（getPublishedWorks フィルタ）';
}

// ── 型定義 ────────────────────────────────────────────────────────────────────

type WorksBySourceRow = {
  source: string; total: number; active: number; soft_deleted: number; last_updated: string | null;
};
type ManualCsvStatusRow = { status: string | null; count: number };
type ManualCsvByPersonRow = {
  person_name: string; total: number;
  auto_published: number; needs_review: number; hidden_count: number; other_count: number;
};
type ManualCsvWorkRow = {
  person_name: string; id: string; title: string; type: string; status: string;
  deleted: boolean; deleted_at: string | null; deleted_by: string | null;
  created_at: string; updated_at: string;
};
type RawHiddenWorkRow = {
  person_name: string; id: string; title: string; type: string; source: string; status: string;
  checked_at: string | null; created_at: string; updated_at: string;
  ai_data: Record<string, unknown> | null; vod_data: Record<string, unknown> | null;
};
type ProductRow = {
  person_name: string; category: string; item_count: number; fetched_at: string | null;
};
type ImportHistRow = {
  history_id: string; import_type: string; executed_at: string; file_name: string | null;
  total_rows: number; success_count: number; skip_count: number; error_count: number; status: string;
};
type BatchMetaRow = { last_run_at: string; person_count: number; ai_judged: number };
type CountsRow = {
  persons_count: number; works_count: number; active_works_count: number;
  deleted_works_count: number; products_rows: number; total_items: number; verdicts_count: number;
};
type OrphanRow = {
  total_verdicts: number; matched_verdicts: number; orphan_count: number;
};
type VerdictDiffRow = {
  person_name: string; verdict_count: number; item_count: number; diff: number;
};

// ── コード分析メモ ─────────────────────────────────────────────────────────────

const HIDDEN_CAUSE_NOTES = [
  {
    file: 'work-processor.ts: judgeWork()',
    condition: 'OpenAI APIが "decision":"hidden" を返した場合',
    overwritesManualCsv: false,
    detail:
      'TMDb由来作品のAI判定で hidden が返される。manual_csv 作品の ID（csv-{type}-{title}）は TMDb作品の ID（tmdb-{type}-{id}）と形式が異なるため通常は衝突しない。forceRejudge=true かつ checkedAt 未設定の場合は例外的にリスクあり。',
  },
  {
    file: 'work-processor.ts: applySafetyOverride()',
    condition: '役名に "voice" / "(声)" / "声優" が含まれる場合に decision を hidden に強制上書き',
    overwritesManualCsv: false,
    detail:
      'ジャンルが 坂道・芸人・テレビ・俳優 の人物に適用。TMDb由来作品のみ対象で manual_csv には通常届かない。',
  },
  {
    file: 'api/admin/work-verdict/route.ts (POST)',
    condition: 'POST body: { personName, workId, status: "hidden" }',
    overwritesManualCsv: true,
    detail:
      '管理者が work-check ページで個別に非表示ボタンを押した場合。source に関わらずすべての作品に適用される。manual_csv 作品を hidden にする最有力の経路。updateWorkStatus → upsertWork で status フィールドのみ更新。',
  },
  {
    file: 'api/admin/work-verdict-bulk/route.ts (POST)',
    condition: 'POST body: { personName, workIds: string[], status: "hidden" }',
    overwritesManualCsv: true,
    detail:
      '管理者が work-check ページで複数作品を一括で hidden に設定した場合。CSV作品も含む全 workId が対象。',
  },
  {
    file: 'api/admin/work-manual/route.ts',
    condition: 'status="hidden" で手動作品を新規作成した場合',
    overwritesManualCsv: false,
    detail:
      '既存 manual_csv 作品の上書きではなく新規作成時のみ。既存作品への影響なし。',
  },
  {
    file: 'db/write.ts: upsertWork() ON CONFLICT DO UPDATE',
    condition: '同一 (person_name, id) の作品が再度 saveWork されたとき status を上書き',
    overwritesManualCsv: false,
    detail:
      'ID が衝突した場合にのみ発生。CSV ID（csv-...）と TMDb ID（tmdb-...）は形式が異なるため通常衝突しない。openai_suggestion の ID（ai-{type}-{title[:24]}）と CSV ID（csv-{type}-{title[:32]}）も先頭プレフィックスが異なるため衝突しない。',
  },
];

const AUDIT_RISK_NOTES = [
  {
    title: 'データ消失ベクター①: upsertWork の全フィールド上書き',
    severity: 'medium' as const,
    detail:
      'db/write.ts の upsertWork() は ON CONFLICT DO UPDATE で source / status / deleted / checkedAt を含む全フィールドを上書きする。ただし CSV ID は "csv-{type}-{title}" 形式、TMDb ID は "tmdb-{type}-{id}" 形式で構造が異なるため、通常は ID 衝突による上書きは発生しない。',
  },
  {
    title: 'データ消失ベクター②: deleteWorksBySource による物理削除',
    severity: 'high' as const,
    detail:
      'work-store.ts の deleteWorksBySource() は指定 source の作品を物理削除する。deleteSupplementFirst=true で work-process API を呼ぶと source="openai_suggestion" の作品が全削除される。manual_csv は対象外。ただし openai_suggestion から手動で source を変更していた場合は物理削除のリスクが生じる（通常はUIから変更不可）。',
  },
  {
    title: 'データ消失ベクター③: storeProducts の全上書き（手動追加商品）',
    severity: 'high' as const,
    detail:
      'product-store.ts の storeProducts() は verdictIds を渡すと verdict 済み商品を保持するが、verdict のない手動追加商品（product-manual ルート）はバッチ実行時に消える。batch-processor.ts は existingVerdictIds を渡しているが、verdict 未登録の商品は保護されない。手動追加後に verdict を登録していなければ次のバッチで上書きされる。',
  },
  {
    title: 'CSV作品インポートの保護状況（比較的安全）',
    severity: 'info' as const,
    detail:
      'work-csv-import route は saveWork() → upsertWork を呼ぶ。CSV作品 ID は "csv-movie-..." 形式、TMDb作品 ID は "tmdb-movie-12345" 形式と異なるため、TMDb 同期による上書きリスクは低い。',
  },
  {
    title: 'インポート履歴の対象外操作',
    severity: 'info' as const,
    detail:
      'import_history テーブルに記録されるのは person_csv / work_vod_csv / vod_title_csv のみ。work-csv-import ルート経由の作品 CSV インポートはこのテーブルに記録されない点に注意。',
  },
];

// ── ページ本体 ────────────────────────────────────────────────────────────────

export default async function DataLossAuditPage() {
  const [
    worksBySourceResult,
    manualCsvStatusResult,
    manualCsvByPersonResult,
    manualCsvWorksResult,
    allHiddenWorksResult,
    productsResult,
    importHistResult,
    batchMetaResult,
    countsResult,
    orphanResult,
    verdictDiffResult,
  ] = await Promise.all([
    // ② 作品ソース別内訳
    db.execute(sql`
      SELECT source,
             COUNT(*)::int                                       AS total,
             COUNT(*) FILTER (WHERE deleted = false)::int       AS active,
             COUNT(*) FILTER (WHERE deleted = true)::int        AS soft_deleted,
             MAX(updated_at)                                     AS last_updated
      FROM works
      GROUP BY source
      ORDER BY total DESC
    `),
    // ⑧ manual_csv status別集計
    db.execute(sql`
      SELECT status, COUNT(*)::int AS count
      FROM works
      WHERE source = 'manual_csv' AND deleted = false
      GROUP BY status
      ORDER BY count DESC
    `),
    // ⑧ manual_csv 人物別集計
    db.execute(sql`
      SELECT person_name,
             COUNT(*)::int                                             AS total,
             COUNT(*) FILTER (WHERE status = 'auto_published')::int   AS auto_published,
             COUNT(*) FILTER (WHERE status = 'needs_review')::int     AS needs_review,
             COUNT(*) FILTER (WHERE status = 'hidden')::int           AS hidden_count,
             COUNT(*) FILTER (WHERE status NOT IN ('auto_published','needs_review','hidden'))::int AS other_count
      FROM works
      WHERE source = 'manual_csv' AND deleted = false
      GROUP BY person_name
      ORDER BY hidden_count DESC, total DESC
    `),
    // ③④ manual_csv 作品一覧（有効・論理削除）
    db.execute(sql`
      SELECT person_name, id, title, type, status, deleted,
             deleted_at, deleted_by, created_at, updated_at
      FROM works
      WHERE source = 'manual_csv'
      ORDER BY person_name, deleted ASC, created_at DESC
    `),
    // ⑨ hidden 作品の詳細（全source）
    db.execute(sql`
      SELECT person_name, id, title, type, source, status,
             checked_at, created_at, updated_at,
             ai_data, vod_data
      FROM works
      WHERE status = 'hidden' AND deleted = false
      ORDER BY source, person_name, created_at DESC
    `),
    // ⑤ 商品アイテム数
    db.execute(sql`
      SELECT person_name, category,
             COALESCE(jsonb_array_length(items), 0)::int AS item_count,
             fetched_at
      FROM products
      ORDER BY person_name, category
    `),
    // ⑥ インポート履歴
    db.execute(sql`
      SELECT history_id, import_type, executed_at, file_name,
             total_rows, success_count, skip_count, error_count, status
      FROM import_history
      ORDER BY executed_at DESC
      LIMIT 30
    `),
    // バッチメタ
    db.execute(sql`
      SELECT last_run_at, person_count, ai_judged FROM batch_meta WHERE id = 1
    `),
    // ① 全体カウント
    db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM persons)                                     AS persons_count,
        (SELECT COUNT(*)::int FROM works)                                       AS works_count,
        (SELECT COUNT(*) FILTER (WHERE deleted = false)::int FROM works)        AS active_works_count,
        (SELECT COUNT(*) FILTER (WHERE deleted = true)::int FROM works)         AS deleted_works_count,
        (SELECT COUNT(*)::int FROM products)                                    AS products_rows,
        (SELECT COALESCE(SUM(jsonb_array_length(items)), 0)::int FROM products) AS total_items,
        (SELECT COUNT(*)::int FROM verdicts)                                    AS verdicts_count
    `),
    // ⑪ 孤立verdict COUNT
    db.execute(sql`
      WITH product_item_ids AS (
        SELECT DISTINCT p.person_name, elem->>'id' AS product_id
        FROM products p,
        LATERAL jsonb_array_elements(p.items) AS elem
        WHERE jsonb_typeof(p.items) = 'array'
      )
      SELECT
        COUNT(*)::int                                              AS total_verdicts,
        COUNT(pii.product_id)::int                                AS matched_verdicts,
        COUNT(*) FILTER (WHERE pii.product_id IS NULL)::int       AS orphan_count
      FROM verdicts v
      LEFT JOIN product_item_ids pii
        ON v.person_name = pii.person_name AND v.product_id = pii.product_id
    `),
    // ⑫ 人物別 verdict vs items 差分
    db.execute(sql`
      SELECT
        COALESCE(v.person_name, p.person_name)           AS person_name,
        COALESCE(v.verdict_count, 0)::int                AS verdict_count,
        COALESCE(p.item_count, 0)::int                   AS item_count,
        (COALESCE(v.verdict_count, 0) - COALESCE(p.item_count, 0))::int AS diff
      FROM (
        SELECT person_name, COUNT(*)::int AS verdict_count
        FROM verdicts GROUP BY person_name
      ) v
      FULL OUTER JOIN (
        SELECT person_name, COALESCE(SUM(jsonb_array_length(items)), 0)::int AS item_count
        FROM products GROUP BY person_name
      ) p ON v.person_name = p.person_name
      ORDER BY abs(COALESCE(v.verdict_count, 0) - COALESCE(p.item_count, 0)) DESC
      LIMIT 50
    `),
  ]);

  const worksBySource      = extractRows<WorksBySourceRow>(worksBySourceResult);
  const manualCsvStatus    = extractRows<ManualCsvStatusRow>(manualCsvStatusResult);
  const manualCsvByPerson  = extractRows<ManualCsvByPersonRow>(manualCsvByPersonResult);
  const manualCsvWorks     = extractRows<ManualCsvWorkRow>(manualCsvWorksResult);
  const rawHiddenWorks     = extractRows<RawHiddenWorkRow>(allHiddenWorksResult);
  const products           = extractRows<ProductRow>(productsResult);
  const importHistory      = extractRows<ImportHistRow>(importHistResult);
  const batchMeta          = extractRows<BatchMetaRow>(batchMetaResult)[0] ?? null;
  const counts             = extractRows<CountsRow>(countsResult)[0] ?? null;
  const orphan             = extractRows<OrphanRow>(orphanResult)[0] ?? null;
  const verdictDiff        = extractRows<VerdictDiffRow>(verdictDiffResult);

  const activeManualCsv  = manualCsvWorks.filter((w) => !w.deleted);
  const deletedManualCsv = manualCsvWorks.filter((w) => w.deleted);
  const generatedAt      = new Date().toISOString();

  // hidden 作品の整形（クライアントコンポーネント用）
  const hiddenWorks: HiddenWorkRecord[] = rawHiddenWorks.map((w) => {
    const aiData = w.ai_data ?? {};
    const vodData = w.vod_data ?? {};
    const vodProviders = Array.isArray(vodData['vodProviders']) ? vodData['vodProviders'] : [];
    const aiReason = typeof aiData['aiReason'] === 'string' ? aiData['aiReason'] : null;
    const aiDecision = typeof aiData['aiDecision'] === 'string' ? aiData['aiDecision'] : null;
    return {
      person_name: w.person_name,
      id: w.id,
      title: w.title,
      type: w.type,
      source: w.source,
      status: w.status,
      checked_at: w.checked_at,
      created_at: w.created_at,
      updated_at: w.updated_at,
      ai_reason: aiReason,
      ai_decision: aiDecision,
      vod_providers_count: vodProviders.length,
      exclude_reason: makeExcludeReason({
        source: w.source,
        ai_decision: aiDecision,
        ai_reason: aiReason,
        checked_at: w.checked_at,
      }),
    };
  });

  const hiddenManualCsvWorks = hiddenWorks.filter((w) => w.source === 'manual_csv');
  const hiddenManualCsvPersonCount = new Set(hiddenManualCsvWorks.map((w) => w.person_name)).size;

  // 差分サマリ
  const totalDiffAbs = verdictDiff.reduce((s, r) => s + Math.abs(r.diff), 0);
  const orphanCount = orphan?.orphan_count ?? 0;
  const hasSignificantDiff = verdictDiff.some((r) => Math.abs(r.diff) > 10);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">

      {/* ─── ヘッダー ─── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">データ消失調査 (Read-Only)</h1>
          <p className="text-sm text-red-600 mt-1 font-semibold">
            ⚠ 調査専用ページ — DB書き込み・削除・復旧処理は一切行いません
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            ブランチ: audit/post-sync-missing-data | 生成: {generatedAt}
          </p>
        </div>
        <LogoutButton className="text-gray-400 hover:text-red-500 text-xs mt-1" />
      </div>

      {/* ─── ① DB全体サマリー ─── */}
      {counts && (
        <section className="mb-8">
          <h2 className="text-base font-bold text-slate-700 mb-3">① DB全体サマリー</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { label: '人物数', value: counts.persons_count },
              { label: '作品（全体）', value: counts.works_count },
              { label: '作品（有効）', value: counts.active_works_count },
              { label: '作品（論理削除）', value: counts.deleted_works_count },
              { label: '商品行数（category単位）', value: counts.products_rows },
              { label: '商品アイテム合計', value: counts.total_items },
              { label: 'Verdicts', value: counts.verdicts_count },
              { label: 'バッチ最終実行', value: batchMeta ? fmt(batchMeta.last_run_at) : '—' },
            ] as { label: string; value: number | string }[]).map(({ label, value }) => (
              <div key={label} className="bg-white rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-xl font-bold text-slate-800 mt-0.5 break-all">{String(value)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── ② 作品ソース別内訳 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">② 作品ソース別内訳</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded-lg">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-semibold">source</th>
                <th className="px-3 py-2 font-semibold text-right">全件</th>
                <th className="px-3 py-2 font-semibold text-right">有効</th>
                <th className="px-3 py-2 font-semibold text-right">論理削除済</th>
                <th className="px-3 py-2 font-semibold">最終更新</th>
              </tr>
            </thead>
            <tbody>
              {worksBySource.map((row) => (
                <tr key={row.source} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-slate-700 font-medium">{row.source}</td>
                  <td className="px-3 py-2 text-right">{row.total}</td>
                  <td className="px-3 py-2 text-right text-green-700">{row.active}</td>
                  <td className={`px-3 py-2 text-right ${row.soft_deleted > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                    {row.soft_deleted}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmt(row.last_updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── ③ manual_csv 論理削除済み作品 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-1">
          ③ manual_csv 論理削除済み作品
          <span className={`ml-2 text-sm font-normal ${deletedManualCsv.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
            （{deletedManualCsv.length}件）
          </span>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          source=manual_csv かつ deleted=true の作品。手動でソフトデリートされた CSV 登録作品の一覧。
        </p>
        {deletedManualCsv.length === 0 ? (
          <div className="bg-green-50 text-green-700 rounded-lg px-4 py-3 text-sm border border-green-100">
            論理削除された manual_csv 作品は 0 件です。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-red-100 rounded-lg">
              <thead>
                <tr className="bg-red-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-semibold">人物名</th>
                  <th className="px-3 py-2 font-semibold">ID</th>
                  <th className="px-3 py-2 font-semibold">タイトル</th>
                  <th className="px-3 py-2 font-semibold">type</th>
                  <th className="px-3 py-2 font-semibold">status</th>
                  <th className="px-3 py-2 font-semibold">deleted_at</th>
                  <th className="px-3 py-2 font-semibold">deleted_by</th>
                </tr>
              </thead>
              <tbody>
                {deletedManualCsv.map((w) => (
                  <tr key={`${w.person_name}:${w.id}`} className="border-t border-red-50">
                    <td className="px-3 py-2">{w.person_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{w.id}</td>
                    <td className="px-3 py-2">{w.title}</td>
                    <td className="px-3 py-2 font-mono text-xs">{w.type}</td>
                    <td className="px-3 py-2 font-mono text-xs">{w.status}</td>
                    <td className="px-3 py-2 text-xs">{fmt(w.deleted_at)}</td>
                    <td className="px-3 py-2 text-xs">{w.deleted_by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── ④ manual_csv 有効作品一覧 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-1">
          ④ manual_csv 有効作品一覧
          <span className="ml-2 text-sm font-normal text-slate-500">（{activeManualCsv.length}件）</span>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          source=manual_csv かつ deleted=false の現在有効な CSV 登録作品。
        </p>
        {activeManualCsv.length === 0 ? (
          <div className="bg-yellow-50 text-yellow-800 rounded-lg px-4 py-3 text-sm border border-yellow-200">
            ⚠ 有効な manual_csv 作品が 0 件です。CSV インポート済み作品がすべて消えている可能性があります。
          </div>
        ) : (
          <div className="overflow-x-auto max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-semibold">人物名</th>
                  <th className="px-3 py-2 font-semibold">ID</th>
                  <th className="px-3 py-2 font-semibold">タイトル</th>
                  <th className="px-3 py-2 font-semibold">type</th>
                  <th className="px-3 py-2 font-semibold">status</th>
                  <th className="px-3 py-2 font-semibold">作成日時</th>
                  <th className="px-3 py-2 font-semibold">更新日時</th>
                </tr>
              </thead>
              <tbody>
                {activeManualCsv.map((w) => (
                  <tr key={`${w.person_name}:${w.id}`} className="border-t border-gray-100">
                    <td className="px-3 py-2">{w.person_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{w.id}</td>
                    <td className="px-3 py-2">{w.title}</td>
                    <td className="px-3 py-2 font-mono text-xs">{w.type}</td>
                    <td className={`px-3 py-2 font-mono text-xs ${w.status === 'hidden' ? 'text-orange-600 font-bold' : w.status === 'auto_published' ? 'text-green-700' : 'text-gray-500'}`}>
                      {w.status}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmt(w.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmt(w.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── ⑤ 商品アイテム数 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">
          ⑤ 商品アイテム数（人物×カテゴリ）
          <span className="ml-2 text-sm font-normal text-slate-500">（{products.length}行）</span>
        </h2>
        <div className="overflow-x-auto max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-semibold">人物名</th>
                <th className="px-3 py-2 font-semibold">カテゴリ</th>
                <th className="px-3 py-2 font-semibold text-right">アイテム数</th>
                <th className="px-3 py-2 font-semibold">最終取得日時</th>
              </tr>
            </thead>
            <tbody>
              {products.map((row) => (
                <tr key={`${row.person_name}:${row.category}`} className="border-t border-gray-100">
                  <td className="px-3 py-2">{row.person_name}</td>
                  <td className="px-3 py-2">{row.category}</td>
                  <td className={`px-3 py-2 text-right font-mono ${row.item_count === 0 ? 'text-gray-300' : 'text-slate-700'}`}>
                    {row.item_count}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmt(row.fetched_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── ⑥ CSVインポート履歴 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">⑥ CSVインポート履歴（直近30件）</h2>
        <p className="text-xs text-gray-500 mb-3">
          import_history テーブルの記録。person_csv / work_vod_csv / vod_title_csv のみが対象。
          work-csv-import ルート経由の作品 CSV は記録されない点に注意。
        </p>
        {importHistory.length === 0 ? (
          <div className="bg-gray-50 text-gray-500 rounded-lg px-4 py-3 text-sm border border-gray-200">
            インポート履歴がありません。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-gray-200 rounded-lg">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-semibold">実行日時</th>
                  <th className="px-3 py-2 font-semibold">種別</th>
                  <th className="px-3 py-2 font-semibold">ファイル名</th>
                  <th className="px-3 py-2 font-semibold text-right">合計</th>
                  <th className="px-3 py-2 font-semibold text-right">成功</th>
                  <th className="px-3 py-2 font-semibold text-right">スキップ</th>
                  <th className="px-3 py-2 font-semibold text-right">エラー</th>
                  <th className="px-3 py-2 font-semibold">ステータス</th>
                </tr>
              </thead>
              <tbody>
                {importHistory.map((h) => (
                  <tr key={h.history_id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-xs">{fmt(h.executed_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{h.import_type}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{h.file_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{h.total_rows}</td>
                    <td className="px-3 py-2 text-right text-green-700">{h.success_count}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{h.skip_count}</td>
                    <td className={`px-3 py-2 text-right ${h.error_count > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
                      {h.error_count}
                    </td>
                    <td className={`px-3 py-2 text-xs font-medium ${
                      h.status === 'completed'    ? 'text-green-700' :
                      h.status === 'failed'        ? 'text-red-600'   :
                      h.status === 'partial_error' ? 'text-yellow-600' :
                      'text-gray-500'
                    }`}>
                      {h.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── ⑦ コード分析リスク評価 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">⑦ コード分析によるリスク評価</h2>
        <div className="space-y-3 text-sm">
          {AUDIT_RISK_NOTES.map(({ title, severity, detail }) => (
            <div
              key={title}
              className={`rounded-lg border p-4 ${
                severity === 'high'   ? 'border-red-200 bg-red-50'      :
                severity === 'medium' ? 'border-yellow-200 bg-yellow-50' :
                'border-blue-200 bg-blue-50'
              }`}
            >
              <div className={`text-xs font-bold uppercase tracking-wide mb-1 ${
                severity === 'high' ? 'text-red-700' : severity === 'medium' ? 'text-yellow-700' : 'text-blue-700'
              }`}>
                {severity === 'high' ? '🔴 HIGH' : severity === 'medium' ? '🟡 MEDIUM' : 'ℹ INFO'}
              </div>
              <div className="font-semibold text-slate-800 mb-1">{title}</div>
              <div className="text-gray-700 text-xs leading-relaxed">{detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── ⑧ manual_csv status別集計 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">⑧ manual_csv status別集計</h2>

        {/* 全体集計 */}
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">全体</h3>
          <div className="flex flex-wrap gap-3">
            {manualCsvStatus.map((row) => (
              <div
                key={row.status ?? 'null'}
                className={`rounded-lg border px-4 py-2 text-center ${
                  row.status === 'hidden'         ? 'border-orange-200 bg-orange-50' :
                  row.status === 'auto_published'  ? 'border-green-200 bg-green-50'  :
                  row.status === 'needs_review'    ? 'border-yellow-200 bg-yellow-50' :
                  'border-gray-200 bg-gray-50'
                }`}
              >
                <div className={`text-xs font-mono font-semibold ${
                  row.status === 'hidden' ? 'text-orange-700' :
                  row.status === 'auto_published' ? 'text-green-700' :
                  row.status === 'needs_review' ? 'text-yellow-700' :
                  'text-gray-500'
                }`}>{row.status ?? '(null)'}</div>
                <div className="text-2xl font-black text-slate-800">{row.count}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            公開ページに表示されるのは <span className="font-mono font-bold text-green-700">auto_published</span> のみ（deleted=false 条件も必要）。
          </p>
        </div>

        {/* 人物別集計 */}
        {manualCsvByPerson.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2">
              人物別 manual_csv 作品数
              <span className="ml-2 font-normal text-gray-400">（hidden が多い順）</span>
            </h3>
            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-xs text-gray-500">
                    <th className="px-3 py-2 font-semibold">人物名</th>
                    <th className="px-3 py-2 font-semibold text-right">合計</th>
                    <th className="px-3 py-2 font-semibold text-right">auto_published</th>
                    <th className="px-3 py-2 font-semibold text-right">needs_review</th>
                    <th className="px-3 py-2 font-semibold text-right">hidden</th>
                    <th className="px-3 py-2 font-semibold text-right">その他</th>
                  </tr>
                </thead>
                <tbody>
                  {manualCsvByPerson.map((row) => (
                    <tr key={row.person_name} className="border-t border-gray-100">
                      <td className="px-3 py-2">{row.person_name}</td>
                      <td className="px-3 py-2 text-right font-mono">{row.total}</td>
                      <td className="px-3 py-2 text-right text-green-700">{row.auto_published}</td>
                      <td className="px-3 py-2 text-right text-yellow-600">{row.needs_review}</td>
                      <td className={`px-3 py-2 text-right font-mono ${row.hidden_count > 0 ? 'text-orange-600 font-bold' : 'text-gray-300'}`}>
                        {row.hidden_count}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-400">{row.other_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ─── ⑨ hidden作品の詳細一覧 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-1">
          ⑨ hidden作品の詳細一覧
          <span className="ml-2 text-sm font-normal text-slate-500">（全源: {hiddenWorks.length}件 / manual_csv: {hiddenManualCsvWorks.length}件 / {hiddenManualCsvPersonCount}人）</span>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          status=hidden かつ deleted=false の全作品。公開ページから除外されている。
          manual_csv の hidden 作品は管理者の手動操作（work-verdict API）による可能性が高い。
        </p>
        <HiddenWorksSearch works={hiddenWorks} />
      </section>

      {/* ─── ⑩ hiddenになった原因調査 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">⑩ status=hidden に設定するコード箇所（全経路）</h2>
        <p className="text-xs text-gray-500 mb-3">
          公開ページのフィルタ（getPublishedWorks / getPublishedWorksOrThrow）は
          <span className="font-mono text-red-700 font-semibold"> status=&apos;auto_published&apos; AND deleted=false </span>
          のみを返す。hidden / needs_review は表示されない。
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded-lg">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-semibold">箇所</th>
                <th className="px-3 py-2 font-semibold">hidden になる条件</th>
                <th className="px-3 py-2 font-semibold">manual_csv 上書きリスク</th>
                <th className="px-3 py-2 font-semibold">詳細</th>
              </tr>
            </thead>
            <tbody>
              {HIDDEN_CAUSE_NOTES.map((n) => (
                <tr key={n.file} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-blue-700 whitespace-nowrap">{n.file}</td>
                  <td className="px-3 py-2 text-xs">{n.condition}</td>
                  <td className={`px-3 py-2 text-xs font-bold whitespace-nowrap ${n.overwritesManualCsv ? 'text-orange-600' : 'text-gray-400'}`}>
                    {n.overwritesManualCsv ? '🔴 あり' : '✅ なし'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{n.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── ⑪ 孤立verdict調査 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-1">
          ⑪ 孤立verdict調査
          <span className={`ml-2 text-sm font-normal ${orphanCount > 0 ? 'text-orange-600' : 'text-green-600'}`}>
            （孤立: {orphanCount?.toLocaleString() ?? '—'}件）
          </span>
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          verdicts テーブルに存在するが、products.items 内に対応する商品 ID が見つからない verdict の件数。
          孤立 verdict = 商品データが storeProducts の上書きで消えたか、product-delete で削除後に verdict が残っている状態。
        </p>
        {orphan && (
          <div className="flex flex-wrap gap-3 mb-3">
            {[
              { label: 'verdicts 合計', value: orphan.total_verdicts.toLocaleString(), color: 'text-slate-800' },
              { label: 'products に一致', value: orphan.matched_verdicts.toLocaleString(), color: 'text-green-700' },
              { label: '孤立 verdict', value: orphan.orphan_count.toLocaleString(), color: orphan.orphan_count > 0 ? 'text-orange-600 font-bold' : 'text-gray-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-lg border border-gray-200 px-4 py-2 text-center">
                <div className="text-xs text-gray-500">{label}</div>
                <div className={`text-xl font-bold mt-0.5 ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        )}
        {orphanCount > 0 ? (
          <div className="bg-orange-50 text-orange-800 border border-orange-200 rounded-lg px-4 py-3 text-sm">
            ⚠ {orphanCount.toLocaleString()}件の孤立 verdict があります。
            対応する商品データが products.items に存在しません。
            storeProducts の全上書きまたは product-delete による削除後に verdict だけ残った可能性があります。
          </div>
        ) : (
          <div className="bg-green-50 text-green-700 border border-green-100 rounded-lg px-4 py-3 text-sm">
            孤立 verdict は 0 件です。全 verdict に対応する商品データが存在します。
          </div>
        )}
      </section>

      {/* ─── ⑫ 件数整合性確認 ─── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-1">
          ⑫ 件数整合性確認（verdicts vs 商品アイテム 差分）
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          verdicts の一意キーは (person_name, product_id)。verdicts は商品ごと・人物ごとに独立しているため、
          同一商品 ID が複数人に共有されていれば verdicts 件数が products.items 合計より多くなる。
          差分が大きい人物は商品データが失われた可能性がある。
        </p>
        {counts && (
          <div className="flex flex-wrap gap-3 mb-4">
            {[
              { label: 'verdicts 合計', value: counts.verdicts_count.toLocaleString() },
              { label: '商品アイテム合計', value: counts.total_items.toLocaleString() },
              {
                label: '差分（verdicts − items）',
                value: (counts.verdicts_count - counts.total_items).toLocaleString(),
              },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-lg border border-gray-200 px-4 py-2 text-center">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-xl font-bold text-slate-800 mt-0.5">{value}</div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500 mb-3">
          ※ 同一 product_id が複数人で共有されている（グループ商品の人物ごと verdict）、
          または products.items が上書きされて商品が消えたが verdict だけ残っている場合に差が生じる。
        </p>
        {hasSignificantDiff && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-4 py-3 text-sm mb-3">
            ⚠ 差分が 10件超の人物が存在します。商品データが失われている可能性があります。
          </div>
        )}
        <div className="overflow-x-auto max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-semibold">人物名</th>
                <th className="px-3 py-2 font-semibold text-right">verdict数</th>
                <th className="px-3 py-2 font-semibold text-right">アイテム数</th>
                <th className="px-3 py-2 font-semibold text-right">差分</th>
              </tr>
            </thead>
            <tbody>
              {verdictDiff.map((row) => (
                <tr key={row.person_name} className="border-t border-gray-100">
                  <td className="px-3 py-2">{row.person_name ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.verdict_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.item_count.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${
                    Math.abs(row.diff) > 50  ? 'text-red-600'    :
                    Math.abs(row.diff) > 10  ? 'text-orange-600' :
                    row.diff !== 0           ? 'text-yellow-600' :
                    'text-gray-400'
                  }`}>
                    {row.diff > 0 ? '+' : ''}{row.diff.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          差分上位50件を表示。abs(diff) が大きい順。totalDiff（絶対値合計）= {totalDiffAbs.toLocaleString()}
        </p>
      </section>

    </div>
  );
}
