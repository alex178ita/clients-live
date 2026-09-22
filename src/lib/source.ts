// Fetches everything the dashboard needs and keeps it in a short-lived
// in-memory cache so that a burst of requests from the CRM Web Tab does not
// hammer the Zoho APIs.
//
// The three products are fetched independently: if Books or Billing refuses,
// the dashboard still renders with what did arrive and says exactly which
// product failed and why, instead of dying with one opaque 401.

import { applyCreditNotes, buildDashboard } from './build';
import {
  creditNotesByInvoice,
  normaliseDeal,
  normaliseInvoice,
  normaliseSubscription,
} from './normalise';
import type { DashboardPayload, SourceError } from './types';
import {
  ZohoError,
  coql,
  getBooksCreditNote,
  listBillingSubscriptions,
  listBooksCreditNotes,
  listBooksInvoices,
} from './zoho';

const DEAL_FIELDS = [
  'id',
  'Deal_Name',
  'Stage',
  'Amount',
  'Licence',
  'Delivery',
  'Closing_Date',
  'Licence_Start_Date',
  'Licence_End_Date',
  'Duration',
  'Duration_Basis',
  'Value_per_Duration',
  'Expected_Date_of_First_Invoice',
  'Payment_Terms_number_of_days',
  'Advance_Payment',
  'Terms_for_Advance_Payment_days',
  'Invoice_Date_for_Advance_Payment',
  'Owner',
  'Account_Name',
  'Final_Client',
  'Customer_Success_Manager',
  'Licence_Modules',
  'Auto_renew',
  'Currency',
].join(', ');

const STAGES = "('8. Client Won', 'Client won', '6. Closing', '7. Signed')";

/** Oldest data pulled from Zoho. Older deals are out of scope for this prospectus. */
const MIN_DATE = process.env.MIN_DATA_DATE || '2023-01-01';

const TTL_MS = Number(process.env.CACHE_TTL_SECONDS || 300) * 1000;

const HINTS: Record<SourceError['source'], string> = {
  crm: 'Check that the refresh token carries ZohoCRM.coql.READ, ZohoCRM.modules.deals.READ and ZohoCRM.users.READ.',
  books:
    'Check that the refresh token carries ZohoBooks.invoices.READ (or ZohoBooks.fullaccess.all) and that ZOHO_ORG_ID is the Books organisation this token can see.',
  creditnotes:
    'Check that the refresh token carries ZohoBooks.creditnotes.READ. Without it, invoices cancelled by a credit note cannot be told apart from invoices actually paid.',
  billing:
    'Check that the refresh token carries ZohoSubscriptions.subscriptions.READ and that ZOHO_ORG_ID is the Billing organisation.',
};

const LABELS: Record<SourceError['source'], string> = {
  crm: 'Zoho CRM (deals)',
  books: 'Zoho Books (invoices)',
  creditnotes: 'Zoho Books (credit notes)',
  billing: 'Zoho Billing (subscriptions)',
};

/**
 * Credit notes take two passes: the list does not say which invoices a note was
 * applied to, only the detail does. There are few of them, so we fetch the
 * details with a small amount of concurrency and cap the work.
 */
const MAX_CREDIT_NOTES = 400;
const CREDIT_NOTE_CONCURRENCY = 6;

async function loadCreditNoteDetails(): Promise<any[]> {
  const list = await listBooksCreditNotes({ date_start: MIN_DATE });
  const wanted = list
    .filter((note: any) => note?.status !== 'draft' && note?.status !== 'void')
    .slice(0, MAX_CREDIT_NOTES);

  const details: any[] = [];
  for (let i = 0; i < wanted.length; i += CREDIT_NOTE_CONCURRENCY) {
    const batch = wanted.slice(i, i + CREDIT_NOTE_CONCURRENCY);
    const settledBatch = await Promise.all(
      batch.map((note: any) =>
        getBooksCreditNote(String(note.creditnote_id)).catch(() => null),
      ),
    );
    details.push(...settledBatch.filter(Boolean));
  }
  return details;
}

let cache: { at: number; payload: DashboardPayload } | null = null;
let inFlight: Promise<DashboardPayload> | null = null;

function toSourceError(source: SourceError['source'], reason: unknown): SourceError {
  const zoho = reason instanceof ZohoError ? reason : null;
  return {
    source,
    label: LABELS[source],
    message:
      zoho?.message ??
      (reason instanceof Error ? reason.message : String(reason ?? 'unknown error')),
    endpoint: zoho?.endpoint ?? '',
    status: zoho?.status ?? null,
    hint: HINTS[source],
  };
}

function settled<T>(
  result: PromiseSettledResult<T>,
  source: SourceError['source'],
  errors: SourceError[],
  fallback: T,
): T {
  if (result.status === 'fulfilled') return result.value;
  const issue = toSourceError(source, result.reason);
  errors.push(issue);
  // Surfaced in the Vercel runtime logs so an intermittent refusal can be
  // traced back to the exact endpoint and Zoho code afterwards.
  console.error(
    `[zoho] ${source} refused: ${issue.message} (HTTP ${issue.status ?? '?'}) at ${issue.endpoint || 'n/a'}`,
  );
  return fallback;
}

/**
 * Offline preview. With DEMO_MODE=1 the app reads `fixtures/demo.json`
 * (raw Zoho-shaped records) instead of calling Zoho, so the UI can be run
 * without credentials. Never set it on the production deployment.
 * The file is read at runtime rather than imported, so it is not bundled.
 */
async function loadFixture(): Promise<DashboardPayload> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const raw = await readFile(join(process.cwd(), 'fixtures', 'demo.json'), 'utf8');
  const fixture = JSON.parse(raw) as {
    deals: any[];
    invoices: any[];
    subscriptions: any[];
    creditNotes?: any[];
  };
  const deals = fixture.deals
    .map(normaliseDeal)
    .filter((d): d is NonNullable<ReturnType<typeof normaliseDeal>> => d !== null);
  return buildDashboard({
    deals,
    invoices: applyCreditNotes(
      fixture.invoices.map(normaliseInvoice),
      creditNotesByInvoice(fixture.creditNotes ?? []),
    ),
    subscriptions: fixture.subscriptions.map(normaliseSubscription),
  });
}

async function load(): Promise<DashboardPayload> {
  if (process.env.DEMO_MODE === '1') return loadFixture();

  const [dealsResult, invoicesResult, subscriptionsResult, creditNotesResult] =
    await Promise.allSettled([
      coql(
        `select ${DEAL_FIELDS} from Deals where Stage in ${STAGES} and Closing_Date >= '${MIN_DATE}' order by Closing_Date desc`,
      ),
      listBooksInvoices({ date_start: MIN_DATE, filter_by: 'Status.All' }),
      listBillingSubscriptions(),
      loadCreditNoteDetails(),
    ]);

  const sourceErrors: SourceError[] = [];
  const dealRows = settled(dealsResult, 'crm', sourceErrors, [] as any[]);
  const invoiceRows = settled(invoicesResult, 'books', sourceErrors, [] as any[]);
  const subscriptionRows = settled(subscriptionsResult, 'billing', sourceErrors, [] as any[]);
  const creditNoteRows = settled(creditNotesResult, 'creditnotes', sourceErrors, [] as any[]);

  const deals = dealRows
    .map(normaliseDeal)
    .filter((d): d is NonNullable<ReturnType<typeof normaliseDeal>> => d !== null);

  const payload = buildDashboard({
    deals,
    invoices: applyCreditNotes(
      invoiceRows.map(normaliseInvoice),
      creditNotesByInvoice(creditNoteRows),
    ),
    subscriptions: subscriptionRows.map(normaliseSubscription),
  });
  payload.sourceErrors = sourceErrors;
  return payload;
}

export async function getDashboard(force = false): Promise<DashboardPayload> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.payload;
  if (!inFlight) {
    inFlight = load()
      .then((payload) => {
        // A run where a product refused is not cached for long: the fix is
        // usually a scope change, and we want the next open to pick it up.
        cache = payload.sourceErrors.length > 0 ? null : { at: Date.now(), payload };
        return payload;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
