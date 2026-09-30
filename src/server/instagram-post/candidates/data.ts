import 'server-only';
import { getPersonWithConfigMerged, getPersonsByGroupMerged } from '@/lib/persons';
import { getPublishedWorks } from '@/lib/work-store';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { filterPublicVodProviders, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { getDisplayWorkType } from '@/lib/work-display-type';
import type { VodProvider } from '@/types/vod';
import { ELIGIBLE_DISPLAY_TYPES, isUsableCanvaImageUrl } from '../../../../tools/canva-instagram/work-selection';
import { isYouTubeProvider } from '../build-post-search-flow';
import { PersonNotFoundError } from '../person-data';

/**
 * Preview専用の投稿テンプレート候補（curious-person / service-only / subscription-count /
 * oshi-status / search-pain）が使う人物データの集計。読み取り専用（INSERT/UPDATE/DELETEなし）。
 *
 * - 配信先は公開画面と同じ filterPublicVodProviders（非表示・unknown・低信頼AI・終了済みを除外＋重複除去）を通した
 *   確認済みデータのみを使い、サービス名は buildVodDisplayString と同じ表示名（getVodProviderDisplayInfo）でまとめる。
 * - YouTube系は search-flow と同じ isYouTubeProvider で除外する。
 * - 「見られる（watchable）」は見放題・無料・広告付き（flatrate / free / ads）、
 *   「サブスク（subscription）」は見放題（flatrate）のみ。レンタル・購入は数えない。
 * - 同じタイトルの作品は1件にまとめ、配信先は和集合にする。
 * 数字はすべてこの集計結果から出し、推測・補完はしない。
 */

const WATCHABLE_TYPES = new Set(['flatrate', 'free', 'ads']);
const SUBSCRIPTION_TYPES = new Set(['flatrate']);

export interface CandidateWork {
  title: string;
  releaseYear: number | null;
  /** 映画・ドラマか（selectTopWorks と同じ ELIGIBLE_DISPLAY_TYPES） */
  isMovieOrDrama: boolean;
  /** 見放題・無料・広告付きで確認できる配信サービス（表示名、YouTube系除く） */
  watchableServices: string[];
  /** 見放題で確認できる配信サービス（表示名、YouTube系除く） */
  subscriptionServices: string[];
  /** Instagram画像に使える作品画像URL（使えない場合はnull＝フォールバック表示） */
  imageUrl: string | null;
}

export interface ServiceCount {
  name: string;
  /** そのサービスで確認できる作品数（タイトル単位） */
  count: number;
}

export interface CandidatePersonData {
  personName: string;
  /** 所属グループ（未設定ならnull） */
  group: string | null;
  /** 同じグループに登録されている他の人物（最大3名、登録順） */
  groupMembers: string[];
  /** 公開中の登録作品数（タイトル単位） */
  registeredWorkCount: number;
  /** 表示順に並べた作品（映画・ドラマ優先 → 配信確認あり優先 → 新しい順） */
  works: CandidateWork[];
  /** 見放題・無料・広告付きで配信確認できる作品数 */
  watchableWorkCount: number;
  /** 見放題・無料・広告付きのサービス別作品数（多い順） */
  watchableServices: ServiceCount[];
  /** 見放題のサービス別作品数（多い順） */
  subscriptionServices: ServiceCount[];
}

function serviceNames(providers: VodProvider[], types: Set<string>): string[] {
  const names = providers
    .filter((p) => types.has(p.type) && !isYouTubeProvider(p))
    .map((p) => getVodProviderDisplayInfo(p.providerName).displayName);
  return [...new Set(names)];
}

function countServices(works: CandidateWork[], pick: (w: CandidateWork) => string[]): ServiceCount[] {
  const counts = new Map<string, number>();
  for (const w of works) for (const name of pick(w)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

export async function fetchCandidatePersonData(personName: string): Promise<CandidatePersonData> {
  const person = await getPersonWithConfigMerged(personName);
  if (!person) throw new PersonNotFoundError(`人物が見つかりません: ${personName}`);

  const [rawWorks, terminatedSlugs, groupPersons] = await Promise.all([
    getPublishedWorks(person.name),
    getInactiveProviderSlugs(),
    person.group ? getPersonsByGroupMerged(person.group) : Promise.resolve([]),
  ]);

  const byTitle = new Map<string, CandidateWork>();
  for (const work of rawWorks) {
    const key = work.title.trim();
    const providers = filterPublicVodProviders(work.vodProviders ?? [], terminatedSlugs);
    const image = getRenderableWorkImageUrl(getWorkDisplayImage(work));
    const next: CandidateWork = {
      title: key,
      releaseYear: work.releaseYear ?? null,
      isMovieOrDrama: ELIGIBLE_DISPLAY_TYPES.has(getDisplayWorkType(work)),
      watchableServices: serviceNames(providers, WATCHABLE_TYPES),
      subscriptionServices: serviceNames(providers, SUBSCRIPTION_TYPES),
      imageUrl: isUsableCanvaImageUrl(image) ? image! : null,
    };
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, next);
      continue;
    }
    existing.watchableServices = [...new Set([...existing.watchableServices, ...next.watchableServices])];
    existing.subscriptionServices = [...new Set([...existing.subscriptionServices, ...next.subscriptionServices])];
    existing.isMovieOrDrama ||= next.isMovieOrDrama;
    existing.imageUrl ??= next.imageUrl;
    if ((next.releaseYear ?? -1) > (existing.releaseYear ?? -1)) existing.releaseYear = next.releaseYear;
  }

  const works = [...byTitle.values()].sort((a, b) => {
    if (a.isMovieOrDrama !== b.isMovieOrDrama) return a.isMovieOrDrama ? -1 : 1;
    const aHas = a.watchableServices.length > 0;
    const bHas = b.watchableServices.length > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return (b.releaseYear ?? -1) - (a.releaseYear ?? -1);
  });

  return {
    personName: person.name,
    group: person.group || null,
    groupMembers: groupPersons.map((p) => p.name).filter((n) => n !== person.name).slice(0, 3),
    registeredWorkCount: works.length,
    works,
    watchableWorkCount: works.filter((w) => w.watchableServices.length > 0).length,
    watchableServices: countServices(works, (w) => w.watchableServices),
    subscriptionServices: countServices(works, (w) => w.subscriptionServices),
  };
}

/** 見放題・無料・広告付きで配信確認できる作品（表示順のまま） */
export function watchableWorks(data: CandidatePersonData): CandidateWork[] {
  return data.works.filter((w) => w.watchableServices.length > 0);
}

/** 指定サービス（見放題）で配信確認できる作品（表示順のまま） */
export function worksOnSubscription(data: CandidatePersonData, serviceName: string): CandidateWork[] {
  return data.works.filter((w) => w.subscriptionServices.includes(serviceName));
}
