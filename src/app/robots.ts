import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: '/search',
      },
    ],
    sitemap: 'https://oshi-search.example.com/sitemap.xml',
  };
}
