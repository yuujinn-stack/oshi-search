// 推し布教カードのデータ取得（server-only）。既存の人物データ・公開作品の取得関数をそのまま使う。
import 'server-only';
import { getOshiVodKnownPersons } from '@/lib/oshi-vod/data';
import { getPublishedWorksOrThrow } from '@/lib/work-store';
import { buildOshiCardCandidates, type OshiCardWork } from './core';

export interface OshiCardPersonData {
  name: string;
  group: string;
  candidates: OshiCardWork[];
}

/**
 * 公開人物として存在すれば、その人物の作品候補を返す（存在しなければ null）。
 * 作品の取得に失敗した場合は例外（呼び出し側で「一時的に取得できません」を表示する）。
 */
export async function loadOshiCardPerson(name: string): Promise<OshiCardPersonData | null> {
  const known = await getOshiVodKnownPersons();
  const person = known.get(name);
  if (!person) return null;
  const works = await getPublishedWorksOrThrow(person.name);
  return { name: person.name, group: person.group, candidates: buildOshiCardCandidates(works) };
}
