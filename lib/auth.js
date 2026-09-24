// Single shared password, kept in the APP_PASSWORD Vercel variable.
// The cookie carries an HMAC of the password so it cannot be forged and stops
// working the moment the password is rotated.

const crypto = require('crypto');

const COOKIE_NAME = 'wcl_session';
// Inside the Zoho CRM Web Tab the app runs in an iframe on another origin, so
// its cookie is a third-party cookie: Safari drops it outright and Chrome drops
// it whenever third-party cookies are restricted. The page then logs in
// successfully and every following request comes back 401. So the same token
// may also travel in a header, which nothing partitions — the browser keeps it
// in sessionStorage and sends it explicitly.
const HEADER_NAME = 'x-wcl-session';

function secret() {
  return process.env.APP_PASSWORD || '';
}

function sessionToken() {
  return crypto.createHmac('sha256', secret()).update('won-clients-live').digest('hex');
}

function checkPassword(candidate) {
  const expected = secret();
  if (!expected) return false;
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAuthorised(request) {
  if (!secret()) return false;
  const expected = sessionToken();

  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie && cookie.value === expected) return true;

  const header = (request.headers.get(HEADER_NAME) || '').trim();
  return Boolean(header && header === expected);
}

module.exports = { COOKIE_NAME, HEADER_NAME, sessionToken, checkPassword, isAuthorised };
