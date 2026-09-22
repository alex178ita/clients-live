import { NextResponse } from 'next/server';
import { isAuthorised } from '../../../../lib/auth';
import { DATA_CENTRES, SCOPE_STRING } from '../../../../lib/zoho-dc';

export const dynamic = 'force-dynamic';

// Tells the setup page which data centres exist, which scopes to ask for, and
// which variables are already set on this deployment (values are never sent).
export async function GET(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  return NextResponse.json({
    scopeString: SCOPE_STRING,
    dataCentres: Object.entries(DATA_CENTRES).map(([key, value]) => ({ key, ...value })),
    configured: {
      ZOHO_CLIENT_ID: Boolean(process.env.ZOHO_CLIENT_ID),
      ZOHO_CLIENT_SECRET: Boolean(process.env.ZOHO_CLIENT_SECRET),
      ZOHO_REFRESH_TOKEN: Boolean(process.env.ZOHO_REFRESH_TOKEN),
      APP_PASSWORD: Boolean(process.env.APP_PASSWORD),
      ZOHO_ACCOUNTS_HOST: process.env.ZOHO_ACCOUNTS_HOST || null,
      ZOHO_API_HOST: process.env.ZOHO_API_HOST || null,
      NEXT_PUBLIC_CRM_BASE_URL: process.env.NEXT_PUBLIC_CRM_BASE_URL || null
    }
  });
}
