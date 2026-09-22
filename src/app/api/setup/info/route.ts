import { NextResponse } from 'next/server';
import { SCOPE_GROUPS, SCOPE_STRING } from '@/lib/scopes';
import { setupEnabled, setupKeyValid } from '@/lib/setupAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('k');
  if (!setupEnabled()) {
    return NextResponse.json(
      { error: 'Setup is disabled: SETUP_KEY is not set on this deployment.' },
      { status: 404 },
    );
  }
  if (!setupKeyValid(key)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    scopeString: SCOPE_STRING,
    groups: SCOPE_GROUPS,
    config: {
      // Presence only — never the values.
      clientId: Boolean(process.env.ZOHO_CLIENT_ID),
      clientSecret: Boolean(process.env.ZOHO_CLIENT_SECRET),
      refreshToken: Boolean(process.env.ZOHO_REFRESH_TOKEN),
      orgId: process.env.ZOHO_ORG_ID ?? '',
      accountsDomain: process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.eu',
      apiDomain: process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.eu',
    },
  });
}
