import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4002';

const nextConfig: NextConfig = {
  // Keep a fresh clone's `git status` clean: Next 16 writes extra instruction files on first start.
  agentRules: false,
  // the floating development badge would end up in every screenshot of the running app
  devIndicators: false,
  // The shared package ships TypeScript source.
  transpilePackages: ['@atlas/shared'],
  // Headers for every page. There is no script-src here on purpose: Next writes inline scripts that a strict one
  // would need a per-request nonce for. These cover framing, sniffing, plugins, base-tag and form hijacking.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
  // The browser talks to one origin. The session cookie stays first-party, and there is no CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
