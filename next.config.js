/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
