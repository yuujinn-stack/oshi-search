import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { SnsOutputError } from '@/lib/video-sns-output';
import { getSnsCtaSettings, resetSnsCtaSettings, saveSnsCtaSettings, snsCtaSettingsScope } from '@/server/video-jobs/sns-cta-settings';

export const dynamic = 'force-dynamic';

/** SNS別CTA設定（動画生成の最後のCTAを SNS ごとに変える設定）の取得 */
export async function GET() {
  try {
    return NextResponse.json({ ...(await getSnsCtaSettings()), scope: snsCtaSettingsScope() });
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}

/** 保存（body.settings）。body.reset=true なら既定値に戻す */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { settings?: unknown; reset?: unknown };
  try {
    const settings = body.reset === true ? await resetSnsCtaSettings() : await saveSnsCtaSettings(body.settings);
    return NextResponse.json({ settings, saved: body.reset !== true, storage: true, scope: snsCtaSettingsScope() });
  } catch (err) {
    if (err instanceof SnsOutputError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
