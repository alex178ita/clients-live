/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The app is embedded as a Web Tab inside Zoho CRM: allow framing from Zoho only.
  async headers() {
    const zoho = [
      'https://crm.zoho.eu',
      'https://crm.zoho.com',
      'https://crm.zohocloud.ca',
      'https://crm.zoho.in',
      'https://one.zoho.eu',
      'https://one.zoho.com',
    ].join(' ');
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors 'self' ${zoho};`,
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // The setup page hands out a refresh token: never framed, never indexed.
        source: '/setup/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none';" },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        source: '/api/setup/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ];
  },
};

export default nextConfig;
