import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { getAllGroupsMerged, getAllPersonsMerged } from '@/lib/persons';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHrefByName } from '@/lib/group-slug';
import {
  REGISTERED_JOB_NAME,
  REGISTERED_TEMPLATE_SPECS,
  allocateRegisteredSlots,
  buildRegisteredPlan,
  isRegisteredTemplateId,
  registeredCategoryOf,
  registeredReelMaxSeconds,
  registeredStoryLinkUrl,
  type RegisteredGroup,
} from '@/lib/video-registered-groups';
import { parseOshiRegisteredInput, type OshiRegisteredTemplateInput } from '@/lib/video-template-input';
import { VideoJobError } from './job-store';

// 登録グループ紹介（リール5種類・ストーリーズ5種類）の対象データ。
// ・グループの一覧はトップページ「グループで探す」・サイトマップと同じ getAllGroupsMerged（公開中の人物の所属グループ・所属履歴のグループ。
//   同じ名前は1件。表示名は公開画面と同じ文字列）。人物数はトップページの「登録タレント」と同じ公開人物（getAllPersonsMerged）。
// ・ジャンルはトップページの明示的な分類だけ（src/lib/home-group-category.ts）。一覧に無いグループは「分類なし」。
// ・ジョブ作成時に、画面で選んだ除外・並べ替えから区間をここで作り直す（画面から送られた区間・件数は使わない）。

export interface RegisteredTargetData {
  groups: RegisteredGroup[];
  personCount: number;
}

export async function loadRegisteredTarget(): Promise<RegisteredTargetData> {
  const [names, persons, metas] = await Promise.all([getAllGroupsMerged(), getAllPersonsMerged(), getAllGroupMetas()]);
  const seen = new Set<string>();
  const groups: RegisteredGroup[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    groups.push({ name, category: registeredCategoryOf(name), href: groupHrefByName(name, metas) });
  }
  return { groups, personCount: persons.length };
}

/** ジョブ作成: 現在の登録グループで区間を作り直し、画面で確認した台本が区間と合うかを確かめる */
export async function resolveRegisteredJobInput(templateId: string, personName: string, input: OshiRegisteredTemplateInput, nowMs = Date.now()): Promise<OshiRegisteredTemplateInput> {
  if (!isRegisteredTemplateId(templateId)) throw new VideoJobError(`登録グループ紹介のテンプレートではありません: ${templateId}`, 400);
  if (personName !== REGISTERED_JOB_NAME) throw new VideoJobError(`登録グループ紹介は「${REGISTERED_JOB_NAME}」として1本ずつ作ります。`, 400);
  const spec = REGISTERED_TEMPLATE_SPECS[templateId];
  const target = await loadRegisteredTarget();
  const plan = buildRegisteredPlan({ templateId, groups: target.groups, personCount: target.personCount, selection: input.selection });
  if (!plan.ok) throw new VideoJobError(`生成できません: ${plan.missing.join(' / ')}`, 400);
  let lines = input.lines;
  if (spec.kind === 'reel') {
    if (lines.length !== plan.segments.length || lines.some((l, i) => l.id !== plan.segments[i].id)) {
      throw new VideoJobError('台本が区間の構成と合いません（グループの選択を変えたあとは「台本を生成」で作り直してください）。', 400);
    }
  } else {
    // ストーリーズは音声なし（台本は使わない）
    lines = [];
  }
  const slots = allocateRegisteredSlots(spec.kind, plan.segments, lines);
  const total = slots.reduce((a, b) => a + b, 0);
  const maxSeconds = registeredReelMaxSeconds(plan.segments);
  if (spec.kind === 'reel' && total > maxSeconds + 1e-9) {
    throw new VideoJobError(`台本が長すぎます（見積もり ${total.toFixed(1)}秒。このリールは${maxSeconds}秒までです）。文を短くしてください。`, 400);
  }
  return {
    ...input,
    lines,
    segments: plan.segments.map((s, i) => ({ ...s, slotSeconds: slots[i] })),
    title: plan.title,
    counts: plan.counts,
    shownGroups: plan.shownGroups,
    storyLinkUrl: registeredStoryLinkUrl(templateId),
    resolvedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * CapCut 音声付きのジョブ: 元の音声なし動画のジョブ（完了・同じテンプレート・音声なし）を確かめ、区間と台本を元のジョブから付け直す
 * （音声は元のジョブの台本を読み上げたもの。グループの一覧・件数も元の動画と同じにする。画面からの値は使わない）
 */
export async function applyRegisteredAudioSource(templateId: string, personName: string, input: OshiRegisteredTemplateInput): Promise<OshiRegisteredTemplateInput> {
  const audio = input.audio;
  if (!audio) return input;
  if (!isRegisteredTemplateId(templateId) || REGISTERED_TEMPLATE_SPECS[templateId].kind !== 'reel') {
    throw new VideoJobError('CapCut 音声を付けられるのは登録グループ紹介のリールだけです。', 400);
  }
  const [source] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, audio.sourceJobId));
  if (!source) throw new VideoJobError('元の動画のジョブが見つかりません。', 400);
  if (source.templateId !== templateId || source.status !== 'completed' || source.narrationMode !== 'none') {
    throw new VideoJobError('CapCut 音声は、同じテンプレートの完了した音声なし動画にだけ付けられます。', 400);
  }
  if (source.personName !== personName) throw new VideoJobError(`元の動画（${source.personName}）と違う動画の音声は付けられません。`, 400);
  let sourceInput: OshiRegisteredTemplateInput;
  try {
    sourceInput = parseOshiRegisteredInput(source.templateInput);
  } catch {
    throw new VideoJobError('元の動画のジョブの入力を読み取れません。', 400);
  }
  const raw = (source.templateInput ?? {}) as Partial<OshiRegisteredTemplateInput>;
  if (!Array.isArray(raw.segments) || raw.segments.length !== sourceInput.lines.length) throw new VideoJobError('元の動画のジョブに区間の情報がありません（作り直してください）。', 400);
  return {
    ...sourceInput,
    segments: raw.segments,
    title: raw.title,
    counts: raw.counts,
    shownGroups: raw.shownGroups ?? [],
    storyLinkUrl: null,
    resolvedAt: raw.resolvedAt,
    audio: { sourceJobId: audio.sourceJobId, wavUrl: audio.wavUrl, srtUrl: audio.srtUrl, sourceOutDir: null },
  };
}
