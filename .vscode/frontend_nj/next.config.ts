import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: "https://property-backend-taupe.vercel.app/:path*",
      },
    ];
  },
};

export default nextConfig;