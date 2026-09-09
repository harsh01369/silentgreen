import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  async rewrites() {
    // Proxy the API in development so cookies are same-origin.
    const api = process.env.NEXT_PUBLIC_API_URL;
    if (!api) return [];
    return [{ source: '/api/auth/:path*', destination: `${api}/api/auth/:path*` }];
  },
};

export default config;
