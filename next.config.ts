import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@upstash/redis', 'openai'],
};

export default nextConfig;
