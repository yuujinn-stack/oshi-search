import type { MetadataRoute } from 'next';
import { getAllPersonsMerged, getAllGroupsMerged, getAllGenresMerged } from '@/lib/persons';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHrefByName } from '@/lib/group-slug';
import { getAllPublishedWorkPersonMap } from '@/lib/work-store';
import { getWorkPublicUrl } from '@/lib/work-url';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [persons, groups, genres, groupMetas, workPersonMap] = await Promise.all([
    getAllPersonsMerged(),
    getAllGroupsMerged(),
    getAllGenresMerged(),
    getAllGroupMetas(),
    getAllPublishedWorkPersonMap(),
  ]);

  return [
    {
      url: BASE_URL,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${BASE_URL}/disclaimer`,
      lastModified: new Date('2026-07-10'),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: new Date('2026-07-10'),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date('2026-07-10'),
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    },
    ...groups.map((group) => ({
      url: `${BASE_URL}${groupHrefByName(group, groupMetas)}`,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
    ...genres.map((genre) => ({
      url: `${BASE_URL}/genre/${encodeURIComponent(genre)}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...persons.map((person) => ({
      url: `${BASE_URL}/person/${encodeURIComponent(person.name)}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...[...workPersonMap.keys()].flatMap((workId) => {
      const url = getWorkPublicUrl({ workId });
      if (!url) return [];
      return [{ url: `${BASE_URL}${url}`, changeFrequency: 'weekly' as const, priority: 0.7 }];
    }),
  ];
}
