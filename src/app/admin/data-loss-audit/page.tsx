// 読み取り専用フォレンジック調査ページ
// DB書き込み・削除・復旧処理は一切行わない
// ブランチ: audit/post-sync-missing-data
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { LogoutButton } from '@/components/admin/LogoutButton';

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

type WorksBySourceRow = {
  source: string;
  total: number;
  active: number;
  soft_deleted: number;
  last_updated: string | null;
};

type ManualCsvWorkRow = {
  person_name: string;
  id: string;
  title: string;
  type: string;
  status: string;
  deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  person_name: string;
  category: string;
  item_count: number;
  fetched_at: string | null;
};

type ImportHistRow = {
  history_id: string;
  import_type: string;
  executed_at: string;
  file_name: string | null;
  total_rows: number;
  success_count: number;
  skip_count: number;
  error_count: number;
  status: string;
};

type BatchMetaRow = {
  last_run_at: string;
  person_count: number;
  ai_judged: number;
};

type CountsRow = {
  persons_count: number;
  works_count: number;
  active_works_count: number;
  deleted_works_count: number;
  products_rows: number;
  total_items: number;
  verdicts_count: number;
};

const AUDIT_NOTES = [
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
      'work-csv-import route は saveWork() → upsertWork を呼ぶ。CSV作品 ID は "csv-movie-..." 形式、TMDb作品 ID は "tmdb-movie-12345" 形式と異なるため、TMDb 同期による上書きリスクは低い。ただし同一 ID が何らかの理由で生成された場合は全フィールドが上書きされる点に注意。',
  },
  {
    title: 'インポート履歴の対象外操作',
    severity: 'info' as const,
    detail:
      'import_history テーブルに記録されるのは person_csv / work_vod_csv / vod_title_csv のみ。/api/admin/work-csv-import 経由の作品・VOD CSVインポートはこのテーブルに記録されない。作品 CSV インポートの実行履歴はテーブルで追跡できない点に注意。',
  },
];

export default async function DataLossAuditPage() {
  const [
    worksBySourceResult,
    manualCsvWorksResult,
    productsResult,
    importHistResult,
    batchMetaResult,
    countsResult,
  ] = await Promise.all([
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
    db.execute(sql`
      SELECT person_name, id, title, type, status, deleted,
             deleted_at, deleted_by, created_at, updated_at
      FROM works
      WHERE source = 'manual_csv'
      ORDER BY person_name, deleted ASC, created_at DESC
    `),
    db.execute(sql`
      SELECT person_name, category,
             COALESCE(jsonb_array_length(items), 0)::int AS item_count,
             fetched_at
      FROM products
      ORDER BY person_name, category
    `),
    db.execute(sql`
      SELECT history_id, import_type, executed_at, file_name,
             total_rows, success_count, skip_count, error_count, status
      FROM import_history
      ORDER BY executed_at DESC
      LIMIT 30
    `),
    db.execute(sql`
      SELECT last_run_at, person_count, ai_judged
      FROM batch_meta
      WHERE id = 1
    `),
    db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM persons)                                        AS persons_count,
        (SELECT COUNT(*)::int FROM works)                                          AS works_count,
        (SELECT COUNT(*) FILTER (WHERE deleted = false)::int FROM works)           AS active_works_count,
        (SELECT COUNT(*) FILTER (WHERE deleted = true)::int FROM works)            AS deleted_works_count,
        (SELECT COUNT(*)::int FROM products)                                       AS products_rows,
        (SELECT COALESCE(SUM(jsonb_array_length(items)), 0)::int FROM products)    AS total_items,
        (SELECT COUNT(*)::int FROM verdicts)                                       AS verdicts_count
    `),
  ]);

  const worksBySource   = extractRows<WorksBySourceRow>(worksBySourceResult);
  const manualCsvWorks  = extractRows<ManualCsvWorkRow>(manualCsvWorksResult);
  const products        = extractRows<ProductRow>(productsResult);
  const importHistory   = extractRows<ImportHistRow>(importHistResult);
  const batchMeta       = extractRows<BatchMetaRow>(batchMetaResult)[0] ?? null;
  const counts          = extractRows<CountsRow>(countsResult)[0] ?? null;

  const activeManualCsv  = manualCsvWorks.filter((w) => !w.deleted);
  const deletedManualCsv = manualCsvWorks.filter((w) => w.deleted);
  const generatedAt      = new Date().toISOString();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">

      {/* ヘッダー */}
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

      {/* ① 全体サマリー */}
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

      {/* ② 作品ソース別内訳 */}
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
              {worksBySource.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">データなし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ③ manual_csv 論理削除済み作品 */}
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

      {/* ④ manual_csv 有効作品一覧 */}
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
          <div className="overflow-x-auto max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
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
                    <td className="px-3 py-2 font-mono text-xs">{w.status}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmt(w.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmt(w.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ⑤ 商品アイテム数（人物×カテゴリ） */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">
          ⑤ 商品アイテム数（人物×カテゴリ）
          <span className="ml-2 text-sm font-normal text-slate-500">（{products.length}行）</span>
        </h2>
        <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
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
              {products.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">データなし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ⑥ CSVインポート履歴 */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">⑥ CSVインポート履歴（直近30件）</h2>
        <p className="text-xs text-gray-500 mb-3">
          import_history テーブルの記録。person_csv / work_vod_csv / vod_title_csv のみが対象。
          work-csv-import ルート経由の作品 CSV はこのテーブルに記録されない点に注意。
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
                      h.status === 'completed'     ? 'text-green-700' :
                      h.status === 'failed'         ? 'text-red-600'   :
                      h.status === 'partial_error'  ? 'text-yellow-600' :
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

      {/* ⑦ コード分析によるリスク評価 */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">⑦ コード分析によるリスク評価</h2>
        <div className="space-y-3 text-sm">
          {AUDIT_NOTES.map(({ title, severity, detail }) => (
            <div
              key={title}
              className={`rounded-lg border p-4 ${
                severity === 'high'   ? 'border-red-200 bg-red-50'     :
                severity === 'medium' ? 'border-yellow-200 bg-yellow-50' :
                'border-blue-200 bg-blue-50'
              }`}
            >
              <div className={`text-xs font-bold uppercase tracking-wide mb-1 ${
                severity === 'high'   ? 'text-red-700'    :
                severity === 'medium' ? 'text-yellow-700' :
                'text-blue-700'
              }`}>
                {severity === 'high' ? '🔴 HIGH' : severity === 'medium' ? '🟡 MEDIUM' : 'ℹ INFO'}
              </div>
              <div className="font-semibold text-slate-800 mb-1">{title}</div>
              <div className="text-gray-700 text-xs leading-relaxed">{detail}</div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
