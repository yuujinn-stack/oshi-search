// POST /api/admin/vod-recheck/csv-import
// VOD再確認調査の結果CSVを取り込み、manual_csv として配信情報を保存する。
// 必須列: workId, vodService　（1作品1サービス1行）
// 任意列: availabilityType（flatrate/rent/buy/free/unknown）, sourceUrl, confidence, note
//
// CSVはファイル選択・貼り付けのどちらから来ても同じ文字列としてこのAPIへ届くため、
// 検証ロジックは完全に共通（ファイル選択と貼り付けで結果が食い違うことはない）。
//
// 実体は src/lib/vod-recheck-csv-import.ts の runVodRecheckCsvImport()。
// workIdのcanonical解決・非活性化作品の拒否・manual_csv保存・監査ログ・処理状態変更の
// ロジックはこの1箇所に集約されている。
//
// commit=false（デフォルト）: プレビューのみ・DB変更なし。commit=true: 実際に保存 + 監査ログ記録。
// いずれの場合も公開状態（status/deleted）は変更しない（vod_dataのみ更新）。
import { NextRequest, NextResponse } from 'next/server';
import { runVodRecheckCsvImport, type VodRecheckCsvImportMode } from '@/lib/vod-recheck-csv-import';

export const dynamic = 'force-dynamic';

const VALID_MODES: readonly string[] = ['merge', 'chatgpt_full_sync'];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    csv?: unknown; commit?: unknown; mode?: unknown; expectedWorkIds?: unknown;
  };
  const { csv, commit, mode, expectedWorkIds } = body;

  if (typeof csv !== 'string' || !csv.trim()) {
    return NextResponse.json({ error: 'csv（文字列）が必要です' }, { status: 400 });
  }
  if (mode !== undefined && (typeof mode !== 'string' || !VALID_MODES.includes(mode))) {
    return NextResponse.json({ error: `不正な mode です: ${String(mode)}` }, { status: 400 });
  }
  if (expectedWorkIds !== undefined && (!Array.isArray(expectedWorkIds) || !expectedWorkIds.every((v) => typeof v === 'string'))) {
    return NextResponse.json({ error: 'expectedWorkIds は文字列配列である必要があります' }, { status: 400 });
  }

  const result = await runVodRecheckCsvImport(
    csv,
    Boolean(commit),
    (mode as VodRecheckCsvImportMode | undefined) ?? 'merge',
    expectedWorkIds as string[] | undefined,
  );
  return NextResponse.json(result.body, { status: result.status });
}
