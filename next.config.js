/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [],
  async redirects() {
    return [
      {
        source: '/',
        destination: '/login',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
