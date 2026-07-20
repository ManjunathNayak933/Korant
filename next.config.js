/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [],

  // TypeScript is ON again.
  //
  // It used to be disabled because @cloudflare/workers-types types
  // Response.json() as Promise<unknown>, which produced ~350 "Property 'x'
  // does not exist on type 'unknown'" errors across ~47 files. Those really
  // were false positives — but switching the compiler off to hide them also
  // hid genuine bugs in the same pile (lib/links.ts was returning an object
  // missing two required properties, which silently disabled the Shopify
  // /discount session redirect).
  //
  // types/fetch-json.d.ts restores the correct `Promise<any>` typing in one
  // line, taking the project to zero errors, so the build can fail loudly
  // again. If you hit a genuine type error, fix it rather than re-enabling
  // these flags.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    // Lint separately (`npx next lint`) — kept out of the build for speed.
    ignoreDuringBuilds: true,
  },

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
