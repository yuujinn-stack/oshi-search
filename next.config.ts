import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@upstash/redis', 'openai'],
  // data/ ディレクトリを全サーバー関数のバンドルに含める
  // fs.readFileSync で動的パスを使う場合、静的解析では検出されないため明示指定が必要
  outputFileTracingIncludes: {
    '/**': ['./data/**'],
  },
};

export default nextConfig;
