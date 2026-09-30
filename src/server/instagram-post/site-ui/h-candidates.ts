import 'server-only';
import { getAllPersonsMerged } from '@/lib/persons';
import { listPostedPersonsWithLastDate } from '@/lib/instagram-post-store';
import { fetchSiteUiPersonData, type SiteUiPersonData } from './data';
import { checkWatchAndBuyEligibility } from './builders';

/**
 * H「観るもの・買うもの、まとめて」で投稿する人物の候補一覧（Preview専用・読み取り専用）。
 *
 * 数字は人物ページと同じ集計（./data.ts）。生成可否は checkWatchAndBuyEligibility
 * （YouTube系だけで配信されている作品・YouTube系サービスは除外して判定）。
 *
 * H適性度（0〜100）は、DBにあるデータだけで算出する（人気度・検索需要などの推測値は使わない）:
 * - 配信中の作品数（YouTube系のみの作品を除く）… 30点。ln(1+件数)/ln(1+150)（150件以上で満点）
 * - 配信サービス数（YouTube系を除く）………………… 20点。16社以上で満点
 * - 関連商品数 ……………………………………………… 30点。ln(1+件数)/ln(1+400)（400件以上で満点）
 * 満点ラインは登録人物の上位でも差がつく値にしている（低すぎると上位が全員満点で並ぶため）。
 * - 最後のInstagram投稿からの経過日数 ……………… 20点。未投稿は満点、投稿済みは60日で満点（直近ほど低い）
 */

export interface HCandidate {
  personName: string;
  group: string | null;
  /** 人物ページと同じ「配信中」（YouTube系も含む） */
  streamingWorkCount: number;
  /** 配信中のうちYouTube系だけで配信されている作品を除いた件数 */
  streamingWorkCountExcludingYouTubeOnly: number;
  /** 人物ページと同じ「配信サービス」（YouTube系も含む） */
  serviceCount: number;
  serviceCountExcludingYouTube: number;
  productCount: number;
  /** 人物ページと同じ「出演作品」（登録作品数） */
  workCount: number;
  /** 最後にInstagramへ投稿した日時（ISO文字列）。未投稿はnull */
  lastPostedAt: string | null;
  eligible: boolean;
  ineligibleReason: string | null;
  /** H適性度（0〜100、小数1桁） */
  score: number;
  scoreBreakdown: { streaming: number; services: number; products: number; recency: number };
}

export interface HCandidateList {
  generatedAt: string;
  total: number;
  eligibleCount: number;
  candidates: HCandidate[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; value: HCandidateList } | null = null;
let inflight: Promise<HCandidateList> | null = null;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scoreCandidate(d: SiteUiPersonData, lastPostedAt: Date | null, now: Date): HCandidate['scoreBreakdown'] {
  const streaming = 30 * Math.min(1, Math.log1p(d.streamingWorkCountExcludingYouTubeOnly) / Math.log1p(150));
  const services = 20 * Math.min(1, d.serviceCountExcludingYouTube / 16);
  const products = 30 * Math.min(1, Math.log1p(d.productCount) / Math.log1p(400));
  const days = lastPostedAt ? (now.getTime() - lastPostedAt.getTime()) / 86_400_000 : null;
  const recency = days === null ? 20 : 20 * Math.min(1, Math.max(0, days) / 60);
  return { streaming: round1(streaming), services: round1(services), products: round1(products), recency: round1(recency) };
}

/** 同時に集計する人物数（DBへの負荷を抑える） */
const CONCURRENCY = 6;

async function build(): Promise<HCandidateList> {
  const [persons, posted] = await Promise.all([getAllPersonsMerged(), listPostedPersonsWithLastDate()]);
  const lastPosted = new Map(posted.map((p) => [p.personName, p.lastPublishedAt]));
  const now = new Date();
  const results: HCandidate[] = [];
  let index = 0;
  async function worker() {
    while (index < persons.length) {
      const person = persons[index++];
      const d = await fetchSiteUiPersonData(person.name);
      const eligibility = checkWatchAndBuyEligibility(d);
      const last = lastPosted.get(d.personName) ?? null;
      const breakdown = scoreCandidate(d, last, now);
      results.push({
        personName: d.personName,
        group: d.group,
        streamingWorkCount: d.streamingWorkCount,
        streamingWorkCountExcludingYouTubeOnly: d.streamingWorkCountExcludingYouTubeOnly,
        serviceCount: d.serviceCount,
        serviceCountExcludingYouTube: d.serviceCountExcludingYouTube,
        productCount: d.productCount,
        workCount: d.workCount,
        lastPostedAt: last ? last.toISOString() : null,
        eligible: eligibility.ok,
        ineligibleReason: eligibility.ok ? null : eligibility.reason,
        score: round1(breakdown.streaming + breakdown.services + breakdown.products + breakdown.recency),
        scoreBreakdown: breakdown,
      });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.personName.localeCompare(b.personName, 'ja'));
  return {
    generatedAt: now.toISOString(),
    total: results.length,
    eligibleCount: results.filter((r) => r.eligible).length,
    candidates: results,
  };
}

/** 候補一覧（全人物の集計に時間がかかるため、10分間メモリにキャッシュする。refresh=true で作り直す） */
export async function listHCandidates(refresh = false): Promise<HCandidateList> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (!inflight) {
    inflight = build()
      .then((value) => {
        cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
