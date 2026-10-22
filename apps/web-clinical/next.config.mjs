/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep review builds separate from a concurrently running development app.
  distDir: process.env['PULSE_NEXT_DIST_DIR'] ?? '.next',
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Cache-Control', value: 'private, no-store' },
    ] }];
  },
  transpilePackages: ['@pulse/ui', '@pulse/api-client'],
  webpack: (config) => {
    // @pulse/ui sources use nodenext-style `.js` specifiers pointing at .ts/.tsx
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
