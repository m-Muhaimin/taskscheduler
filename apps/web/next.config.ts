import type { NextConfig } from "next";

/**
 * API proxy: the browser talks to the API through the web origin so the
 * auth session cookie is first-party (no CORS, no cross-site cookie rules).
 * API_BASE_URL defaults to the local Express server.
 */
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
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
