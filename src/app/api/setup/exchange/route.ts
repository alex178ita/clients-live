import { NextResponse } from 'next/server';
import { setupEnabled, setupKeyValid } from '@/lib/setupAuth';
import { ZohoError, exchangeAuthCode } from '@/lib/zoho';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!setupEnabled()) {
    return NextResponse.json({ error: 'Setup is disabled on this deployment.' }, { status: 404 });
  }
  if (!setupKeyValid(body?.k)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json({ error: 'Paste the grant code from the Zoho self client.' }, { status: 400 });
  }

  try {
    const result = await exchangeAuthCode(code);
    // Deliberately not logged anywhere.
    return NextResponse.json({
      ok: true,
      refreshToken: result.refreshToken,
      apiDomain: result.apiDomain,
    });
  } catch (error) {
    const message = error instanceof ZohoError ? error.message : String(error);
    const hint =
      /invalid_code|invalid code/i.test(message)
        ? 'The code is wrong, already used, or expired — a self client code lasts only a few minutes and works once. Generate a new one.'
        : /invalid_client/i.test(message)
          ? 'The code was generated for a different Zoho client than the ZOHO_CLIENT_ID on this deployment.'
          : '';
    return NextResponse.json({ error: message, hint }, { status: 400 });
  }
}
