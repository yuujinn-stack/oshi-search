import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getFirst3ManualCandidates } from '@/server/video-jobs/first3-source';
import { maskSecrets } from '@/lib/mask-secrets';
import { VideoJobError } from '@/server/video-jobs/job-store';
import {
  createExclusionRequest,
  createReplaceOneRequest,
  createScriptRequest,
  excludeOneAction,
  unexcludeAction,
  videoTitleAction,
  type ScriptRequestAction,
} from '@/server/video-jobs/script-prep-store';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set<ScriptRequestAction>(['prepare_all', 'stop', 'reselect']);
const MAX_RESELECT = 50;

/**
 * まず見る3作 ショートV1の台本準備をWorkerへ依頼する（動画は生成しない）。
 *   prepare_all: 推しサーチの全登録人物の3作品を順に選定し、台本を準備する（選定済みで新しい人物はWorkerがskip）
 *   stop:        全人物の台本準備を止める
 *   reselect:    指定した人物だけ3作品を選び直す（CapCut音声を作った後に選び直すと録り直しになることがある）
 *   replace_one: 指定した人物の1作品だけを変更する（personName・slot=1〜3・workId=手動で選んだ作品ID、null=おすすめに自動変更）
 *   exclude_one: その枠の作品を除外して、おすすめ作品に自動変更する（personName・slot。代わりが無ければ除外しない）
 *   vodcheck_one: その枠の作品を「配信確認待ち」にして自動変更する（配信に疑義がある作品。解除するまで候補にしない）
 *   unexclude:   除外・配信確認待ちを解除する（personName・workId。3作品は変えない）
 *   video_title: 選定中の作品の動画用の表示名を設定する（personName・workId・videoTitle。空=解除。正式名称は変えない）
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    personNames?: unknown;
    personName?: unknown;
    slot?: unknown;
    workId?: unknown;
    videoTitle?: unknown;
  };
  if (body.action === 'video_title') {
    try {
      const personName = typeof body.personName === 'string' ? body.personName.trim() : '';
      if (!personName) return NextResponse.json({ error: '人物が選択されていません。' }, { status: 400 });
      const workId = typeof body.workId === 'string' ? body.workId : '';
      const videoTitle = typeof body.videoTitle === 'string' ? body.videoTitle : body.videoTitle === null ? null : undefined;
      if (videoTitle === undefined) return NextResponse.json({ error: '動画用の表示名が不正です。' }, { status: 400 });
      // その人物の出演作品だけ（人物ページの「出演作品」と同じデータ）
      const own = await getFirst3ManualCandidates(personName);
      if (!own) return NextResponse.json({ error: `登録されていない人物です: ${personName}` }, { status: 400 });
      if (!own.candidates.some((c) => c.id === workId)) {
        return NextResponse.json({ error: `選んだ作品は ${personName} の出演作品ではありません。` }, { status: 400 });
      }
      const added = await createExclusionRequest(personName, videoTitleAction(workId, videoTitle));
      return NextResponse.json({ ok: true, alreadyPending: added === 0 });
    } catch (err) {
      if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
      return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
    }
  }
  if (body.action === 'exclude_one' || body.action === 'vodcheck_one' || body.action === 'unexclude') {
    try {
      const personName = typeof body.personName === 'string' ? body.personName.trim() : '';
      if (!personName) return NextResponse.json({ error: '人物が選択されていません。' }, { status: 400 });
      if (!(await getAllPersonsMerged()).some((p) => p.name === personName)) {
        return NextResponse.json({ error: `登録されていない人物です: ${personName}` }, { status: 400 });
      }
      const action =
        body.action === 'unexclude'
          ? unexcludeAction(typeof body.workId === 'string' ? body.workId : '')
          : excludeOneAction(typeof body.slot === 'number' ? body.slot : NaN, body.action === 'vodcheck_one' ? 'vod_check' : 'exclude');
      const added = await createExclusionRequest(personName, action);
      return NextResponse.json({ ok: true, alreadyPending: added === 0 });
    } catch (err) {
      if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
      return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
    }
  }
  if (body.action === 'replace_one') {
    try {
      const personName = typeof body.personName === 'string' ? body.personName.trim() : '';
      if (!personName) return NextResponse.json({ error: '人物が選択されていません。' }, { status: 400 });
      if (!(await getAllPersonsMerged()).some((p) => p.name === personName)) {
        return NextResponse.json({ error: `登録されていない人物です: ${personName}` }, { status: 400 });
      }
      const slot = typeof body.slot === 'number' ? body.slot : NaN;
      const workId = typeof body.workId === 'string' ? body.workId : body.workId === null || body.workId === undefined ? null : undefined;
      if (workId === undefined) return NextResponse.json({ error: '作品IDが不正です。' }, { status: 400 });
      // 手動選択の作品は、その人物の出演作品（人物ページの「出演作品」と同じデータ）にあるものだけ受け付ける
      if (workId !== null) {
        const own = await getFirst3ManualCandidates(personName);
        if (!own?.candidates.some((c) => c.id === workId)) {
          return NextResponse.json({ error: `選んだ作品は ${personName} の出演作品ではありません。候補一覧を開き直してください。` }, { status: 400 });
        }
      }
      const added = await createReplaceOneRequest(personName, slot, workId);
      return NextResponse.json({ ok: true, alreadyPending: added === 0 });
    } catch (err) {
      if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
      return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
    }
  }
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
    const added = await createScriptRequest(action, personNames);
    // 同じ依頼がまだWorkerで処理されていない（連続で押した）場合は追加しない。その旨を画面に出す
    return NextResponse.json({ ok: true, alreadyPending: added === 0 });
  } catch (err) {
    if (err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
