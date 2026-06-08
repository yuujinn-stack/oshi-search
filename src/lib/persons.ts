import type { Person, PersonConfig, PersonWithConfig, Genre } from '@/types/person';
import personsRaw from '../../data/persons_master.json';
import personsConfigRaw from '../../data/persons_config.json';

// JSON を型付き配列に変換（fs.readFileSync を使わないのでサーバーレス環境でも安全）
const ALL_PERSONS: Person[] = (personsRaw as Array<{ name: string; group: string; genre: string }>).map(
  (p) => ({ name: p.name, group: p.group, genre: p.genre as Genre })
);

const PERSONS_CONFIG: Record<string, PersonConfig> = personsConfigRaw as Record<string, PersonConfig>;

// --- 人物一覧 ---
export function getAllPersons(): Person[] {
  return ALL_PERSONS;
}

// --- PersonWithConfig ヘルパー ---
export function getPersonWithConfig(name: string): PersonWithConfig | undefined {
  const person = getPersonByName(name);
  if (!person) return undefined;
  return { ...person, config: PERSONS_CONFIG[name] ?? {} };
}

export function getAllPersonsWithConfig(): PersonWithConfig[] {
  return ALL_PERSONS.map((p) => ({ ...p, config: PERSONS_CONFIG[p.name] ?? {} }));
}

// --- 既存の検索ユーティリティ ---
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
