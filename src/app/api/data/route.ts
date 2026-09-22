import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { getDashboard } from '@/lib/source';
import { ZohoError } from '@/lib/zoho';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  try {
    const payload = await getDashboard(force);
    return NextResponse.json(payload);
  } catch (error) {
    // Only a failure outside the three product calls lands here (for example a
    // refused token refresh); a single product refusing is reported inside the
    // payload as a sourceError instead.
    const detail =
      error instanceof ZohoError
        ? { endpoint: error.endpoint, status: error.status, body: error.body }
        : null;
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message, detail }, { status: 502 });
  }
}
