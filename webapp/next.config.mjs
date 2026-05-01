/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ['mysql2'] }
};
export default nextConfig;
