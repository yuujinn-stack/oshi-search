import fs from 'fs';
import path from 'path';
import type { Person, PersonConfig, PersonWithConfig, Genre } from '@/types/person';

function parseCSV(content: string): Person[] {
  const lines = content.trim().split('\n');
  const persons: Person[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    const name = parts[0]?.trim();
    const group = parts[1]?.trim() ?? '';
    const genre = parts[2]?.trim();
    if (!name || !genre) continue;
    persons.push({ name, group, genre: genre as Genre });
  }

  return persons;
}

// --- CSVキャッシュ ---
let personCache: Person[] | null = null;

export function getAllPersons(): Person[] {
  if (personCache) return personCache;
  const csvPath = path.join(process.cwd(), 'data', 'persons_master.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  personCache = parseCSV(content);
  return personCache;
}

// --- 補助設定キャッシュ（persons_config.json）---
let configCache: Record<string, PersonConfig> | null = null;

function getPersonsConfig(): Record<string, PersonConfig> {
  if (configCache) return configCache;
  const configPath = path.join(process.cwd(), 'data', 'persons_config.json');
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    configCache = JSON.parse(content) as Record<string, PersonConfig>;
  } catch {
    configCache = {};
  }
  return configCache;
}

// --- PersonWithConfig ヘルパー ---
export function getPersonWithConfig(name: string): PersonWithConfig | undefined {
  const person = getPersonByName(name);
  if (!person) return undefined;
  const config = getPersonsConfig()[name] ?? {};
  return { ...person, config };
}

export function getAllPersonsWithConfig(): PersonWithConfig[] {
  const config = getPersonsConfig();
  return getAllPersons().map((p) => ({ ...p, config: config[p.name] ?? {} }));
}

// --- 既存の検索ユーティリティ ---
export function searchPersons(query: string): Person[] {
  const q = query.toLowerCase();
  return getAllPersons().filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.group.toLowerCase().includes(q) ||
      p.genre.toLowerCase().includes(q)
  );
}

export function getPersonByName(name: string): Person | undefined {
  return getAllPersons().find((p) => p.name === name);
}

export function getPersonsByGroup(group: string): Person[] {
  return getAllPersons().filter((p) => p.group === group);
}

export function getPersonsByGenre(genre: string): Person[] {
  return getAllPersons().filter((p) => p.genre === genre);
}

export function getAllGroups(): string[] {
  return [...new Set(getAllPersons().map((p) => p.group).filter(Boolean))];
}

export const ALL_GENRES: Genre[] = ['坂道', '芸人', 'テレビ', 'アーティスト', '俳優'];
