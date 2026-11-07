import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { MEDIA_JOB_NAME, MEDIA_TEMPLATE_CATEGORY, isMediaGroupTemplateId, isMediaTemplateId } from '@/lib/video-media-reel';
import { parseOshiMediaInput, type OshiMediaTemplateInput } from '@/lib/video-template-input';
import { isVideoTargetName, listSonkamoGroups } from './sonkamo-target';
import { VideoJobError } from './job-store';

// 推しサーチ総合紹介動画（10種類）の対象の確認。
// 一般版: person_name は「推しサーチ」、グループ名は持たない。
// グループ版: person_name とグループ名が同じで、公開サイトのグループ一覧（推し活で損してるかも？と同じ）にあること。
// 実際の画面にグループが表示されるか（検索候補・グループページ）は、Worker が撮影のときに確かめる（見つからなければ理由つきで中止）。

/** 音声なし動画のジョブ: テンプレートと対象（グループ）を確かめる */
export async function resolveMediaJobInput(templateId: string, personName: string, input: OshiMediaTemplateInput): Promise<OshiMediaTemplateInput> {
  if (!isMediaTemplateId(templateId)) throw new VideoJobError(`推しサーチ総合紹介動画のテンプレートではありません: ${templateId}`, 400);
  const base = { version: 1 as const, templateCategory: MEDIA_TEMPLATE_CATEGORY, templateId, resolvedAt: new Date().toISOString() };
  if (!isMediaGroupTemplateId(templateId)) {
    if (input.groupName) throw new VideoJobError('このテンプレートは一般向けのため、グループ名は指定できません。', 400);
    if (personName !== MEDIA_JOB_NAME) throw new VideoJobError(`一般向けのテンプレートは「${MEDIA_JOB_NAME}」で1本作ります。`, 400);
    return { ...base, groupName: null };
  }
  const groupName = input.groupName;
  if (!groupName) throw new VideoJobError('グループ名が未設定のため生成できません。グループを選んでください。', 400);
  if (groupName !== personName) throw new VideoJobError('グループ名とジョブの対象が一致しません。管理画面を再読み込みしてください。', 400);
  if (!isVideoTargetName(groupName)) throw new VideoJobError(`動画生成で扱えないグループ名です（/ や \\ を含む名前は未対応）: ${groupName}`, 400);
  const groups = await listSonkamoGroups();
  if (!groups.some((g) => g.name === groupName)) throw new VideoJobError(`推しサーチに登録されていない（または公開中のメンバーがいない）グループです: ${groupName}`, 400);
  return { ...base, groupName };
}

/**
 * CapCut 音声付きのジョブ: 元の音声なし動画（同じテンプレート・同じ対象・完了）から、グループ名と撮影データの場所を付け直す。
 * 撮影データ（Worker の Mac 上の out/media/…）が残っていれば Worker は同じ画面で作る（無ければ撮り直す）
 */
export async function applyMediaAudioSource(templateId: string, personName: string, input: OshiMediaTemplateInput): Promise<OshiMediaTemplateInput> {
  const audio = input.audio;
  if (!audio) return input;
  if (!isMediaTemplateId(templateId)) throw new VideoJobError('CapCut 音声を付けられるのは推しサーチ総合紹介動画だけです。', 400);
  const [source] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, audio.sourceJobId));
  if (!source) throw new VideoJobError('元の動画のジョブが見つかりません。', 400);
  if (source.templateId !== templateId || source.status !== 'completed' || source.narrationMode !== 'none') {
    throw new VideoJobError('CapCut 音声は、同じテンプレートの完了した音声なし動画にだけ付けられます。', 400);
  }
  if (source.personName !== personName) throw new VideoJobError(`元の動画（${source.personName}）と違う対象の音声は付けられません。`, 400);
  let sourceInput: OshiMediaTemplateInput;
  try {
    sourceInput = parseOshiMediaInput(source.templateInput);
  } catch {
    throw new VideoJobError('元の動画のジョブの入力を読み取れません。', 400);
  }
  const result = (source.result ?? {}) as Record<string, unknown>;
  const outDir = typeof result.outDir === 'string' ? result.outDir : null;
  return {
    version: 1,
    templateCategory: MEDIA_TEMPLATE_CATEGORY,
    groupName: sourceInput.groupName,
    templateId,
    resolvedAt: new Date().toISOString(),
    audio: { sourceJobId: audio.sourceJobId, wavUrl: audio.wavUrl, srtUrl: audio.srtUrl, sourceOutDir: outDir },
  };
}
