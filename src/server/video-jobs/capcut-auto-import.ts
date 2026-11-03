import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { isFollowTemplateId } from '@/lib/video-follow-reel';
import { isRegisteredReelId, REGISTERED_TEMPLATE_CATEGORY } from '@/lib/video-registered-groups';
import { isSiteTemplateId, SITE_TEMPLATE_CATEGORY } from '@/lib/video-site-reel';
import { createVideoJobs, VideoJobError, type VideoJob } from './job-store';

// フォロー獲得リール（10種類）・登録グループ紹介のリール（5種類）の CapCut 音声の自動取り込み（Worker の CapCut 受信フォルダ _inbox から）。
//
// ・手動の取り込み（管理画面の「詳細」→ WAV・SRT を選ぶ →「音声付き動画を生成」）と同じ処理をそのまま使う:
//   WAV・SRT はこのジョブ専用のパス video-jobs/{元のジョブID}/capcut-{乱数}.wav|.srt へ Vercel Blob に直接アップロードし
//   （許可は issueCapcutUploadToken。手動の /api/admin/video-jobs/{id}/capcut-upload と共通）、
//   音声付きの動画は createVideoJobs（narrationMode=capcut・template_input.audio）で別のジョブとして作る。
//   シーン・台本は元のジョブから付け直し、確認済みの事実も確かめ直す（applyFollowAudioSource。手動と同じ）。
// ・Worker は受信フォルダのファイル名「{人物slug}__{templateId}__{ジョブIDの先頭8桁}.wav / .srt」から元のジョブを探す。
//   ジョブID・人物slug・テンプレート・状態（完了した音声なし動画）がすべて合うときだけ受け付ける（別の人・別の動画に付けない）。

const CAPCUT_UPLOAD_LIMITS = {
  wav: { ext: 'wav', contentType: 'audio/wav', maxBytes: 60 * 1024 * 1024 },
  srt: { ext: 'srt', contentType: 'text/plain', maxBytes: 1024 * 1024 },
} as const;
export type CapcutUploadKind = keyof typeof CAPCUT_UPLOAD_LIMITS;
const TOKEN_TTL_MS = 15 * 60_000;

export interface CapcutUploadToken {
  pathname: string;
  clientToken: string;
  contentType: string;
}

/**
 * 音声なし動画のジョブに付ける CapCut の WAV・SRT を、Vercel Blob へ直接アップロードするための一時許可（ファイル本体はAPIを通らない）。
 * 「このジョブ専用のパス・種類と大きさの上限・15分で失効・上書き不可」に限定する。ジョブの確認は呼び出し側で行う
 */
export async function issueCapcutUploadToken(jobId: string, kind: CapcutUploadKind, fileSizeBytes: number): Promise<CapcutUploadToken> {
  const limit = CAPCUT_UPLOAD_LIMITS[kind];
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > limit.maxBytes) {
    throw new VideoJobError(`ファイルの大きさが不正です（${limit.ext.toUpperCase()} は ${limit.maxBytes / 1024 / 1024}MB まで）`, 400);
  }
  const pathname = `video-jobs/${jobId}/capcut-${randomBytes(8).toString('hex')}.${limit.ext}`;
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes: [limit.contentType],
    maximumSizeInBytes: limit.maxBytes,
    validUntil: Date.now() + TOKEN_TTL_MS,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return { pathname, clientToken, contentType: limit.contentType };
}

/** 受信フォルダのファイル名から読み取った、音声を付ける元のジョブの手がかり */
export interface CapcutAutoKey {
  jobKey: string;
  personSlug: string;
  templateId: string;
}

export const CAPCUT_JOB_KEY_PATTERN = /^[0-9a-f]{8}$/;

type JobRow = typeof videoGenerationJobs.$inferSelect;

/** 元のジョブ（完了したフォロー獲得リール・登録グループ紹介のリールの音声なし動画）を探す。1件に決まらない・条件に合わないときは理由つきで拒否する */
export async function findCapcutAutoSource(key: CapcutAutoKey): Promise<JobRow> {
  if (!CAPCUT_JOB_KEY_PATTERN.test(key.jobKey)) throw new VideoJobError('ファイル名のジョブID（先頭8桁の英数字）が不正です。', 400);
  if (!isFollowTemplateId(key.templateId) && !isRegisteredReelId(key.templateId) && !isSiteTemplateId(key.templateId)) throw new VideoJobError(`自動取り込みに対応していないテンプレートです: ${key.templateId}`, 400);
  const rows = await db
    .select()
    .from(videoGenerationJobs)
    .where(like(sql`${videoGenerationJobs.id}::text`, `${key.jobKey}%`))
    .limit(2);
  if (rows.length === 0) throw new VideoJobError(`ジョブ ${key.jobKey} が見つかりません（管理画面の「詳細」に表示されたファイル名で書き出してください）。`, 404);
  if (rows.length > 1) throw new VideoJobError(`ジョブ ${key.jobKey} が1件に決まりません（管理画面の手動の取り込みを使ってください）。`, 409);
  const job = rows[0];
  if (job.templateId !== key.templateId) throw new VideoJobError(`ジョブ ${key.jobKey} は別のテンプレート（${job.templateId}）の動画です。`, 409);
  if (job.personSlug !== key.personSlug) throw new VideoJobError(`ジョブ ${key.jobKey} は別の人物・グループ（${job.personName}）の動画です。`, 409);
  if (job.narrationMode !== 'none' || job.status !== 'completed') {
    throw new VideoJobError(`ジョブ ${key.jobKey} は完了した音声なし動画ではありません（${job.narrationMode}・${job.status}）。`, 409);
  }
  return job;
}

/** この音声なし動画から作った、まだ終わっていない音声付きのジョブ（あれば二重に作らない） */
async function findActiveVoicedJob(sourceJobId: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(videoGenerationJobs)
    .where(
      and(
        eq(videoGenerationJobs.narrationMode, 'capcut'),
        inArray(videoGenerationJobs.status, ['queued', 'processing']),
        sql`${videoGenerationJobs.templateInput} -> 'audio' ->> 'sourceJobId' = ${sourceJobId}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Worker: 元のジョブを確かめ、WAV・SRT のアップロード許可を返す（完了日時は古いファイルの取り違えを防ぐため Worker が使う） */
export async function prepareCapcutAutoImport(key: CapcutAutoKey, sizes: { wavBytes: number; srtBytes: number }) {
  const job = await findCapcutAutoSource(key);
  const active = await findActiveVoicedJob(job.id);
  if (active) throw new VideoJobError(`この動画の音声付き動画はすでに作成中です（ジョブ ${active.id.slice(0, 8)}）。終わってから書き出し直してください。`, 409);
  const [wav, srt] = await Promise.all([issueCapcutUploadToken(job.id, 'wav', sizes.wavBytes), issueCapcutUploadToken(job.id, 'srt', sizes.srtBytes)]);
  return {
    sourceJobId: job.id,
    personName: job.personName,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    wav,
    srt,
  };
}

/** Worker: アップロードした WAV・SRT で音声付きの動画のジョブを作る（手動の「音声付き動画を生成」と同じ createVideoJobs） */
export async function attachCapcutAutoImport(input: { sourceJobId: string; wavUrl: string; srtUrl: string }): Promise<VideoJob> {
  const [job] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, input.sourceJobId));
  if (!job) throw new VideoJobError('元の動画のジョブが見つかりません。', 404);
  // 探したときと同じ条件を、ジョブを作る直前にもう一度確かめる
  await findCapcutAutoSource({ jobKey: job.id.slice(0, 8), personSlug: job.personSlug ?? '', templateId: job.templateId });
  const active = await findActiveVoicedJob(job.id);
  if (active) throw new VideoJobError(`この動画の音声付き動画はすでに作成中です（ジョブ ${active.id.slice(0, 8)}）。`, 409);
  const audio = { sourceJobId: job.id, wavUrl: input.wavUrl, srtUrl: input.srtUrl };
  // 登録グループ紹介: 区間・台本は元のジョブから付け直す（applyRegisteredAudioSource）
  if (isRegisteredReelId(job.templateId)) {
    const [created] = await createVideoJobs({
      personNames: [job.personName],
      templateId: job.templateId,
      narrationMode: 'capcut',
      templateInput: { version: 1, templateCategory: REGISTERED_TEMPLATE_CATEGORY, selection: { order: null, excluded: [] }, lines: [], audio },
    });
    return created;
  }
  // サイト誘導リール: 対象・区間・台本は元のジョブから付け直す（applySiteAudioSource）
  if (isSiteTemplateId(job.templateId)) {
    const [created] = await createVideoJobs({
      personNames: [job.personName],
      templateId: job.templateId,
      narrationMode: 'capcut',
      templateInput: { version: 1, templateCategory: SITE_TEMPLATE_CATEGORY, siteSelection: { kind: 'person', name: job.personName }, cta: { key: 'profile' }, lines: [], audio },
    });
    return created;
  }
  const targetType = (job.templateInput as { targetType?: unknown } | null)?.targetType === 'group' ? 'group' : 'person';
  const [created] = await createVideoJobs({
    personNames: [job.personName],
    templateId: job.templateId,
    narrationMode: 'capcut',
    templateInput: {
      version: 1,
      targetType,
      selectedWorkIds: [],
      facts: [],
      periodStart: null,
      pickWorkId: null,
      lines: null,
      audio,
    },
  });
  return created;
}
