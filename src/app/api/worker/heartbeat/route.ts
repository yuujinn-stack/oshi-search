import { NextRequest } from 'next/server';
import { touchVideoJobHeartbeat, upsertWorkerHeartbeat, type WorkerTemplateInfo } from '@/server/video-jobs/job-store';
import { handleWorkerRequest, num, parseJobId, str } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Workerの生存報告。テンプレート一覧（正本はoshi-video-makerのVIDEO_TEMPLATE_REGISTRY）と
 * 対応人物名を毎回まとめて受け取り、video_workersへ保存する。実行中ジョブがあればそのheartbeatも更新する。
 */
export async function POST(req: NextRequest) {
  return handleWorkerRequest(req, async ({ workerId, body }) => {
    const templates: WorkerTemplateInfo[] = (Array.isArray(body.templates) ? body.templates : [])
      .slice(0, 50)
      .map((t) => t as Record<string, unknown>)
      .filter((t) => typeof t.templateId === 'string')
      .map((t) => ({
        templateId: str(t.templateId, 100)!,
        name: str(t.name, 200) ?? String(t.templateId),
        description: str(t.description, 500) ?? '',
        version: num(t.version) ?? 1,
        aspectRatio: str(t.aspectRatio, 20) ?? undefined,
        narrationModes: (Array.isArray(t.narrationModes) ? t.narrationModes : [])
          .filter((m): m is string => m === 'none' || m === 'auto' || m === 'capcut'),
      }));
    const persons = (Array.isArray(body.persons) ? body.persons : [])
      .filter((p): p is string => typeof p === 'string')
      .slice(0, 1000)
      .map((p) => p.slice(0, 100));
    await upsertWorkerHeartbeat({ workerId, version: str(body.version, 50), templates, persons });
    if (typeof body.currentJobId === 'string') {
      await touchVideoJobHeartbeat(parseJobId(body.currentJobId), workerId);
    }
    return { ok: true };
  });
}
