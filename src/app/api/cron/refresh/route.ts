import { NextRequest, NextResponse } from 'next/server';
import { processAllPersons } from '@/lib/batch-processor';

// GET /api/cron/refresh
// Vercel Cron Jobs から毎日自動実行
// 認証: Authorization: Bearer {CRON_SECRET} ヘッダーを検証
// （admin-session Cookie は不要 - Cron はブラウザを経由しないため）
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET が設定されていません' }, { status: 503 });
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 });
  }

  try {
    const summary = await processAllPersons();
    return NextResponse.json({
      ok: true,
      personCount: summary.persons.length,
      totalAiJudged: summary.totalAiCalls,
      elapsed: `${((summary.finishedAt - summary.startedAt) / 1000).toFixed(1)}秒`,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
