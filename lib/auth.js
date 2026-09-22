// Single shared password, kept in the APP_PASSWORD Vercel variable.
// The cookie carries an HMAC of the password so it cannot be forged and stops
// working the moment the password is rotated.

const crypto = require('crypto');

const COOKIE_NAME = 'wcl_session';

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
  const cookie = request.cookies.get(COOKIE_NAME);
  return Boolean(cookie && cookie.value === sessionToken());
}

module.exports = { COOKIE_NAME, sessionToken, checkPassword, isAuthorised };
