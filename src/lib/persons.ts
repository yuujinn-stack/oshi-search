import fs from 'fs';
import path from 'path';
import { Person, Genre } from '@/types/person';

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

let cache: Person[] | null = null;

export function getAllPersons(): Person[] {
  if (cache) return cache;
  const csvPath = path.join(process.cwd(), 'data', 'persons_master.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  cache = parseCSV(content);
  return cache;
}

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
