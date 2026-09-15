import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'oshi-search-tjju.vercel.app' }],
        destination: 'https://oshi-search.jp/:path*',
        permanent: true,
      },
      // SNSプロフィール用の短縮URL（Instagram/Threads/TikTok）。
      // 見た目を短くしつつ、アクセス時にUTM付きURLへ一時リダイレクトする。
      {
        source: '/ig',
        destination: '/?utm_source=instagram&utm_medium=social&utm_campaign=profile',
        permanent: false,
      },
      {
        source: '/threads',
        destination: '/?utm_source=threads&utm_medium=social&utm_campaign=profile',
        permanent: false,
      },
      {
        source: '/tiktok',
        destination: '/?utm_source=tiktok&utm_medium=social&utm_campaign=profile',
        permanent: false,
      },
    ];
  },
  // Preview デプロイが本番インデックスに混入しないよう全ルートにnoindexを付ける。
  // VERCEL_ENV はビルド時に Vercel が設定するため、環境変数の実行時評価は不要。
  async headers() {
    if (process.env.VERCEL_ENV !== 'preview') return [];
    return [
      {
        source: '/(.*)',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ];
  },
};

export default nextConfig;
