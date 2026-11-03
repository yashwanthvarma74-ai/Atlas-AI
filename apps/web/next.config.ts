import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4002';

const nextConfig: NextConfig = {
  // Keep a fresh clone's `git status` clean: Next 16 writes extra instruction files on first start.
  agentRules: false,
  // The shared package ships TypeScript source.
  transpilePackages: ['@atlas/shared'],
  // The browser talks to one origin. The session cookie stays first-party, and there is no CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
