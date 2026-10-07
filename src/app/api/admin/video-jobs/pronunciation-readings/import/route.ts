import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { getLatestWorker, VideoJobError } from '@/server/video-jobs/job-store';
import { insertPronunciationReadingsIfAbsent, listPronunciationReadings } from '@/server/video-jobs/script-prep-store';
import { buildUnregisteredReadingRows, MAX_READING_CSV_BYTES, validateReadingImport, type ReadingImportRow } from '@/lib/reading-csv';

export const dynamic = 'force-dynamic';

const SAMPLE_ROWS = 30;
const sample = (rows: ReadingImportRow[], status: ReadingImportRow['status']) => rows.filter((r) => r.status === status).slice(0, SAMPLE_ROWS);

/**
 * 読みCSVの一括登録（ChatGPTで読みを入れて返ってきたCSV）。
 *   { csv, commit: false } → 検証だけ（登録予定・要確認・登録済みでskip・エラーの件数と一部の行）。DBへは書き込まない
 *   { csv, commit: true }  → 同じ検証をし直し、reviewStatus=approved の行だけを登録する（登録済みの語は上書きしない）
 * 行はidと語(sourceText)の両方を、現在の読み未登録の一覧（Workerの最新の報告）と照合する。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { csv?: unknown; commit?: unknown };
  if (typeof body.csv !== 'string' || body.csv.length === 0) return NextResponse.json({ error: 'CSVを選択してください。' }, { status: 400 });
  if (body.csv.length > MAX_READING_CSV_BYTES) return NextResponse.json({ error: 'CSVが大きすぎます（2MBまで）。' }, { status: 400 });
  try {
    const worker = await getLatestWorker();
    const current = buildUnregisteredReadingRows(worker?.capcutStore);
    const registered = new Set((await listPronunciationReadings())?.readings.map((r) => r.sourceText) ?? []);
    const result = validateReadingImport(body.csv, current, registered);
    if (!result.ok) return NextResponse.json({ error: result.fileError }, { status: 400 });
    const preview = {
      counts: result.counts,
      approved: sample(result.rows, 'approved'),
      needsReview: sample(result.rows, 'needs_review'),
      skipped: sample(result.rows, 'skip_duplicate'),
      errors: sample(result.rows, 'error'),
    };
    if (body.commit !== true) return NextResponse.json({ committed: false, ...preview });
    const approved = result.rows.filter((r) => r.status === 'approved');
    const inserted = await insertPronunciationReadingsIfAbsent(approved.map((r) => ({ sourceText: r.sourceText, reading: r.reading })));
    return NextResponse.json({
      committed: true,
      ...preview,
      result: {
        registered: inserted.length,
        // 検証後〜登録の間に他で登録された語も、上書きせずskipに数える
        skipped: result.counts.skip_duplicate + (approved.length - inserted.length),
        needsReview: result.counts.needs_review,
        errors: result.counts.error,
      },
    });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
