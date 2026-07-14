import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/search?'],
      },
    ],
    // 本番ドメイン固定: Preview環境のrobots.txtでも本番sitemapを参照させる
    sitemap: 'https://oshi-search.jp/sitemap.xml',
  };
}
