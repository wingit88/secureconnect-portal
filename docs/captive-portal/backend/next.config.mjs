/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // argon2 and node-routeros are native/Node-only modules. Keep them out
  // of the webpack bundle so Next loads them at runtime via require().
  experimental: {
    serverComponentsExternalPackages: ["argon2", "node-routeros", "source-map-support"],
  },
};
export default nextConfig;