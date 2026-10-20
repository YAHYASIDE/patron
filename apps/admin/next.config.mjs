/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle so the Docker runtime image
  // ships only what it needs.
  output: 'standalone',
  // This app builds from its own directory as the Docker context; pin the
  // file-tracing root here so standalone tracing ignores the monorepo root
  // (and to silence the multi-lockfile warning during local builds).
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
