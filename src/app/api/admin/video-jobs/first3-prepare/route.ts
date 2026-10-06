import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { maskSecrets } from '@/lib/mask-secrets';
import { VideoJobError } from '@/server/video-jobs/job-store';
import { createScriptRequest, type ScriptRequestAction } from '@/server/video-jobs/script-prep-store';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set<ScriptRequestAction>(['prepare_all', 'stop', 'reselect']);
const MAX_RESELECT = 50;

/**
 * まず見る3作 ショートV1の台本準備をWorkerへ依頼する（動画は生成しない）。
 *   prepare_all: 推しサーチの全登録人物の3作品を順に選定し、台本を準備する（選定済みで新しい人物はWorkerがskip）
 *   stop:        全人物の台本準備を止める
 *   reselect:    指定した人物だけ3作品を選び直す（CapCut音声を作った後に選び直すと録り直しになることがある）
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; personNames?: unknown };
  const action = body.action as ScriptRequestAction;
  if (!ACTIONS.has(action)) return NextResponse.json({ error: '不正な操作です。' }, { status: 400 });
  try {
    let personNames: string[] = [];
    if (action === 'reselect') {
      personNames = Array.isArray(body.personNames)
        ? [...new Set(body.personNames.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean))]
        : [];
      if (personNames.length === 0) return NextResponse.json({ error: '人物が選択されていません。' }, { status: 400 });
      if (personNames.length > MAX_RESELECT) return NextResponse.json({ error: `再選定は一度に${MAX_RESELECT}人までです。` }, { status: 400 });
      const registered = new Set((await getAllPersonsMerged()).map((p) => p.name));
      const unknown = personNames.filter((p) => !registered.has(p));
      if (unknown.length > 0) return NextResponse.json({ error: `登録されていない人物です: ${unknown.join(', ')}` }, { status: 400 });
    }
    await createScriptRequest(action, personNames);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
