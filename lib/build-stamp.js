// One line that says exactly which build is serving the page, so "did the
// redeploy go through?" never has to be guessed at again.

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || null;
export const COMMIT = process.env.NEXT_PUBLIC_COMMIT || null;
export const VERCEL_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV || 'local';

export function buildStamp() {
  const parts = [`v.${APP_VERSION} - Beta for testing`];

  if (BUILD_TIME) {
    const built = new Date(BUILD_TIME);
    if (!Number.isNaN(built.getTime())) {
      parts.push(
        `built ${built.toLocaleString('en-GB', {
          timeZone: 'Europe/Rome',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}`
      );
    }
  }

  if (COMMIT) parts.push(COMMIT);
  if (VERCEL_ENV && VERCEL_ENV !== 'production') parts.push(VERCEL_ENV);

  return parts.join(' · ');
}
