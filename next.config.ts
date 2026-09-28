import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Route handlers read data/ with readdirSync; Next's file tracing does not follow directory listings.
  outputFileTracingIncludes: { '/api/**': ['./data/**', './lib/vendor/**'], '/plan/**': ['./data/**'] },
  // Stop `next dev`/`next build` from appending generated rules to AGENTS.md.
  agentRules: false,
} as NextConfig;

export default nextConfig;
