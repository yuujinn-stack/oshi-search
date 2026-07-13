import { NextResponse } from 'next/server';
import {
  getSystemUsageReport,
  checkRefreshRateLimit,
  setRefreshRateLimit,
  clearCache,
} from '@/lib/system-usage/aggregator';
import { saveSnapshots, cleanOldSnapshots } from '@/lib/system-usage/snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const report = await getSystemUsageReport(false);
    return NextResponse.json(report);
  } catch (err) {
    console.error('[system-usage] GET error:', String(err));
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (body.action !== 'refresh') {
    return NextResponse.json({ error: 'action は "refresh" のみ有効です' }, { status: 400 });
  }

  const rateCheck = await checkRefreshRateLimit();
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: `更新は60秒に1回まで可能です（あと${rateCheck.remainingSeconds}秒）` },
      { status: 429 },
    );
  }

  try {
    await setRefreshRateLimit();
    await clearCache();

    const report = await getSystemUsageReport(true);

    // Save snapshots and clean up old ones (non-blocking, errors are swallowed)
    Promise.all([
      saveSnapshots(report.services),
      cleanOldSnapshots(),
    ]).catch((e) => console.error('[system-usage] snapshot error:', String(e)));

    return NextResponse.json(report);
  } catch (err) {
    console.error('[system-usage] refresh error:', String(err));
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
