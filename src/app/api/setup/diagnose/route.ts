import { NextResponse } from 'next/server';
import { setupEnabled, setupKeyValid } from '@/lib/setupAuth';
import { ORG_ID, ZohoError, mintAccessToken, probe } from '@/lib/zoho';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Check {
  product: 'crm' | 'books' | 'billing';
  label: string;
  scope: string;
  run: (token: string) => Promise<{ ok: boolean; status: number; message: string }>;
}

const CHECKS: Check[] = [
  {
    product: 'crm',
    label: 'CRM — read Deals',
    scope: 'ZohoCRM.modules.deals.READ',
    run: (t) => probe(t, '/crm/v7/Deals?fields=id&per_page=1'),
  },
  {
    product: 'crm',
    label: 'CRM — COQL query',
    scope: 'ZohoCRM.coql.READ',
    run: (t) =>
      probe(t, '/crm/v7/coql', {
        method: 'POST',
        body: { select_query: 'select id from Deals where id is not null limit 1' },
      }),
  },
  {
    product: 'crm',
    label: 'CRM — read users',
    scope: 'ZohoCRM.users.READ',
    run: (t) => probe(t, '/crm/v7/users?type=CurrentUser'),
  },
  {
    product: 'books',
    label: 'Books — list invoices',
    scope: 'ZohoBooks.invoices.READ',
    run: (t) => probe(t, `/books/v3/invoices?organization_id=${ORG_ID}&per_page=1`),
  },
  {
    product: 'books',
    label: 'Books — list contacts',
    scope: 'ZohoBooks.contacts.READ',
    run: (t) => probe(t, `/books/v3/contacts?organization_id=${ORG_ID}&per_page=1`),
  },
  {
    product: 'billing',
    label: 'Billing — list subscriptions',
    scope: 'ZohoSubscriptions.subscriptions.READ',
    run: (t) =>
      probe(t, '/billing/v1/subscriptions?per_page=1&filter_by=SubscriptionStatus.All', {
        headers: { 'X-com-zoho-subscriptions-organizationid': ORG_ID },
      }),
  },
  {
    product: 'billing',
    label: 'Billing — list customers',
    scope: 'ZohoSubscriptions.customers.READ',
    run: (t) =>
      probe(t, '/billing/v1/customers?per_page=1', {
        headers: { 'X-com-zoho-subscriptions-organizationid': ORG_ID },
      }),
  },
];

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!setupEnabled()) {
    return NextResponse.json({ error: 'Setup is disabled on this deployment.' }, { status: 404 });
  }
  if (!setupKeyValid(body?.k)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  // Either a refresh token pasted into the page, or the one this deployment runs on.
  const candidate =
    typeof body?.refreshToken === 'string' && body.refreshToken.trim()
      ? body.refreshToken.trim()
      : process.env.ZOHO_REFRESH_TOKEN;
  const usingDeploymentToken = !(
    typeof body?.refreshToken === 'string' && body.refreshToken.trim()
  );

  if (!candidate) {
    return NextResponse.json(
      { error: 'No refresh token to test: paste one, or set ZOHO_REFRESH_TOKEN.' },
      { status: 400 },
    );
  }
  if (!ORG_ID) {
    return NextResponse.json({ error: 'ZOHO_ORG_ID is not set on this deployment.' }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await mintAccessToken(candidate);
  } catch (error) {
    const message = error instanceof ZohoError ? error.message : String(error);
    return NextResponse.json(
      {
        error: `Could not get an access token from this refresh token: ${message}`,
        hint: 'A refresh token is permanent but can be revoked, and Zoho keeps only the newest few per user — generating many in a row retires the older ones.',
      },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    CHECKS.map(async (check) => {
      try {
        const outcome = await check.run(accessToken);
        return { product: check.product, label: check.label, scope: check.scope, ...outcome };
      } catch (error) {
        return {
          product: check.product,
          label: check.label,
          scope: check.scope,
          ok: false,
          status: 0,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    usingDeploymentToken,
    orgId: ORG_ID,
    results,
  });
}
