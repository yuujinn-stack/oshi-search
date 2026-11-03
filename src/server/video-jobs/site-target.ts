import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { videoGenerationJobs, works as worksTable } from '@/db/schema';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetas } from '@/lib/person-meta';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { buildGroupRoster, groupMembershipRecords, listGroupNames, personsInGroup } from '@/lib/group-membership';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHrefByName } from '@/lib/group-slug';
import { getPublicWorkById, getPublishedWorks } from '@/lib/work-store';
import { getWorkPublicUrl } from '@/lib/work-url';
import { getAllPhotobookItems } from '@/lib/photobook-store';
import { BUDGET_OPTIONS, USE_OPTIONS } from '@/lib/oshi-shopping/params';
import { OSHI_VOD_MAX_PERSONS } from '@/lib/oshi-vod/params';
import { VOD_PAGE_PROVIDERS, getTopPersonsForVodProvider, getVodProviderWorkCounts } from '@/lib/vod-page';
import {
  SITE_CTA_OPTIONS,
  SITE_MAX_SECONDS,
  SITE_TEMPLATE_SPECS,
  allocateSiteSlots,
  buildSitePlan,
  isSiteTemplateId,
  type SiteSelection,
  type SiteTarget,
  type SiteTemplateId,
} from '@/lib/video-site-reel';
import { parseOshiSiteInput, type OshiSiteTemplateInput } from '@/lib/video-template-input';
import { isVideoTargetName } from './sonkamo-target';
import { VideoJobError } from './job-store';

// サイト誘導リール（10種類）の対象。撮影するページのパスは公開サイトと同じ関数でDBの人物・グループ・作品・配信サービスから作る
// （管理画面から送られたパスは使わない。再生成でも作り直す）。台本の区間（見出し・手順）もここで作り直し、画面で確認した台本と合うかを確かめる。
// 実際の画面に対象が表示されるか（候補・メンバー数・出演者・診断結果など）は、Worker が撮影のときに確かめる（合わなければ理由つきで中止）。

const personPath = (name: string) => `/person/${encodeURIComponent(name)}`;

async function publicPersonNames(): Promise<Set<string>> {
  return new Set((await getAllPersonsMerged()).map((p) => p.name));
}

/** グループページのメンバー欄に表示される人数・人物（グループページと同じ判定: 卒業・脱退メンバーがいるグループは現役メンバーだけ） */
export async function loadGroupShownMembers(groupName: string): Promise<{ members: string[]; pagePath: string } | null> {
  const [persons, records, metas, personMetaMap] = await Promise.all([getAllPersonsMerged(), getAllMembershipRecords(), getAllGroupMetas(), getAllPersonMetas()]);
  const byPerson = groupMembershipRecords(records);
  if (!listGroupNames(persons, byPerson).includes(groupName)) return null;
  const members = personsInGroup(groupName, persons, byPerson);
  const roster = buildGroupRoster(groupName, members, personMetaMap, byPerson);
  const membershipByName = new Map(roster.members.map((e) => [e.person.name, e.membership]));
  const status = (name: string) => membershipByName.get(name)?.status ?? 'active';
  const active = members.filter((m) => status(m.name) === 'active' || status(m.name) === 'hiatus');
  const formerInGroup = members.filter((m) => ['graduated', 'withdrawn', 'retired'].includes(status(m.name)));
  const formerFromOther = buildGroupRoster(groupName, persons.filter((p) => !membershipByName.has(p.name)), personMetaMap, byPerson).formerFromList;
  const hasStatusData = members.some((m) => membershipByName.get(m.name)?.status);
  const shown = hasStatusData && formerInGroup.length + formerFromOther.length > 0 ? active : members;
  return { members: shown.map((m) => m.name), pagePath: groupHrefByName(groupName, metas) };
}

/** 作品から出演者を探す: 人物の公開作品のうち、推しサーチに出演者が2人以上登録された作品 */
export async function loadSiteCastWorks(personName: string): Promise<Array<{ workId: string; title: string; year: number | null; pagePath: string; cast: string[] }>> {
  const [published, names] = await Promise.all([getPublishedWorks(personName), publicPersonNames()]);
  const ids = [...new Set(published.map((w) => w.id))];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: worksTable.id, personName: worksTable.personName })
    .from(worksTable)
    .where(and(inArray(worksTable.id, ids), eq(worksTable.status, 'auto_published'), eq(worksTable.deleted, false)));
  const cast = new Map<string, Set<string>>();
  for (const r of rows) if (names.has(r.personName)) (cast.get(r.id) ?? cast.set(r.id, new Set()).get(r.id)!).add(r.personName);
  const out = [];
  const seen = new Set<string>();
  for (const w of published) {
    const c = cast.get(w.id);
    const pagePath = getWorkPublicUrl({ workId: w.id, canonicalWorkId: w.canonicalWorkId });
    if (!c || c.size < 2 || !c.has(personName) || !pagePath || seen.has(w.id)) continue;
    // 統合先の作品ページは別の作品IDの出演者を表示するため、統合されていない作品だけを使う
    if (w.canonicalWorkId && w.canonicalWorkId !== w.id) continue;
    seen.add(w.id);
    out.push({ workId: w.id, title: w.title, year: w.releaseYear ?? null, pagePath, cast: [...c] });
  }
  return out;
}

/** 写真集の一覧に掲載中の写真集がある人物（写真集の一覧の人物の絞り込みと同じ代表人物名） */
export async function loadSitePhotobookPersons(): Promise<Array<{ name: string; count: number }>> {
  // 写真集の一覧の公開分（getPublishedPhotobookItems と同じ条件。管理画面からまれに呼ぶだけのためキャッシュを通さない）
  const items = (await getAllPhotobookItems()).filter((i) => i.published);
  const count = new Map<string, number>();
  for (const it of items) count.set(it.personName, (count.get(it.personName) ?? 0) + 1);
  return [...count].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

/** 配信サービスから探す: トップページの一覧に出るサービス（作品が1件以上）と、各サービスのページの「配信作品から人物を探す」の人物 */
export async function loadSiteProviders(): Promise<Array<{ slug: string; name: string; workCount: number }>> {
  const counts = await getVodProviderWorkCounts();
  return VOD_PAGE_PROVIDERS.map((p) => ({ slug: p.urlSlug, name: p.displayName, workCount: counts.get(p.normalizedSlug) ?? 0 })).filter((p) => p.workCount > 0);
}

export async function loadSiteProviderPersons(slug: string): Promise<Array<{ name: string; workCount: number }>> {
  const p = VOD_PAGE_PROVIDERS.find((x) => x.urlSlug === slug);
  if (!p) return [];
  // サービスのページと同じ件数（12人）
  return (await getTopPersonsForVodProvider(p.normalizedSlug, 12)).map((x) => ({ name: x.name, workCount: x.workCount }));
}

export const SITE_SHOPPING_OPTIONS = { uses: USE_OPTIONS.map((u) => ({ value: u.value, label: u.label })), budgets: BUDGET_OPTIONS.map((b) => ({ value: b.value, label: b.label })) };

/** 管理画面で選んだ対象をDBで確かめ、撮影するページの正式なパスを付ける。足りない・合わないときは理由つきで拒否する */
export async function resolveSiteTarget(templateId: SiteTemplateId, sel: SiteSelection): Promise<SiteTarget> {
  const spec = SITE_TEMPLATE_SPECS[templateId];
  const name = sel.name;
  if (!name || !isVideoTargetName(name)) throw new VideoJobError(`動画生成で扱えない名前です（/ や \\ を含む名前は未対応）: ${name}`, 400);
  if (spec.target === 'person' && sel.kind !== 'person') throw new VideoJobError('このテンプレートは人物を選んでください。', 400);
  if (spec.target === 'group' && sel.kind !== 'group') throw new VideoJobError('このテンプレートはグループを選んでください。', 400);
  const names = await publicPersonNames();
  const needPerson = (n: string) => {
    if (!names.has(n)) throw new VideoJobError(`登録されていない人物です: ${n}`, 400);
    return { name: n, pagePath: personPath(n) };
  };

  if (sel.kind === 'group') {
    const g = await loadGroupShownMembers(name);
    if (!g) throw new VideoJobError(`公開中のグループではありません: ${name}`, 400);
    if (g.members.length === 0) throw new VideoJobError(`${name}にはメンバーが登録されていません。`, 400);
    // サブスク診断はグループのメンバーを全員選ぶ（サイトの上限は12人）
    if (templateId === 'site_subscription_diagnosis' && g.members.length > OSHI_VOD_MAX_PERSONS) {
      throw new VideoJobError(`${name}はメンバーが${g.members.length}人のため、サブスク診断で全員を選べません（${OSHI_VOD_MAX_PERSONS}人まで）。人物を選んでください。`, 400);
    }
    const target: SiteTarget = { kind: 'group', name, pagePath: g.pagePath };
    if (templateId === 'site_group_member_search') {
      if (!sel.member) throw new VideoJobError('紹介するメンバーを選んでください。', 400);
      if (!g.members.includes(sel.member)) throw new VideoJobError(`${sel.member}は${name}のページのメンバー欄に表示されるメンバーではありません。`, 400);
      target.member = needPerson(sel.member);
      target.memberCount = g.members.length;
    }
    return target;
  }

  const target: SiteTarget = { kind: 'person', ...needPerson(name) };
  switch (templateId) {
    case 'site_work_cast_search': {
      if (!sel.workId || !sel.toPerson) throw new VideoJobError('作品と、作品ページから開く出演者を選んでください。', 400);
      const work = (await loadSiteCastWorks(name)).find((w) => w.workId === sel.workId);
      if (!work) throw new VideoJobError(`${name}の公開作品のうち、推しサーチに出演者が2人以上登録された作品ではありません。`, 400);
      if (sel.toPerson === name || !work.cast.includes(sel.toPerson)) throw new VideoJobError(`${sel.toPerson}は「${work.title}」の出演者（当サイト登録）ではありません。`, 400);
      const publicWork = await getPublicWorkById(work.workId);
      if (!publicWork) throw new VideoJobError(`作品「${work.title}」のページが公開されていません。`, 400);
      target.work = { id: work.workId, title: work.title, pagePath: work.pagePath, from: { name, pagePath: target.pagePath }, to: needPerson(sel.toPerson) };
      break;
    }
    case 'site_three_person_search': {
      const ps = sel.persons ?? [];
      if (ps.length < 2 || ps.length > 3 || ps[0] !== name || new Set(ps).size !== ps.length) throw new VideoJobError('人物を2〜3人（重複なし）選んでください。', 400);
      target.persons = ps.map(needPerson);
      break;
    }
    case 'site_shopping_diagnosis': {
      const use = USE_OPTIONS.find((u) => u.value === sel.use);
      const budget = BUDGET_OPTIONS.find((b) => b.value === sel.budget);
      if (!use || !budget) throw new VideoJobError('お買い物診断の用途と予算を選んでください。', 400);
      target.shopping = { use: use.value, useLabel: use.label, budget: budget.value, budgetLabel: budget.label };
      break;
    }
    case 'site_photobook_search': {
      if (!(await loadSitePhotobookPersons()).some((p) => p.name === name)) throw new VideoJobError(`${name}は写真集の一覧に掲載中の写真集がありません。`, 400);
      break;
    }
    case 'site_fan_card_demo': {
      const ids = sel.workIds ?? [];
      if (ids.length < 1 || ids.length > 3) throw new VideoJobError('おすすめ作品を1〜3件選んでください。', 400);
      const { loadOshiCardPerson } = await import('@/lib/oshi-card/data');
      const { resolveOshiCardWorks } = await import('@/lib/oshi-card/core');
      const person = await loadOshiCardPerson(name);
      if (!person) throw new VideoJobError(`推し布教カードで選べない人物です: ${name}`, 400);
      const r = resolveOshiCardWorks(ids, person.candidates);
      if (r.invalidIds.length > 0 || r.works.length !== ids.length) throw new VideoJobError(`${name}の推し布教カードで選べない作品が含まれています。`, 400);
      target.card = { workIds: ids, variant: sel.variant === 'cute' ? 'cute' : 'cool' };
      break;
    }
    case 'site_vod_service_search': {
      const p = VOD_PAGE_PROVIDERS.find((x) => x.urlSlug === sel.provider);
      if (!p) throw new VideoJobError('配信サービスを選んでください。', 400);
      if (!(await loadSiteProviders()).some((x) => x.slug === p.urlSlug)) throw new VideoJobError(`${p.displayName}はトップページの配信サービスの一覧に出ていません。`, 400);
      if (!(await loadSiteProviderPersons(p.urlSlug)).some((x) => x.name === name)) throw new VideoJobError(`${name}は${p.displayName}のページの「配信作品から人物を探す」に表示されていません。`, 400);
      target.provider = { slug: p.urlSlug, name: p.displayName, pagePath: `/vod/${p.urlSlug}` };
      break;
    }
    default:
      break;
  }
  return target;
}

/** ジョブ作成: 対象をDBで確かめて区間・リンクを作り直し、画面で確認した台本が区間と合うかを確かめる */
export async function resolveSiteJobInput(templateId: string, personName: string, input: OshiSiteTemplateInput, nowMs = Date.now()): Promise<OshiSiteTemplateInput> {
  if (!isSiteTemplateId(templateId)) throw new VideoJobError(`サイト誘導リールのテンプレートではありません: ${templateId}`, 400);
  if (input.siteSelection.name !== personName) throw new VideoJobError('ジョブの名前と選んだ対象が違います（管理画面を再読み込みしてください）。', 400);
  const target = await resolveSiteTarget(templateId, input.siteSelection);
  // 区間（見出し・手順）は読みに関係なく決まる。台本（字幕・読み）は画面で確認したもの
  const plan = buildSitePlan({ templateId, target, cta: input.cta.key, readings: { fixed: {}, registered: {} } });
  if (!plan.ok) throw new VideoJobError(`生成できません: ${plan.missing.join(' / ')}`, 400);
  const lines = input.lines;
  if (lines.length !== plan.segments.length || lines.some((l, i) => l.id !== plan.segments[i].id)) {
    throw new VideoJobError('台本が区間の構成と合いません（対象を変えたあとは「台本を生成」で作り直してください）。', 400);
  }
  const cta = SITE_CTA_OPTIONS[input.cta.key];
  if (lines[lines.length - 1].text !== cta.text) throw new VideoJobError(`締めの台本は「${cta.text}」のままにしてください（締めの言葉は1つ）。`, 400);
  const slots = allocateSiteSlots(plan.segments, lines, templateId);
  const total = slots.reduce((a, b) => a + b, 0);
  if (total > SITE_MAX_SECONDS + 1e-9) throw new VideoJobError(`台本が長すぎます（見積もり ${total.toFixed(1)}秒。${SITE_MAX_SECONDS}秒までです）。文を短くしてください。`, 400);
  return {
    ...input,
    cta: { key: input.cta.key, text: cta.text },
    templateId,
    siteTarget: target,
    segments: plan.segments.map((s, i) => ({ ...s, slotSeconds: slots[i] })),
    title: plan.title,
    links: plan.links,
    resolvedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * CapCut 音声付きのジョブ: 元の音声なし動画のジョブ（完了・同じテンプレート・同じ対象・音声なし）を確かめ、対象・区間・台本を元のジョブから付け直す
 * （音声は元のジョブの台本を読み上げたもの。画面からの値は使わない）
 */
export async function applySiteAudioSource(templateId: string, personName: string, input: OshiSiteTemplateInput): Promise<OshiSiteTemplateInput> {
  const audio = input.audio;
  if (!audio) return input;
  if (!isSiteTemplateId(templateId)) throw new VideoJobError('CapCut 音声を付けられるのはサイト誘導リールだけです。', 400);
  const [source] = await db.select().from(videoGenerationJobs).where(eq(videoGenerationJobs.id, audio.sourceJobId));
  if (!source) throw new VideoJobError('元の動画のジョブが見つかりません。', 400);
  if (source.templateId !== templateId || source.status !== 'completed' || source.narrationMode !== 'none') {
    throw new VideoJobError('CapCut 音声は、同じテンプレートの完了した音声なし動画にだけ付けられます。', 400);
  }
  if (source.personName !== personName) throw new VideoJobError(`元の動画（${source.personName}）と違う対象の音声は付けられません。`, 400);
  let sourceInput: OshiSiteTemplateInput;
  try {
    sourceInput = parseOshiSiteInput(source.templateInput);
  } catch {
    throw new VideoJobError('元の動画のジョブの入力を読み取れません。', 400);
  }
  const raw = (source.templateInput ?? {}) as Partial<OshiSiteTemplateInput>;
  if (!raw.siteTarget || !Array.isArray(raw.segments) || raw.segments.length !== sourceInput.lines.length) throw new VideoJobError('元の動画のジョブに区間の情報がありません（作り直してください）。', 400);
  return {
    ...sourceInput,
    cta: raw.cta ?? sourceInput.cta,
    templateId,
    siteTarget: raw.siteTarget,
    segments: raw.segments,
    title: raw.title,
    links: raw.links,
    resolvedAt: raw.resolvedAt,
    audio: { sourceJobId: audio.sourceJobId, wavUrl: audio.wavUrl, srtUrl: audio.srtUrl, sourceOutDir: null },
  };
}
