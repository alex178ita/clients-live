const pkg = require('./package.json');

// Baked in at build time so the header can prove which build is serving the
// page: a Vercel deployment keeps its environment variables and its code
// together, and "am I looking at the new one?" has to be answerable at a glance.
const BUILD_TIME = new Date().toISOString();
const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
    NEXT_PUBLIC_COMMIT: COMMIT,
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || 'local'
  },
  // The app is embedded as a Web Tab inside Zoho CRM.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.zoho.com https://*.zoho.eu https://*.zohocloud.ca https://*.zoho.in https://crm.zoho.com"
          }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
