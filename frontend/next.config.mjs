/** @type {import('next').NextConfig} */
const API_TARGET = process.env.AISINGER_API || 'http://127.0.0.1:7860';

const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_TARGET}/api/:path*` },
      { source: '/sse/:path*', destination: `${API_TARGET}/sse/:path*` },
    ];
  },
};

export default nextConfig;
