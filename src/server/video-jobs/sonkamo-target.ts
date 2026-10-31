import 'server-only';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { groupMembershipRecords, listGroupNames, personsInGroup } from '@/lib/group-membership';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHrefByName } from '@/lib/group-slug';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs } from '@/db/schema';
import { parseOshiSonkamoInput, type OshiSonkamoTemplateInput } from '@/lib/video-template-input';
import { VideoJobError } from './job-store';

// 動画「推し活で損してるかも？ V1」（oshi-sonkamo-target）の対象（人物 または グループ）。
// ジョブの person_name は人物名またはグループ名。撮影するページのパスは、公開サイトと同じ関数でDBの人物・グループから作る
// （管理画面から送られた値は使わない。再生成でも作り直す）。

/** Worker が受け付ける名前（oshi-video-maker の isValidPersonName と同じ条件: 前後の空白・制御文字・/ \ なし、100文字まで） */
export function isVideoTargetName(name: string): boolean {
  return name.length > 0 && name === name.trim() && name.length <= 100 && !/[\u0000-\u001f\u007f/\\]/.test(name);
}

export interface SonkamoGroupOption {
  name: string;
  /** 公開サイトのグループページと同じ判定のメンバー（紹介するメンバーの選択肢） */
  members: string[];
}

async function loadGroups() {
  const [persons, records] = await Promise.all([getAllPersonsMerged(), getAllMembershipRecords()]);
  const byPerson = groupMembershipRecords(records);
  return { persons, byPerson, names: listGroupNames(persons, byPerson) };
}

/** 管理画面のグループの選択肢（公開サイトのグループ一覧と同じ。Worker が扱えない名前は除く） */
export async function listSonkamoGroups(): Promise<SonkamoGroupOption[]> {
  const { persons, byPerson, names } = await loadGroups();
  return names
    .filter(isVideoTargetName)
    .map((name) => ({ name, members: personsInGroup(name, persons, byPerson).map((p) => p.name) }))
    .filter((g) => g.members.length > 0);
}

/** 対象が公開中の人物・グループであることを確かめ、撮影するページのパスを付ける */
export async function resolveSonkamoTarget(name: string, input: OshiSonkamoTemplateInput): Promise<OshiSonkamoTemplateInput> {
  if (!isVideoTargetName(name)) throw new VideoJobError(`動画生成で扱えない名前です（/ や \\ を含む名前は未対応）: ${name}`, 400);
  if (input.target === 'person') {
    const persons = await getAllPersonsMerged();
    if (!persons.some((p) => p.name === name)) throw new VideoJobError(`登録されていない人物です: ${name}`, 400);
    return { ...input, memberName: null, pagePath: `/person/${encodeURIComponent(name)}` };
  }
  const { persons, byPerson, names } = await loadGroups();
  if (!names.includes(name)) throw new VideoJobError(`公開中のグループではありません: ${name}`, 400);
  const members = personsInGroup(name, persons, byPerson).map((p) => p.name);
  if (members.length === 0) throw new VideoJobError(`${name}にはメンバーが登録されていません。`, 400);
  if (input.memberName && !members.includes(input.memberName)) {
    throw new VideoJobError(`${input.memberName}は${name}のメンバーとして登録されていません。`, 400);
  }
  return { ...input, pagePath: groupHrefByName(name, await getAllGroupMetas()) };
}

export const SONKAMO_TEMPLATE_ID = 'oshi-sonkamo-v1';

/**
 * CapCut 音声付きのジョブ: 元の音声なし動画のジョブ（完了・同じテンプレート・同じ人物/グループ・音声なし）を確かめ、
 * 原稿（敬称・5文）と撮影データの場所を元のジョブから付け直す（音声は元のジョブの原稿を読み上げたもののため。画面からの値は使わない）
 */
export async function applySonkamoAudioSource(name: string, input: OshiSonkamoTemplateInput): Promise<OshiSonkamoTemplateInput> {
  const audio = input.audio;
  if (!audio) return input;
  const [source] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, audio.sourceJobId));
  if (!source) throw new VideoJobError('元の動画のジョブが見つかりません。', 400);
  if (source.templateId !== SONKAMO_TEMPLATE_ID || source.status !== 'completed' || source.narrationMode !== 'none') {
    throw new VideoJobError('CapCut 音声は「推し活で損してるかも？ V1」の完了した音声なし動画にだけ付けられます。', 400);
  }
  if (source.personName !== name) throw new VideoJobError(`元の動画（${source.personName}）と違う人物・グループの音声は付けられません。`, 400);
  let sourceInput: OshiSonkamoTemplateInput;
  try {
    sourceInput = parseOshiSonkamoInput(source.templateInput);
  } catch {
    throw new VideoJobError('元の動画のジョブの入力を読み取れません。', 400);
  }
  if (sourceInput.target !== input.target) throw new VideoJobError('元の動画と人物/グループの種類が違います。', 400);
  const result = (source.result ?? {}) as Record<string, unknown>;
  const outDir = typeof result.outDir === 'string' ? result.outDir : null;
  return {
    ...input,
    honorific: sourceInput.honorific,
    lines: sourceInput.lines,
    audio: { sourceJobId: audio.sourceJobId, wavUrl: audio.wavUrl, srtUrl: audio.srtUrl, sourceOutDir: outDir },
  };
}
