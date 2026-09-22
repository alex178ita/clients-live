import { NextResponse } from 'next/server';
import { COOKIE_MAX_AGE, COOKIE_NAME, issueToken, passwordMatches } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!passwordMatches(password)) {
    return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
  }

  const token = issueToken();
  // The token is returned in the body: the client keeps it in sessionStorage and
  // sends it back as a header, which is the only thing that survives inside the
  // Zoho CRM iframe now that third-party cookies are blocked.
  const response = NextResponse.json({ ok: true, token });

  // Cookie as a fallback for direct (non-iframe) use. "Partitioned" is what lets
  // Chrome keep it at all in an embedded context; browsers that ignore the
  // attribute simply drop the cookie and the header keeps working.
  response.headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=None; Partitioned`,
  );
  return response;
}
