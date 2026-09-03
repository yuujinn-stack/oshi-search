import type { MetadataRoute } from 'next';

// 個別ルールを明示するUA。GPTBot・Google-Extendedは既存設定（'*'の総合ルール任せ）を
// 意図的に変更しないため、ここには追加しない。
const EXPLICIT_ALLOW_USER_AGENTS = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot'];

export default function robots(): MetadataRoute.Robots {
  const disallow = ['/admin/', '/api/', '/search?'];
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      ...EXPLICIT_ALLOW_USER_AGENTS.map((userAgent) => ({ userAgent, allow: '/', disallow })),
    ],
    // 本番ドメイン固定: Preview環境のrobots.txtでも本番sitemapを参照させる
    sitemap: 'https://oshi-search.jp/sitemap.xml',
  };
}
