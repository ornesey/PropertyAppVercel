/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: 'https://property-backend-taupe.vercel.app/:path*',
      },
    ];
  },
};

module.exports = nextConfig;