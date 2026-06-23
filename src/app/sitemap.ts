import type { MetadataRoute } from 'next';
import { getAllPersonsMerged, getAllGroupsMerged, ALL_GENRES } from '@/lib/persons';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.vercel.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [persons, groups] = await Promise.all([getAllPersonsMerged(), getAllGroupsMerged()]);

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...groups.map((group) => ({
      url: `${BASE_URL}/group/${encodeURIComponent(group)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
    ...ALL_GENRES.map((genre) => ({
      url: `${BASE_URL}/genre/${encodeURIComponent(genre)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...persons.map((person) => ({
      url: `${BASE_URL}/person/${encodeURIComponent(person.name)}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
