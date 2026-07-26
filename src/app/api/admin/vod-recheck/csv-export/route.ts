// POST /api/admin/vod-recheck/csv-export
// 選択したVOD再確認対象を調査用CSVとして出力する。
// 同一workIdに複数人物が紐づく場合は、既存の作品CSV運用（csv-export/route.ts）と同様に
// 1行1人物で出力する（personName列で複数行に分かれる）。
//
// workIdの解決は resolveActiveWorkTargets() を使い、候補一覧・CSVインポートと同じ
// 対象判定ロジックを共有する（旧workId(work_aliases)はcanonical workIdへ解決される）。
//
// 末尾に取り込み用の5列（vodService, availabilityType, confidence, sourceUrl, note）を
// 空欄で追加する。これは /api/admin/vod-recheck/csv-import が要求する列と同じ名前・順序で、
// 利用者がこのCSVをNumbers/Excel等で開いて空欄を埋め、同じ作品に複数サービスがあれば行を
// 複製し、そのまま管理画面のCSV取り込みへ選択・プレビュー・反映できるようにするため。
// 調査対象の補助列（workTitle等）は取り込み時に無視される（parseAndValidateImportCsvが
// 列名で workId/vodService 等だけを参照するため、余分な列があっても解析に影響しない）。
//
// body: { items: Array<{ personName: string; workId: string }> }  最大 MAX_EXPORT_ITEMS 件
import { NextRequest, NextResponse } from 'next/server';
import { resolveVodRecheckExportData } from '@/lib/vod-recheck-export-data';
import { buildVodRecheckExportCsv } from '@/lib/vod-recheck-csv-export';

export const dynamic = 'force-dynamic';

const MAX_EXPORT_ITEMS = 500;

interface ExportItem {
  personName: string;
  workId: string;
}

function isExportItem(v: unknown): v is ExportItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.personName === 'string' && typeof o.workId === 'string' && o.workId.trim() !== '';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { items?: unknown };
  const { items } = body;

  if (!Array.isArray(items) || items.length === 0 || !items.every(isExportItem)) {
    return NextResponse.json({ error: 'items は { personName, workId } の配列である必要があります' }, { status: 400 });
  }
  if (items.length > MAX_EXPORT_ITEMS) {
    return NextResponse.json({ error: `一度にエクスポートできるのは最大 ${MAX_EXPORT_ITEMS} 件です` }, { status: 400 });
  }

  try {
    // 候補一覧・CSVインポートと共通の対象判定ロジックでworkIdを解決する
    // （通常は候補一覧由来のcanonical workIdのみだが、旧workIdが渡された場合もcanonicalへ解決する）
    const { rows: dataRows } = await resolveVodRecheckExportData(items as ExportItem[]);

    if (dataRows.length === 0) {
      return NextResponse.json({ error: '出力対象の作品が見つかりません（非公開・削除済み、または存在しないworkIdです）' }, { status: 400 });
    }

    const csv = buildVodRecheckExportCsv(dataRows);

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`vod-recheck_${date}.csv`)}`,
      },
    });
  } catch (err) {
    console.error('[vod-recheck/csv-export] error:', err);
    return NextResponse.json({ error: 'CSV出力に失敗しました' }, { status: 500 });
  }
}
