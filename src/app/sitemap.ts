import type { MetadataRoute } from 'next';
import { getAllPersons, ALL_GENRES } from '@/lib/persons';

const BASE_URL = 'https://oshi-search.example.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const persons = getAllPersons();

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
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
