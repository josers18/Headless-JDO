/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  logging: {
    fetches: { fullUrl: false },
  },
};

export default config;
