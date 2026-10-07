import { NextRequest } from 'next/server';
import {
  touchVideoJobHeartbeat,
  upsertWorkerHeartbeat,
  type CapcutStoreEntry,
  type CapcutStoreReport,
  type CapcutStoreStatus,
  type First3QueueProgress,
  type First3ScriptStatus,
  type WorkerTemplateInfo,
} from '@/server/video-jobs/job-store';
import { listPendingScriptRequests, listPronunciationReadings, markScriptRequestsHandled } from '@/server/video-jobs/script-prep-store';
import { handleWorkerRequest, num, parseJobId, str } from '@/server/video-jobs/worker-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const capcutStatuses = new Set<CapcutStoreStatus>(['ready', 'stale', 'missing', 'check_failed']);
const scriptStatuses = new Set<First3ScriptStatus>(['ready_script', 'needs_reading', 'insufficient_works', 'pending', 'error']);
const queueStatuses = new Set<First3QueueProgress['status']>(['idle', 'running', 'done', 'stopped', 'failed']);

/** Workerから届いた人物×テンプレートの状態（型・長さを検証する） */
function sanitizeEntries(raw: unknown[]): CapcutStoreEntry[] {
  return raw
    .slice(0, 2000)
    .map((e) => e as Record<string, unknown>)
    .filter((e) => typeof e.personName === 'string' && typeof e.templateId === 'string' && capcutStatuses.has(e.status as CapcutStoreStatus))
    .map((e) => ({
      personName: str(e.personName, 100)!,
      personSlug: str(e.personSlug, 100) ?? '',
      templateId: str(e.templateId, 100)!,
      status: e.status as CapcutStoreStatus,
      message: str(e.message, 500) ?? '',
      scriptText: str(e.scriptText, 3000),
      speechScriptText: str(e.speechScriptText, 3000),
      unresolvedReadings: (Array.isArray(e.unresolvedReadings) ? e.unresolvedReadings : [])
        .slice(0, 20)
        .map((u) => u as Record<string, unknown>)
        .filter((u) => (u.kind === 'person' || u.kind === 'work' || u.kind === 'service' || u.kind === 'other') && typeof u.text === 'string')
        .map((u) => ({ kind: u.kind as 'person' | 'work' | 'service' | 'other', text: str(u.text, 200)! })),
      scriptHash: str(e.scriptHash, 64),
      savedScriptHash: str(e.savedScriptHash, 64),
      duration: num(e.duration),
      updatedAt: str(e.updatedAt, 40),
      fileBaseName: str(e.fileBaseName, 200) ?? '',
      ...(scriptStatuses.has(e.scriptStatus as First3ScriptStatus)
        ? { scriptStatus: e.scriptStatus as First3ScriptStatus, scriptError: str(e.scriptError, 500), selectedAt: str(e.selectedAt, 40) }
        : {}),
    }));
}

/** まず見る3作の台本準備キューの進捗 */
function sanitizeQueue(raw: unknown): First3QueueProgress | undefined {
  const q = raw as Record<string, unknown> | undefined;
  if (!q || !queueStatuses.has(q.status as First3QueueProgress['status'])) return undefined;
  const c = (q.counts ?? {}) as Record<string, unknown>;
  return {
    status: q.status as First3QueueProgress['status'],
    requestedAt: str(q.requestedAt, 40),
    total: num(q.total) ?? 0,
    processed: num(q.processed) ?? 0,
    reselectPending: num(q.reselectPending) ?? 0,
    counts: { selected: num(c.selected) ?? 0, insufficient: num(c.insufficient) ?? 0, skipped: num(c.skipped) ?? 0, errors: num(c.errors) ?? 0 },
    message: str(q.message, 300),
    updatedAt: str(q.updatedAt, 40) ?? new Date().toISOString(),
  };
}

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
        // テンプレート共通のCapCut音声（送られてきたテンプレートだけ）
        ...(t.sharedCapcut && typeof t.sharedCapcut === 'object'
          ? {
              sharedCapcut: {
                ready: (t.sharedCapcut as Record<string, unknown>).ready === true,
                durationSeconds: num((t.sharedCapcut as Record<string, unknown>).durationSeconds),
                message: str((t.sharedCapcut as Record<string, unknown>).message, 300) ?? '',
              },
            }
          : {}),
      }));
    const persons = (Array.isArray(body.persons) ? body.persons : [])
      .filter((p): p is string => typeof p === 'string')
      .slice(0, 1000)
      .map((p) => p.slice(0, 100));
    // CapCut保存済み音声の状態（送られてきたときだけ。型・長さを検証して保存）
    let capcutStore: CapcutStoreReport | undefined;
    const rawCapcut = body.capcutStore as Record<string, unknown> | undefined;
    if (rawCapcut && Array.isArray(rawCapcut.entries)) {
      capcutStore = {
        inboxDir: str(rawCapcut.inboxDir, 200) ?? '',
        reportedAt: str(rawCapcut.reportedAt, 40) ?? new Date().toISOString(),
        entries: sanitizeEntries(rawCapcut.entries),
        prepareFailures: (Array.isArray(rawCapcut.prepareFailures) ? rawCapcut.prepareFailures : [])
          .slice(0, 100)
          .map((f) => f as Record<string, unknown>)
          .filter((f) => typeof f.personName === 'string')
          .map((f) => ({
            personName: str(f.personName, 100)!,
            message: str(f.message, 500) ?? '',
            at: str(f.at, 40) ?? new Date().toISOString(),
          })),
        ...(Array.isArray(rawCapcut.scriptOnlyEntries) ? { scriptOnlyEntries: sanitizeEntries(rawCapcut.scriptOnlyEntries) } : {}),
        ...(sanitizeQueue(rawCapcut.first3Queue) ? { first3Queue: sanitizeQueue(rawCapcut.first3Queue) } : {}),
      };
    }
    const capcutPrepareRequests = await upsertWorkerHeartbeat({ workerId, version: str(body.version, 50), templates, persons, capcutStore });
    if (typeof body.currentJobId === 'string') {
      await touchVideoJobHeartbeat(parseJobId(body.currentJobId), workerId);
    }
    // まず見る3作の台本準備: Workerが処理した依頼を処理済みにし、未処理の依頼と（版が変わっていれば）登録済みの読みを返す
    if (Array.isArray(body.handledScriptRequestIds)) {
      await markScriptRequestsHandled(body.handledScriptRequestIds.filter((id): id is number => typeof id === 'number'));
    }
    const scriptRequests = await listPendingScriptRequests();
    const readings = typeof body.readingsVersion === 'string' ? await listPronunciationReadings() : null;
    const pronunciationReadings =
      readings && readings.version !== body.readingsVersion
        ? { version: readings.version, readings: readings.readings.map((r) => ({ sourceText: r.sourceText, reading: r.reading })) }
        : undefined;
    // 管理画面から依頼されたCapCut台本の準備（Workerが人物ページを取得する）
    return { ok: true, capcutPrepareRequests, scriptRequests, ...(pronunciationReadings ? { pronunciationReadings } : {}) };
  });
}
