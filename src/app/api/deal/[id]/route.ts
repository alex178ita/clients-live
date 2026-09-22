import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { getDashboard } from '@/lib/source';
import { getBooksInvoice } from '@/lib/zoho';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Detail for one expanded row: the linked Billing subscription plus the full
 * Books invoice records (sub total, VAT, payments applied). The list endpoint
 * only carries invoice totals, so the net figures are fetched on demand.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const payload = await getDashboard();
  const row = payload.rows.find((r) => r.id === params.id);
  if (!row) return NextResponse.json({ error: 'deal not found' }, { status: 404 });

  const details = await Promise.all(
    row.invoices.slice(0, 40).map(async (inv) => {
      try {
        const full = await getBooksInvoice(inv.invoiceId);
        return {
          invoiceId: inv.invoiceId,
          subTotal: Number(full?.sub_total ?? 0),
          taxTotal: Number(full?.tax_total ?? 0),
          total: Number(full?.total ?? inv.total),
          balance: Number(full?.balance ?? inv.balance),
          payments: (full?.payments ?? []).map((p: any) => ({
            date: String(p.date ?? '').slice(0, 10),
            amount: Number(p.amount ?? 0),
            paymentMode: p.payment_mode ?? null,
          })),
        };
      } catch {
        return { invoiceId: inv.invoiceId, subTotal: null, taxTotal: null, payments: [] };
      }
    }),
  );

  return NextResponse.json({ dealId: row.id, subscription: row.subscription, details });
}
