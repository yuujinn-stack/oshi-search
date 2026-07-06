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
    ];
  },
};

export default nextConfig;
