import { NextRequest, NextResponse } from 'next/server';
import { getWorksForImport } from '@/lib/work-store';
import { batchUpdateVodData } from '@/db/write';
import {
  buildImportPreview,
  buildSavePlan,
  collectWorkPairs,
  parseVodImportCsv,
  validateApprovals,
} from '@/lib/vod-csv-import';

export type { ImportPreviewRow } from '@/lib/vod-csv-import';

// Vercel 実行時間上限（秒）。同期モードで大量作品を処理する場合のタイムアウト対策。
export const maxDuration = 60;

// POST /api/admin/csv-import
// Preview: { csvContent, commit: false, personName?, syncMode? }
// Save:    { csvContent, commit: true, personName?, syncMode?, fingerprint, approvals?: RowApprovalInput[] }
//   保存時はクライアントの行データを使わず、同じ CSV からサーバー側でプレビューを再計算する。
//   fingerprint（プレビュー時に返した値）が一致しない＝CSV・DB・モードがプレビュー後に変わった → 409。
//   approvals は「サーバーが保留と判定した Prime Video 行」に、行内容が一致する場合だけ適用する。
// 照合キー: personName + workId（workId 単体では別人物の作品を混入させない）
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const {
    csvContent,
    commit = false,
    personName: bodyPersonName = '',
    syncMode = false,
    fingerprint,
    approvals,
  } = body as {
    csvContent?: string;
    commit?: boolean;
    personName?: string;
    syncMode?: boolean;
    fingerprint?: string;
    approvals?: unknown;
  };

  if (!csvContent || typeof csvContent !== 'string') {
    return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
  }
  const parsed = parseVodImportCsv(csvContent, typeof bodyPersonName === 'string' ? bodyPersonName : '');
  if ('error' in parsed) return NextResponse.json(parsed, { status: 400 });

  // CSVに登場する (personName, workId) ペアだけを一括取得（1クエリ）
  const pairs = collectWorkPairs(parsed.rows);
  const workMap = await getWorksForImport(pairs);
  const preview = buildImportPreview(parsed.rows, workMap, syncMode === true);

  // ── PREVIEW ──
  if (!commit) {
    console.log(`[VOD CSV IMPORT] preview done in ${Date.now() - t0}ms (${pairs.length} unique works, ${parsed.rows.length} rows)`);
    return NextResponse.json(preview);
  }

  // ── SAVE ──
  if (typeof fingerprint !== 'string' || fingerprint !== preview.fingerprint) {
    return NextResponse.json(
      { error: 'プレビュー後にCSV・既存データ・モードのいずれかが変わりました。もう一度プレビューしてから保存してください。' },
      { status: 409 },
    );
  }
  const checked = validateApprovals(preview.previewRows, approvals);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const plan = buildSavePlan(preview, checked.approved, workMap, new Date());

  if (plan.worksToUpdate.length > 0) {
    try {
      await batchUpdateVodData(plan.worksToUpdate, preview.syncMode);
    } catch (dbErr) {
      const msg = String(dbErr);
      console.error(`[VOD CSV IMPORT] batchUpdateVodData failed: ${msg}`);
      return NextResponse.json({ error: `DB更新中にエラーが発生しました: ${msg}` }, { status: 500 });
    }
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[VOD CSV IMPORT] save done in ${elapsed}ms` +
    ` (${plan.savedWorkCount} works, ${plan.savedProviderCount} providers added/updated` +
    ` [approved ${plan.approvedProviderCount}], ${plan.deletedProviderCount} deleted, ${plan.suppressedDeleteCount} delete suppressed, ${plan.heldProviderCount} held)`,
  );

  return NextResponse.json({
    syncMode: preview.syncMode,
    savedWorkCount: plan.savedWorkCount,
    savedProviderCount: plan.savedProviderCount,
    deletedProviderCount: plan.deletedProviderCount,
    approvedProviderCount: plan.approvedProviderCount,
    approvedSkippedCount: plan.approvedSkippedCount,
    heldProviderCount: plan.heldProviderCount,
    suppressedDeleteCount: plan.suppressedDeleteCount,
    deleteBlockedReason: plan.deleteBlockedReason,
    errors: plan.errors,
    elapsedMs: elapsed,
  });
}
