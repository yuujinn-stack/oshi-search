import { NextResponse } from 'next/server';
import { processAllPersons } from '@/lib/batch-processor';

// POST /api/admin/batch
// 管理画面の「全員バッチ処理」ボタンから呼び出す
// 認証: middleware で admin-session Cookie を検証済み
// 注意: 処理時間が長い（35人×4カテゴリ ≒ 1〜2分）
export async function POST() {
  try {
    const summary = await processAllPersons();

    const elapsed = ((summary.finishedAt - summary.startedAt) / 1000).toFixed(1);
    const errors = summary.persons.filter((p) => p.error);
    const totalStored = summary.persons.reduce((s, r) => s + r.stored, 0);
    const totalAuto = summary.persons.reduce((s, r) => s + r.autoClassified, 0);

    return NextResponse.json({
      ok: true,
      elapsed: `${elapsed}秒`,
      personCount: summary.persons.length,
      totalStored,
      totalAutoClassified: totalAuto,
      totalAiJudged: summary.totalAiCalls,
      errors: errors.map((e) => ({ name: e.personName, error: e.error })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
