import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { maskSecrets } from '@/lib/mask-secrets';
import { MAX_CAPCUT_PREPARE_REQUESTS, requestCapcutPrepare, VideoJobError } from '@/server/video-jobs/job-store';

export const dynamic = 'force-dynamic';

/**
 * CapCut台本の準備依頼。Workerがまだ素材（人物ページの取得結果）を持っていない人物について、
 * Workerに人物ページを取得してもらい、CapCut音声作成待ちに台本・ファイル名を表示できるようにする。
 * 人物は推しサーチの登録人物のみ受け付ける。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { personNames?: unknown };
  const personNames = Array.isArray(body.personNames)
    ? [...new Set(body.personNames.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean))]
    : [];
  if (personNames.length === 0) return NextResponse.json({ error: '人物が選択されていません。' }, { status: 400 });
  if (personNames.length > MAX_CAPCUT_PREPARE_REQUESTS) {
    return NextResponse.json({ error: `台本準備の依頼は一度に${MAX_CAPCUT_PREPARE_REQUESTS}人までです。` }, { status: 400 });
  }
  try {
    const registered = new Set((await getAllPersonsMerged()).map((p) => p.name));
    const unknown = personNames.filter((p) => !registered.has(p));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `登録されていない人物です: ${unknown.join(', ')}` }, { status: 400 });
    }
    const requests = await requestCapcutPrepare(personNames);
    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
