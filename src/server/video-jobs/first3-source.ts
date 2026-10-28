import 'server-only';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { workAliases, works as worksTable } from '@/db/schema';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { getPublishedWorksOrThrow, getPublicWorkById } from '@/lib/work-store';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { deduplicateProviders, isConfirmedVodAvailability, normalizeProviderName, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { filterAndSortWorks, DEFAULT_WORK_FILTER } from '@/lib/work-filter';
import { getDisplayWorkType, DISPLAY_WORK_TYPE_LABEL } from '@/lib/work-display-type';
import { getWorkPublicUrl } from '@/lib/work-url';
import { first3CandidateExclusion } from '@/lib/video-first3-script';
import { VOD_TYPE_CONFIG, VOD_TYPE_ORDER } from '@/lib/vod-cta';
import type { WorkRecord } from '@/types/work';

// 「まず見る3作 ショートV1」の作品選定の入力データ（oshi-video-makerのWorker向け）。
// これまでWorkerが推しサーチの公開ページ（人物ページの「出演作品」カード・作品ページの「配信情報」）から
// 読み取っていた値を、同じページを描画しているサーバー側の処理（同じ関数・同じ並び・同じ絞り込み）から作る。
// 選定ルールそのもの（候補の条件・並び・3作品の選び方）はoshi-video-maker側にだけあり、ここでは選ばない。

/** 人物ページの「出演作品」の作品カード1枚分（WorkCardの表示と同じ値） */
export interface First3SourceCard {
  /** 作品ページへのリンク（/work/{id}） */
  href: string;
  /** カードの種別表示（DISPLAY_WORK_TYPE_LABEL） */
  kind: string;
  /** カードに「配信中」が表示されるか */
  streaming: boolean;
  title: string;
  year: number | null;
  /** 「役: ○○」の○○（表示されない場合はnull） */
  role: string | null;
  /** 人物ページでの掲載順（既定の並べ替え「配信あり優先」） */
  order: number;
  /**
   * この作品の出演が登録されている人物の数（works の行数。グループ全体の番組ほど多い）。
   * 「まず見る3作」の追加の候補で、本人に近い作品を先に使うための目安（Worker 側の順位付けだけに使う）
   */
  personCount?: number | null;
}

/** 作品ページの表示と同じ値（h1の作品名・種別・年・配信情報） */
export interface First3SourceWork {
  id: string;
  url: string;
  title: string;
  kind: string | null;
  year: number | null;
  /** 「確認: ○○」の日付（作品ページと同じ書式） */
  checkedAt: string | null;
  /** 配信情報の各行（サービスの表示名と「見放題」等の表示ラベル。作品ページの並び） */
  vod: Array<{ service: string; type: string }>;
}

const SITE_ORIGIN = 'https://oshi-search.jp';

/** 人物ページの「出演作品」と同じ作品カード（人物が存在しなければnull） */
export async function getFirst3SourceCards(personName: string): Promise<{ personName: string; pageUrl: string; cards: First3SourceCard[] } | null> {
  const r = await loadPersonWorkCards(personName);
  if (!r) return null;
  const counts = await countRegisteredPersons(r.items.map((i) => i.work.id));
  return {
    personName: r.personName,
    pageUrl: r.pageUrl,
    cards: r.items.map((i) => ({ ...i.card, personCount: counts.get(i.work.id) ?? null })),
  };
}

/** 作品ごとの出演登録人数（読み取りのみ。works は 人物×作品 で1行） */
async function countRegisteredPersons(workIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(workIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: worksTable.id, n: sql<number>`count(*)::int` })
    .from(worksTable)
    .where(inArray(worksTable.id, ids))
    .groupBy(worksTable.id);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/** 動画メーカーの「1作品だけ変更 → 候補から手動選択」に表示する作品（人物ページの「出演作品」のうちドラマ・映画） */
export interface First3ManualCandidate {
  id: string;
  title: string;
  kind: string;
  year: number | null;
  role: string | null;
  /** 見放題の配信先（表示名）。空なら動画に使えない（「どのサブスクで見られる」の場面を作れない） */
  flatServices: string[];
  /** 無料・広告付き無料の配信先（表示名）。番組・ライブ等は見放題が無くても無料で見られれば使える */
  freeServices: string[];
  /** まず見る3作の候補にならない理由（本人出演・配信中でない等）。null なら選べる */
  excludedReason: string | null;
}

/**
 * 手動選択の候補一覧（読み取りのみ）。並びは人物ページと同じ。
 * 選べるかどうかの最終判定（ドラマ・映画・見放題・他の2作品と同じ作品でない）は Worker が作品ページと同じ値で行う。
 */
export async function getFirst3ManualCandidates(personName: string): Promise<{ personName: string; candidates: First3ManualCandidate[] } | null> {
  const r = await loadPersonWorkCards(personName);
  if (!r) return null;
  const candidates = r.items
    // ドラマ・映画と、追加の候補の種別（番組・ライブ等）。それ以外（舞台・アニメ等）は一覧に出さない
    .filter(({ card }) => card.kind === 'ドラマ' || card.kind === '映画' || first3CandidateExclusion({ ...card, streaming: true, role: null }) === null)
    .map(({ work, card }) => {
      const providers = deduplicateProviders((work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p)));
      const names = (types: string[]) => [...new Set(providers.filter((p) => types.includes(p.type)).map((p) => getVodProviderDisplayInfo(p.providerName).displayName))];
      return {
      id: decodeURIComponent(card.href.replace(/^\/work\//, '')),
      title: card.title,
      kind: card.kind,
      year: card.year,
      role: card.role,
      excludedReason: first3CandidateExclusion(card),
      flatServices: names(['flatrate']),
      freeServices: names(['free', 'ads']),
    };
    });
  return { personName: r.personName, candidates };
}

async function loadPersonWorkCards(personName: string): Promise<{ personName: string; pageUrl: string; items: Array<{ work: WorkRecord; card: First3SourceCard }> } | null> {
  const person = await getPersonWithConfigMerged(personName);
  if (!person) return null;
  const [publishedWorks, inactiveSlugs] = await Promise.all([getPublishedWorksOrThrow(person.name), getInactiveProviderSlugs()]);
  // 人物ページと同じ: WorksSectionへ渡す前に終了済みサービスを除去 → 既定の絞り込み・並べ替え
  const forClient: WorkRecord[] = inactiveSlugs.size > 0
    ? publishedWorks.map((w) => ({
        ...w,
        vodProviders: (w.vodProviders ?? []).filter((p) => !inactiveSlugs.has(normalizeProviderName(p.providerName ?? ''))),
      }))
    : publishedWorks;
  const sorted = filterAndSortWorks(forClient, DEFAULT_WORK_FILTER);
  const items: Array<{ work: WorkRecord; card: First3SourceCard }> = [];
  sorted.forEach((work, order) => {
    // WorkCardと同じリンク先。/work/ 以外（公開URLが無い作品）は作品ページが無いため含めない
    const href = getWorkPublicUrl({ workId: work.id, canonicalWorkId: work.canonicalWorkId });
    if (!href || !href.startsWith('/work/')) return;
    // WorkCardと同じ「配信中」判定（確認済み・重複除去後に見放題/無料/広告付きがある）
    const streaming = deduplicateProviders((work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p)))
      .some((p) => ['flatrate', 'free', 'ads'].includes(p.type));
    items.push({ work, card: {
      href,
      kind: DISPLAY_WORK_TYPE_LABEL[getDisplayWorkType(work)],
      streaming,
      title: work.title,
      year: work.releaseYear ?? null,
      role: work.roleName ? work.roleName : null,
      order,
    } });
  });
  return { personName: person.name, pageUrl: `${SITE_ORIGIN}/person/${encodeURIComponent(person.name)}`, items };
}

function formatCheckedAt(ts: number | undefined): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });
}

/** 作品ページと同じ表示値（別名の作品IDは作品ページと同じく正規の作品へ読み替える。無ければ含めない） */
export async function getFirst3SourceWorks(workIds: string[]): Promise<Record<string, First3SourceWork>> {
  const ids = [...new Set(workIds)];
  const aliasRows = ids.length > 0
    ? await db.select({ aliasWorkId: workAliases.aliasWorkId, canonicalWorkId: workAliases.canonicalWorkId }).from(workAliases).where(inArray(workAliases.aliasWorkId, ids))
    : [];
  const alias = new Map(aliasRows.map((r) => [r.aliasWorkId, r.canonicalWorkId]));
  const terminatedSlugs = await getInactiveProviderSlugs();
  const result: Record<string, First3SourceWork> = {};
  for (const requested of ids) {
    const workId = alias.get(requested) ?? requested;
    const work = await getPublicWorkById(workId);
    if (!work) continue;
    const providers = deduplicateProviders((work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)))
      .slice()
      .sort((a, b) => (VOD_TYPE_ORDER[a.type] ?? 9) - (VOD_TYPE_ORDER[b.type] ?? 9));
    result[requested] = {
      id: workId,
      url: `${SITE_ORIGIN}/work/${encodeURIComponent(workId)}`,
      title: work.title,
      kind: DISPLAY_WORK_TYPE_LABEL[getDisplayWorkType(work)] ?? null,
      year: work.releaseYear ?? null,
      checkedAt: formatCheckedAt(work.vodUpdatedAt),
      vod: providers.map((p) => ({
        service: getVodProviderDisplayInfo(p.providerName).displayName,
        type: (VOD_TYPE_CONFIG[p.type] ?? VOD_TYPE_CONFIG.unknown).label,
      })),
    };
  }
  return result;
}

