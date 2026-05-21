/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "better-sqlite3",
      "hersheytext",
    ],
  },
};

module.exports = nextConfig;
