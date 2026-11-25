/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "ffmpeg-static"],
  reactStrictMode: true,
};
export default nextConfig;
