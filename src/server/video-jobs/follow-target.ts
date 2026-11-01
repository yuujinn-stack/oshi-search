import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { groupMembershipRecords, listGroupNames, personsInGroup } from '@/lib/group-membership';
import { getPublishedWorksOrThrow } from '@/lib/work-store';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { getStreamingProviders } from '@/lib/vod-availability';
import { getDisplayWorkType, DISPLAY_WORK_TYPE_LABEL } from '@/lib/work-display-type';
import { VOD_TYPE_LABEL } from '@/types/vod';
import type { WorkRecord } from '@/types/work';
import {
  FOLLOW_MAX_SECONDS,
  allocateFollowSlots,
  buildFollowPlan,
  isActingRoleName,
  isFollowTemplateId,
  validateFollowFacts,
  type FollowTargetType,
  type FollowWork,
} from '@/lib/video-follow-reel';
import { parseOshiFollowInput, type OshiFollowTemplateInput } from '@/lib/video-template-input';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHrefByName } from '@/lib/group-slug';
import { VideoJobError } from './job-store';
import { isVideoTargetName } from './sonkamo-target';

// フォロー獲得リール（10種類）の対象と、動画に出す事実。
// ・作品・出演年・種類・役名・配信は推しサーチDBの公開作品だけ（人物ページ・グループページと同じ取得関数・同じ配信判定）。
// ・グループのときはメンバー全員の公開作品を、同じ作品ごとに1件へまとめる（集計で重複して数えない）。
// ・ジョブ作成時に、画面で選んだ作品IDと入力した事実からシーンをここで作り直す（画面から送られたシーンは使わない）。

export interface FollowTargetData {
  name: string;
  targetType: FollowTargetType;
  /** 人物のときは本人、グループのときはメンバー（公開サイトのグループページと同じ判定） */
  personNames: string[];
  works: FollowWork[];
}

/** 同じ作品の判定（作品の統合先 → TMDb の作品ID → 正規化した作品名と年） */
function workKey(w: WorkRecord): string {
  if (w.canonicalWorkId) return `c:${w.canonicalWorkId}`;
  if (w.tmdbId) return `t:${w.type}:${w.tmdbId}`;
  return `n:${w.normalizedTitle}|${w.releaseYear ?? ''}`;
}

function toFollowWork(w: WorkRecord, inactive: Set<string>): FollowWork {
  const genre = getDisplayWorkType(w);
  return {
    id: w.id,
    title: w.title,
    year: w.releaseYear ?? null,
    genre,
    genreLabel: DISPLAY_WORK_TYPE_LABEL[genre],
    // 「出演」「〇〇メンバー」など役名ではない登録値は使わない（役名として画面・台本に出さない）
    roleName: isActingRoleName(w.roleName, w.personName) ? w.roleName!.trim() : null,
    persons: [w.personName],
    streaming: getStreamingProviders(w, inactive).map((p) => ({ provider: p.providerName, typeLabel: VOD_TYPE_LABEL[p.type], checkedDate: p.checkedDate ?? null })),
  };
}

/** 人物・グループが公開中かを確かめ、その公開作品を返す（無ければ VideoJobError） */
export async function loadFollowTarget(targetType: FollowTargetType, name: string): Promise<FollowTargetData> {
  if (!isVideoTargetName(name)) throw new VideoJobError(`動画生成で扱えない名前です（/ や \\ を含む名前は未対応）: ${name}`, 400);
  const [persons, inactive] = await Promise.all([getAllPersonsMerged(), getInactiveProviderSlugs()]);
  let personNames: string[];
  if (targetType === 'person') {
    if (!persons.some((p) => p.name === name)) throw new VideoJobError(`登録されていない人物です: ${name}`, 400);
    personNames = [name];
  } else {
    const byPerson = groupMembershipRecords(await getAllMembershipRecords());
    if (!listGroupNames(persons, byPerson).includes(name)) throw new VideoJobError(`公開中のグループではありません: ${name}`, 400);
    personNames = personsInGroup(name, persons, byPerson).map((p) => p.name);
    if (personNames.length === 0) throw new VideoJobError(`${name}にはメンバーが登録されていません。`, 400);
  }
  const lists = await Promise.all(personNames.map((n) => getPublishedWorksOrThrow(n)));
  const byKey = new Map<string, FollowWork>();
  const order: string[] = [];
  for (const records of lists) {
    for (const r of records) {
      const key = workKey(r);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, toFollowWork(r, inactive));
        order.push(key);
        continue;
      }
      // 同じ作品に出演しているメンバーを足す。役名・出演年・配信は最初の登録を使い、無い項目だけ補う
      if (!existing.persons.includes(r.personName)) existing.persons.push(r.personName);
      if (existing.year === null && r.releaseYear) existing.year = r.releaseYear;
      if (existing.streaming.length === 0) existing.streaming = toFollowWork(r, inactive).streaming;
    }
  }
  // グループのとき、役名はメンバーごとに違うため使わない（1人の役柄だけを比べるテンプレートは人物のみ）
  const works = order.map((k) => byKey.get(k)!).map((w) => (targetType === 'group' ? { ...w, roleName: null } : w));
  works.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return { name, targetType, personNames, works };
}

/**
 * 通常のジョブ（音声なし）: 画面で選んだ作品・事実をDBの公開作品で確かめ、シーンを作り直して保存する内容を返す。
 * 台本（字幕・読み）は画面で確認・編集したものを使う（シーンと同じ数・同じ順でなければ受け付けない）
 */
export async function resolveFollowJobInput(templateId: string, name: string, input: OshiFollowTemplateInput, nowMs = Date.now()): Promise<OshiFollowTemplateInput> {
  if (!isFollowTemplateId(templateId)) throw new VideoJobError(`フォロー獲得リールのテンプレートではありません: ${templateId}`, 400);
  const target = await loadFollowTarget(input.targetType, name);
  const plan = buildFollowPlan({
    templateId,
    targetType: input.targetType,
    name,
    works: target.works,
    selection: { selectedWorkIds: input.selectedWorkIds, facts: input.facts, periodStart: input.periodStart, pickWorkId: input.pickWorkId },
    readings: { fixed: {}, registered: {} },
    nowMs,
  });
  if (!plan.ok) throw new VideoJobError(`必要な情報が足りないため生成できません: ${plan.missing.join(' / ')}`, 400);
  if (input.lines.length !== plan.scenes.length || input.lines.some((l, i) => l.id !== plan.scenes[i].id)) {
    throw new VideoJobError('台本がシーンの構成と合いません（作品・情報を変えたあとは「台本を生成」で作り直してください）。', 400);
  }
  // シーンの長さは、画面で確認した読みの長さで決める（音声なし動画の目安）
  const slots = allocateFollowSlots(input.lines, plan.scenes.map((s) => s.kind));
  const total = slots.reduce((a, b) => a + b, 0);
  if (total > FOLLOW_MAX_SECONDS + 1e-9) {
    throw new VideoJobError(`台本が長すぎます（見積もり ${total.toFixed(1)}秒。動画は${FOLLOW_MAX_SECONDS}秒までです）。文を短くしてください。`, 400);
  }
  return {
    ...input,
    personNames: target.personNames,
    scenes: plan.scenes.map((s, i) => ({ ...s, slotSeconds: slots[i] })),
    title: plan.title,
    pagePath: input.targetType === 'person' ? `/person/${encodeURIComponent(name)}` : groupHrefByName(name, await getAllGroupMetas()),
    sourceUrls: plan.sourceUrls,
    sourceCheckedAt: plan.sourceCheckedAt,
    resolvedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * CapCut 音声付きのジョブ: 元の音声なし動画のジョブ（完了・同じテンプレート・同じ人物/グループ・音声なし）を確かめ、
 * シーンと台本を元のジョブから付け直す（音声は元のジョブの台本を読み上げたもののため。画面からの値は使わない）。
 * 入力した事実（配信終了予定日・確認日時など）が今も有効かは、ここでも確かめる
 */
export async function applyFollowAudioSource(templateId: string, name: string, input: OshiFollowTemplateInput, nowMs = Date.now()): Promise<OshiFollowTemplateInput> {
  const audio = input.audio;
  if (!audio) return input;
  const [source] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, audio.sourceJobId));
  if (!source) throw new VideoJobError('元の動画のジョブが見つかりません。', 400);
  if (source.templateId !== templateId || source.status !== 'completed' || source.narrationMode !== 'none') {
    throw new VideoJobError('CapCut 音声は、同じテンプレートの完了した音声なし動画にだけ付けられます。', 400);
  }
  if (source.personName !== name) throw new VideoJobError(`元の動画（${source.personName}）と違う人物・グループの音声は付けられません。`, 400);
  let sourceInput: OshiFollowTemplateInput;
  try {
    sourceInput = parseOshiFollowInput(source.templateInput);
  } catch {
    throw new VideoJobError('元の動画のジョブの入力を読み取れません。', 400);
  }
  const raw = (source.templateInput ?? {}) as Partial<OshiFollowTemplateInput>;
  if (!Array.isArray(raw.scenes) || raw.scenes.length !== sourceInput.lines.length) throw new VideoJobError('元の動画のジョブにシーンの情報がありません（作り直してください）。', 400);
  if (isFollowTemplateId(templateId)) {
    const target = await loadFollowTarget(sourceInput.targetType, name);
    const stale = validateFollowFacts(templateId, sourceInput, target.works, nowMs);
    if (stale.length > 0) throw new VideoJobError(`元の動画の確認済み情報が今は使えません: ${stale.join(' / ')}（情報を確認し直して、音声なし動画から作り直してください）`, 400);
  }
  return {
    ...sourceInput,
    personNames: raw.personNames ?? [],
    scenes: raw.scenes,
    title: raw.title,
    pagePath: raw.pagePath,
    sourceUrls: raw.sourceUrls ?? [],
    sourceCheckedAt: raw.sourceCheckedAt ?? null,
    resolvedAt: raw.resolvedAt,
    audio: { sourceJobId: audio.sourceJobId, wavUrl: audio.wavUrl, srtUrl: audio.srtUrl, sourceOutDir: null },
  };
}
