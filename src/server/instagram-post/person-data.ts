import 'server-only';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { selectTopWorks, buildVodDisplayString, type SelectTopWorksOptions } from '../../../tools/canva-instagram/work-selection';

/**
 * 人物の実データ（作品・VOD・画像URL）取得。
 * tools/canva-instagram/work-selection.ts の selectTopWorks()・buildVodDisplayString()
 * をそのまま再利用する（新しい選定ロジックを重複して作らない。CLI版・Canva一括作成
 * ツールと完全に同じ選定結果になる）。読み取り専用（INSERT/UPDATE/DELETEなし）。
 */
export interface PersonWorkData {
  title: string;
  vod: string;
  imageUrl: string | null;
}

export interface PersonDataResult {
  personName: string;
  works: PersonWorkData[];
}

export class PersonNotFoundError extends Error {}

/**
 * options は selectTopWorks にそのまま渡す（省略時は従来と同じ選定結果。
 * 既存テンプレートはすべて省略して呼び出しており、search-flowのみYouTube系除外を指定する）。
 */
export async function fetchPersonWorks(personName: string, options?: SelectTopWorksOptions): Promise<PersonDataResult> {
  const person = await getPersonWithConfigMerged(personName);
  if (!person) {
    throw new PersonNotFoundError(`人物が見つかりません: ${personName}`);
  }

  const { selected } = await selectTopWorks(person.name, options);

  const works: PersonWorkData[] = selected.map(({ work, confirmedProviders }) => ({
    title: work.title,
    vod: buildVodDisplayString(confirmedProviders),
    imageUrl: getRenderableWorkImageUrl(getWorkDisplayImage(work)) ?? null,
  }));

  return { personName: person.name, works };
}
