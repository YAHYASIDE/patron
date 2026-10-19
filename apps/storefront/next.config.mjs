/**
 * Headers every page carries: no framing by other sites (clickjacking), no
 * MIME sniffing, no full URLs leaked to other sites, HTTPS only. A
 * script-restricting CSP is not set here: the pages load the API and images
 * from other hosts, so a strict one needs its own careful rollout.
 */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // Emit a self-contained server bundle so the Docker runtime image
  // ships only what it needs.
  output: 'standalone',
  // This app builds from its own directory as the Docker context; pin the
  // file-tracing root here so standalone tracing ignores the monorepo root
  // (and to silence the multi-lockfile warning during local builds).
  outputFileTracingRoot: import.meta.dirname,
  images: {
    // Product/banner art is served from the API or remote CDNs; allow https hosts.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
