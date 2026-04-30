/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  typedRoutes: true,
  logging: {
    fetches: { fullUrl: false },
  },
};

export default config;
