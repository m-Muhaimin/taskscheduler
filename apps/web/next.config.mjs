/** @type {import('next').NextConfig} */
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_BASE_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
