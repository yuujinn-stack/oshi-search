import type { Person, PersonConfig, PersonWithConfig, Genre } from '@/types/person';
import personsRaw from '../../data/persons_master.json';
import personsConfigRaw from '../../data/persons_config.json';
import { getCachedPublishedPersons } from './published-persons';

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
  // JSON に既にいる人物は除外（重複防止）
  return published.filter((p) => !jsonNames.has(p.name));
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
