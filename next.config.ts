import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // JPEG変換（sharp）で使用。ネイティブバイナリを含むため、webpackによるバンドル対象から
  // 外し、node_modulesからそのまま読み込ませる必要がある。
  // （以前はPlaywright/Chromium関連のパッケージもここに含めていたが、
  // /admin/instagram-post の画像生成をnext/og（Satori+Resvg）ベースに変更したことで
  // Playwright/Chromiumへの依存自体を完全に削除したため、この設定も不要になった。
  // outputFileTracingIncludes での playwright-core/browsers.json の追加読み込みも同様に不要）。
  serverExternalPackages: ['sharp'],
  // /api/admin/instagram-post/generate が next/og (Satori) 用に読み込む日本語フォント
  // （src/server/instagram-post/fonts/NotoSansCJKjp-Bold.otf、約17MB）をVercelの
  // サーバーレス関数へ確実に含めるための設定。fs.readFileSyncでの参照はファイルサイズが
  // 大きいため、確実性を優先して明示的にトレース対象へ加えている。
  outputFileTracingIncludes: {
    '/api/admin/instagram-post/generate': ['./src/server/instagram-post/fonts/NotoSansCJKjp-Bold.otf'],
  },
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
