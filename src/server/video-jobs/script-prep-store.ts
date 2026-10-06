import 'server-only';
import { and, asc, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { persons as personsTable, pronunciationReadings, videoScriptRequests } from '@/db/schema';
import { personVideoSlug } from './person-slug';
import { VideoJobError } from './job-store';
import { checkReadingInput, kanaOnlyAliases } from '@/lib/video-first3-script';

// 動画「まず見る3作 ショートV1」の台本準備（管理画面 ⇄ Worker）。
// ・登録した読み（pronunciation_readings）: 正本はDB。Workerは生存報告の応答で版が変わったときだけ一覧を受け取る。
// ・台本準備の依頼（video_script_requests）: 全人物の台本準備・停止・再選定。Workerが処理したら handled_at を入れる。
// どちらのテーブルも未作成（本番migration前）の場合は、生存報告・管理画面を止めない（空として扱う）。

export const FIRST3_TEMPLATE_ID = 'oshi-first3-v1';
export type ScriptRequestAction = 'prepare_all' | 'stop' | 'reselect';
export interface ScriptRequest {
  id: number;
  templateId: string;
  action: ScriptRequestAction;
  personName: string | null;
  personSlug: string | null;
}

export function validateReading(sourceText: string, reading: string): { sourceText: string; reading: string } {
  const r = checkReadingInput(sourceText, reading);
  if (!r.ok) throw new VideoJobError(r.error, 400);
  return { sourceText: r.sourceText, reading: r.reading };
}

function isMissingTable(err: unknown): boolean {
  return /relation "?(pronunciation_readings|video_script_requests)"? does not exist/i.test(String(err instanceof Error ? err.message : err));
}

/** 登録済みの読みの一覧と版（最終更新日時+件数。変わったときだけWorkerへ送る）。テーブル未作成なら null */
export async function listPronunciationReadings(): Promise<{ version: string; readings: Array<{ sourceText: string; reading: string; updatedAt: string }> } | null> {
  try {
    const rows = await db.select().from(pronunciationReadings).orderBy(asc(pronunciationReadings.sourceText));
    const latest = rows.reduce((max, r) => Math.max(max, r.updatedAt.getTime()), 0);
    return {
      version: `${latest}:${rows.length}`,
      readings: rows.map((r) => ({ sourceText: r.sourceText, reading: r.reading, updatedAt: r.updatedAt.toISOString() })),
    };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** 読みを登録・更新する（同じ表記は1件。登録すると、その語を使う全人物の読み台本に反映される） */
export async function upsertPronunciationReading(sourceText: string, reading: string): Promise<void> {
  const v = validateReading(sourceText, reading);
  try {
    await db
      .insert(pronunciationReadings)
      .values({ sourceText: v.sourceText, reading: v.reading })
      .onConflictDoUpdate({ target: pronunciationReadings.sourceText, set: { reading: v.reading, updatedAt: sql`NOW()` } });
  } catch (err) {
    if (isMissingTable(err)) throw new VideoJobError('読みの保存先（pronunciation_readings）が未作成です。/admin/db-init でテーブルを作成してください。', 503);
    throw err;
  }
}

/** 台本準備の依頼を追加する（同じ内容の未処理の依頼があれば追加しない） */
export async function createScriptRequest(action: ScriptRequestAction, personNames: string[] = []): Promise<void> {
  try {
    const pending = await db.select().from(videoScriptRequests).where(isNull(videoScriptRequests.handledAt));
    const exists = (personName: string | null) =>
      pending.some((r) => r.templateId === FIRST3_TEMPLATE_ID && r.action === action && (r.personName ?? null) === personName);
    const values = (action === 'reselect' ? personNames : [null])
      .filter((p) => !exists(p))
      .map((personName) => ({ templateId: FIRST3_TEMPLATE_ID, action, personName }));
    if (values.length > 0) await db.insert(videoScriptRequests).values(values);
  } catch (err) {
    if (isMissingTable(err)) throw new VideoJobError('台本準備の依頼の保存先（video_script_requests）が未作成です。/admin/db-init でテーブルを作成してください。', 503);
    throw err;
  }
}

/** Workerへ渡す未処理の依頼（テーブル未作成なら空） */
export async function listPendingScriptRequests(): Promise<ScriptRequest[]> {
  try {
    const rows = await db
      .select()
      .from(videoScriptRequests)
      .where(isNull(videoScriptRequests.handledAt))
      .orderBy(asc(videoScriptRequests.requestedAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      templateId: r.templateId,
      action: r.action as ScriptRequestAction,
      personName: r.personName ?? null,
      personSlug: r.personName ? personVideoSlug(r.personName) : null,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Workerが処理した依頼を処理済みにする */
export async function markScriptRequestsHandled(ids: number[]): Promise<void> {
  const valid = ids.filter((id) => Number.isInteger(id) && id > 0).slice(0, 100);
  if (valid.length === 0) return;
  try {
    await db
      .update(videoScriptRequests)
      .set({ handledAt: sql`NOW()` })
      .where(and(inArray(videoScriptRequests.id, valid), isNull(videoScriptRequests.handledAt)));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
}

/**
 * 人物名の読みの候補（人物登録データの別名 aliases のうち、ひらがな・カタカナだけのもの）。
 * 別名には愛称も混ざり、正しい読みとして確認された値ではないため、自動では使わない。
 * 管理画面で候補として表示し、ユーザーが選んで「登録」したときだけ読みとして保存する。
 */
export async function listPersonReadingCandidates(): Promise<Record<string, string[]>> {
  const rows = await db.select({ name: personsTable.name, aliases: personsTable.aliases, config: personsTable.config }).from(personsTable);
  const result: Record<string, string[]> = {};
  for (const r of rows) {
    const configAliases = (r.config as { aliases?: unknown } | null)?.aliases;
    const candidates = kanaOnlyAliases([r.aliases, configAliases]);
    if (candidates.length > 0) result[r.name] = candidates;
  }
  return result;
}
