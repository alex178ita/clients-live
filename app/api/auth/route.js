import { NextResponse } from 'next/server';
import { COOKIE_NAME, sessionToken, checkPassword, isAuthorised } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  // "configured" tells the gate whether APP_PASSWORD exists on this deployment,
  // so a missing variable reads as a missing variable and not a wrong password.
  return NextResponse.json({
    authorised: isAuthorised(request),
    configured: Boolean(process.env.APP_PASSWORD)
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  if (!checkPassword(body.password)) {
    return NextResponse.json({ ok: false, error: 'Wrong password' }, { status: 401 });
  }

  // Only the embedded copy gets the token in the body. Everywhere else the
  // httpOnly cookie stays the only carrier, which is the safer default: a token
  // readable by JavaScript is worth exactly as much as the password just typed.
  const embed = body.embed === true;
  const response = NextResponse.json(embed ? { ok: true, token: sessionToken() } : { ok: true });
  response.cookies.set(COOKIE_NAME, sessionToken(), {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 12
  });
  return response;
}
