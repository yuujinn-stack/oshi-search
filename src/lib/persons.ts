import type { Person, PersonConfig, PersonWithConfig, Genre } from '@/types/person';
import personsRaw from '../../data/persons_master.json';
import personsConfigRaw from '../../data/persons_config.json';
import { getCachedPublishedPersons } from './published-persons';
import { splitGenres, sortGenreList, DEFAULT_GENRE_ORDER, type PersonCardMeta } from './genre-utils';
import { getAllPersonMetas } from './person-meta';
import { normalizeTag, getGenreAliases } from './person-display-tags';

export type PersonCardData = PersonWithConfig & PersonCardMeta;

// JSON を型付き配列に変換（fs.readFileSync を使わないのでサーバーレス環境でも安全）
const ALL_PERSONS: Person[] = (personsRaw as Array<{ name: string; group: string; genre: string }>).map(
  (p) => ({ name: p.name, group: p.group, genre: p.genre as Genre })
);

const PERSONS_CONFIG: Record<string, PersonConfig> = personsConfigRaw as Record<string, PersonConfig>;

// ── 同期関数（admin バッチ処理・既存 API から使う）──────────────────────────

export function getAllPersons(): Person[] {
  return ALL_PERSONS;
}

export function getPersonWithConfig(name: string): PersonWithConfig | undefined {
  const person = getPersonByName(name);
  if (!person) return undefined;
  return { ...person, config: PERSONS_CONFIG[name] ?? {} };
}

export function getAllPersonsWithConfig(): PersonWithConfig[] {
  return ALL_PERSONS.map((p) => ({ ...p, config: PERSONS_CONFIG[p.name] ?? {} }));
}

export function searchPersons(query: string): Person[] {
  const q = query.toLowerCase();
  return ALL_PERSONS.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.group.toLowerCase().includes(q) ||
      p.genre.toLowerCase().includes(q)
  );
}

export function getPersonByName(name: string): Person | undefined {
  return ALL_PERSONS.find((p) => p.name === name);
}

export function getPersonsByGroup(group: string): Person[] {
  return ALL_PERSONS.filter((p) => p.group === group);
}

export function getPersonsByGenre(genre: string): Person[] {
  return ALL_PERSONS.filter((p) => p.genre === genre);
}

export function getAllGroups(): string[] {
  return [...new Set(ALL_PERSONS.map((p) => p.group).filter(Boolean))];
}

export const ALL_GENRES: Genre[] = ['坂道', '芸人', 'テレビ', 'アーティスト', '俳優'];

// ── 非同期マージ関数（公開ページで使う）────────────────────────────────────
// persons_master.json の人物 ＋ Redis persons:published の公開反映済み人物を返す。
// getCachedPublishedPersons は react.cache でリクエスト内重複を防ぐ。
// cross-request キャッシュなし → 公開反映直後のリクエストから即時反映される。

async function getPublishedExtra(): Promise<PersonWithConfig[]> {
  const published = await getCachedPublishedPersons();
  const jsonNames = new Set(ALL_PERSONS.map((p) => p.name));
  const extra = published.filter((p) => !jsonNames.has(p.name));
  if (published.length > 0 || extra.length > 0) {
    console.log(`[persons] getPublishedExtra: published=${published.length}, extra (not in JSON)=${extra.length}: ${extra.map((p) => p.name).join(', ')}`);
  }
  return extra;
}

export async function getAllPersonsMerged(): Promise<PersonWithConfig[]> {
  const extra = await getPublishedExtra();
  return [
    ...ALL_PERSONS.map((p) => ({ ...p, config: PERSONS_CONFIG[p.name] ?? {} })),
    ...extra,
  ];
}

export async function getPersonWithConfigMerged(name: string): Promise<PersonWithConfig | undefined> {
  const jsonPerson = ALL_PERSONS.find((p) => p.name === name);
  if (jsonPerson) return { ...jsonPerson, config: PERSONS_CONFIG[name] ?? {} };
  const extra = await getPublishedExtra();
  return extra.find((p) => p.name === name);
}

export async function getAllGroupsMerged(): Promise<string[]> {
  const all = await getAllPersonsMerged();
  return [...new Set(all.map((p) => p.group).filter(Boolean))];
}

export async function getPersonsByGroupMerged(group: string): Promise<PersonWithConfig[]> {
  const all = await getAllPersonsMerged();
  return all.filter((p) => p.group === group);
}

export async function getPersonsByGenreMerged(genre: string): Promise<PersonWithConfig[]> {
  const all = await getAllPersonsMerged();
  return all.filter((p) => p.genre === genre);
}

// 全人物データ + メタデータからジャンル一覧を生成（DEFAULT_GENRE_ORDER 優先順）
export async function getAllGenresMerged(): Promise<string[]> {
  const [persons, metaMap] = await Promise.all([
    getAllPersonsMerged(),
    getAllPersonMetas(),
  ]);
  const genreSet = new Set<string>(DEFAULT_GENRE_ORDER);
  for (const p of persons) {
    if (p.genre) genreSet.add(normalizeTag(p.genre) ?? p.genre);
    const meta = metaMap[p.name];
    if (meta?.primaryGenre?.trim()) genreSet.add(normalizeTag(meta.primaryGenre.trim()) ?? meta.primaryGenre.trim());
    for (const g of splitGenres(meta?.genres)) genreSet.add(normalizeTag(g) ?? g);
  }
  return sortGenreList(genreSet);
}

// ジャンルで絞り込み（genre + primaryGenre + genres を検索対象）＋ alias・正規化一致も含む
export async function getPersonsByGenreExtended(genre: string): Promise<PersonCardData[]> {
  const canonical = normalizeTag(genre) ?? genre;
  // 一致対象: リクエスト値 + canonical + その alias すべて
  const allForms = new Set([genre, canonical, ...getGenreAliases(canonical)]);

  const [persons, metaMap] = await Promise.all([
    getAllPersonsMerged(),
    getAllPersonMetas(),
  ]);
  return persons
    .filter((p) => {
      if (allForms.has(p.genre) || allForms.has(normalizeTag(p.genre) ?? p.genre)) return true;
      const meta = metaMap[p.name];
      if (!meta) return false;
      if (meta.primaryGenre) {
        const pg = meta.primaryGenre.trim();
        if (allForms.has(pg) || allForms.has(normalizeTag(pg) ?? pg)) return true;
      }
      for (const g of splitGenres(meta.genres)) {
        if (allForms.has(g) || allForms.has(normalizeTag(g) ?? g)) return true;
      }
      return false;
    })
    .map((p) => {
      const meta = metaMap[p.name];
      return {
        ...p,
        primaryGenre: meta?.primaryGenre,
        genres: meta?.genres,
        activityStatus: meta?.activityStatus,
        generation: meta?.generation,
      };
    });
}

// 全人物 + メタをまとめて取得（ホームページ用: persons と genres を1回の Redis 呼び出しで返す）
export async function getAllPersonsEnrichedWithGenres(): Promise<{
  persons: PersonCardData[];
  genres: string[];
}> {
  const [allPersons, metaMap] = await Promise.all([
    getAllPersonsMerged(),
    getAllPersonMetas(),
  ]);
  const genreSet = new Set<string>(DEFAULT_GENRE_ORDER);
  const enrichedPersons: PersonCardData[] = allPersons.map((p) => {
    const meta = metaMap[p.name];
    if (p.genre) genreSet.add(normalizeTag(p.genre) ?? p.genre);
    if (meta?.primaryGenre?.trim()) genreSet.add(normalizeTag(meta.primaryGenre.trim()) ?? meta.primaryGenre.trim());
    for (const g of splitGenres(meta?.genres)) genreSet.add(normalizeTag(g) ?? g);
    return {
      ...p,
      primaryGenre: meta?.primaryGenre,
      genres: meta?.genres,
      activityStatus: meta?.activityStatus,
      generation: meta?.generation,
    };
  });
  return { persons: enrichedPersons, genres: sortGenreList(genreSet) };
}

export async function searchPersonsMerged(query: string): Promise<PersonWithConfig[]> {
  const q = query.toLowerCase();
  const all = await getAllPersonsMerged();
  return all.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.group.toLowerCase().includes(q) ||
      p.genre.toLowerCase().includes(q) ||
      (p.config.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
  );
}
