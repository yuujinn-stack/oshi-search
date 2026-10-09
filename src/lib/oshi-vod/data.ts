// 推しに合うサブスク診断（/oshi-vod）のデータ取得（サーバー専用）。
// 計算は core.ts の純粋関数に任せ、ここでは既存の取得関数を組み合わせるだけにする。
import 'server-only';
import { unstable_cache } from 'next/cache';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetas } from '@/lib/person-meta';
import { getPublishedWorksOrThrow, selectRepresentativeWorkRecord } from '@/lib/work-store';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import type { WorkRecord } from '@/types/work';
import { VOD_PLAN_INFO } from '@/lib/vod-plan-info';
import { computeOshiVodDiagnosis } from './core';
import type { DiagnosisResult } from './types';
import { buildPickerGroups, isCurrentMemberStatus, type OshiVodPickerGroup, type OshiVodPickerPerson } from './picker';

/** 診断結果キャッシュの有効期間（秒）。共有リンクへのアクセス集中時のDB負荷対策 */
const DIAGNOSIS_CACHE_SECONDS = 300;
export const OSHI_VOD_CACHE_TAG = 'oshi-vod';

/**
 * 料金情報（vod-plan-info.ts）の指紋。診断結果のキャッシュ値には料金・プラン名が含まれるため、
 * キャッシュキーに含めて「料金表を更新したデプロイ直後に古い料金の結果が表示される」ことを防ぐ
 * （Vercel の Data Cache はデプロイをまたいで残る）。
 */
export const PLAN_INFO_FINGERPRINT = (() => {
  const src = JSON.stringify(VOD_PLAN_INFO);
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = (Math.imul(h, 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
})();

/** 公開人物（persons_master.json ＋ 公開済み persons）の名前一覧 */
export async function getOshiVodKnownPersons(): Promise<Map<string, { name: string; group: string }>> {
  const persons = await getAllPersonsMerged();
  return new Map(persons.map((p) => [p.name, { name: p.name, group: p.group }]));
}

/** 人物複数選択UI用のデータ（Header の検索候補と同じ人物データ源を使う） */
export async function getOshiVodPickerData(): Promise<{ persons: OshiVodPickerPerson[]; groups: OshiVodPickerGroup[] }> {
  const [persons, metas] = await Promise.all([
    getAllPersonsMerged(),
    getAllPersonMetas().catch(() => ({} as Awaited<ReturnType<typeof getAllPersonMetas>>)),
  ]);
  const pickerPersons: OshiVodPickerPerson[] = persons.map((p) => ({
    name: p.name,
    group: p.group,
    aliases: p.config.aliases ?? [],
    isCurrent: isCurrentMemberStatus(metas[p.name]?.activityStatus),
  }));
  return { persons: pickerPersons, groups: buildPickerGroups(pickerPersons) };
}

/**
 * 結果表示・キャッシュに不要な大きいフィールド（配信情報の生データ・AI判定詳細等）を落とした
 * 代表行。表示に使う関数（getWorkDisplayImage / getDisplayWorkType / getWorkPublicUrl）が
 * 参照するフィールドのみ残す。
 */
function slimWork(w: WorkRecord): WorkRecord {
  return {
    id: w.id,
    canonicalWorkId: w.canonicalWorkId,
    personName: w.personName,
    title: w.title,
    normalizedTitle: w.normalizedTitle,
    type: w.type,
    source: w.source,
    confidenceScore: w.confidenceScore,
    status: w.status,
    releaseYear: w.releaseYear,
    overview: w.overview,
    posterUrl: w.posterUrl,
    manualImageUrl: w.manualImageUrl,
    ogImageUrl: w.ogImageUrl,
    workDisplayType: w.workDisplayType,
    vodUpdatedAt: w.vodUpdatedAt,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

async function computeUncached(names: string[]): Promise<DiagnosisResult> {
  const known = await getOshiVodKnownPersons();
  const targets = names.map((n) => known.get(n)).filter((p): p is { name: string; group: string } => !!p);
  const [worksList, terminatedSlugs] = await Promise.all([
    Promise.all(targets.map((p) => getPublishedWorksOrThrow(p.name))),
    getInactiveProviderSlugs(),
  ]);
  return computeOshiVodDiagnosis(
    targets.map((p, i) => ({ name: p.name, group: p.group || undefined, works: worksList[i] })),
    {
      terminatedSlugs,
      pickRepresentative: (rows) => slimWork(selectRepresentativeWorkRecord(rows)),
    },
  );
}

/**
 * 診断結果を取得する（names は公開人物として検証済み・最大12人・選択順）。
 * 選択順は表示（結論文・人物タグ）に影響するため、キャッシュキーにもそのまま含める。
 */
export async function loadOshiVodDiagnosis(names: string[]): Promise<DiagnosisResult> {
  const cached = unstable_cache(
    () => computeUncached(names),
    ['oshi-vod-diagnosis', `plans:${PLAN_INFO_FINGERPRINT}`, ...names],
    { revalidate: DIAGNOSIS_CACHE_SECONDS, tags: [OSHI_VOD_CACHE_TAG] },
  );
  return cached();
}
