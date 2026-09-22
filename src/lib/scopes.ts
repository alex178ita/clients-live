/**
 * The OAuth scopes this app's refresh token needs.
 *
 * Naming, verified against Zoho's own docs — getting one wrong invalidates the
 * whole string, or silently yields a token missing that permission:
 *   CRM     ZohoCRM.<module>.<PERMISSION>
 *   Books   ZohoBooks.<resource>.<PERMISSION>
 *   Billing ZohoSubscriptions.<resource>.<PERMISSION>   <- NOT ZohoBilling.*
 * Zoho Subscriptions was renamed Zoho Billing and the endpoint moved to
 * /billing/v1/, but the scope prefix kept the old product name.
 */

export interface ScopeGroup {
  product: 'crm' | 'books' | 'billing';
  label: string;
  scopes: { name: string; why: string; future?: boolean }[];
}

export const SCOPE_GROUPS: ScopeGroup[] = [
  {
    product: 'crm',
    label: 'Zoho CRM',
    scopes: [
      { name: 'ZohoCRM.coql.READ', why: 'the COQL query that pulls won and closing deals' },
      { name: 'ZohoCRM.modules.deals.READ', why: 'the Deals module itself' },
      { name: 'ZohoCRM.users.READ', why: 'owner and Customer Success Manager names' },
      { name: 'ZohoCRM.settings.fields.READ', why: 'field metadata, e.g. picklist values', future: true },
    ],
  },
  {
    product: 'books',
    label: 'Zoho Books',
    scopes: [
      { name: 'ZohoBooks.invoices.READ', why: 'invoices issued, balances and payment dates' },
      { name: 'ZohoBooks.contacts.READ', why: 'customer records behind the invoices' },
      { name: 'ZohoBooks.creditnotes.READ', why: 'netting credit notes off invoiced totals', future: true },
      { name: 'ZohoBooks.settings.READ', why: 'organisation settings', future: true },
    ],
  },
  {
    product: 'billing',
    label: 'Zoho Billing',
    scopes: [
      { name: 'ZohoSubscriptions.subscriptions.READ', why: 'the subscription behind each deal, and its next billing date' },
      { name: 'ZohoSubscriptions.invoices.READ', why: 'invoices raised by Billing' },
      { name: 'ZohoSubscriptions.customers.READ', why: 'customers behind the subscriptions' },
      { name: 'ZohoSubscriptions.payments.READ', why: 'payments, for the realistic cash flow' },
      { name: 'ZohoSubscriptions.plans.READ', why: 'plan details' },
      { name: 'ZohoSubscriptions.addons.READ', why: 'add-on details' },
      { name: 'ZohoSubscriptions.subscriptions.CREATE', why: 'creating a subscription from a won deal', future: true },
      { name: 'ZohoSubscriptions.subscriptions.UPDATE', why: 'amending a subscription', future: true },
      { name: 'ZohoSubscriptions.invoices.CREATE', why: 'raising an invoice', future: true },
      { name: 'ZohoSubscriptions.invoices.UPDATE', why: 'amending an invoice', future: true },
      { name: 'ZohoSubscriptions.customers.CREATE', why: 'creating a customer', future: true },
      { name: 'ZohoSubscriptions.customers.UPDATE', why: 'amending a customer', future: true },
      { name: 'ZohoSubscriptions.payments.CREATE', why: 'recording a payment', future: true },
    ],
  },
];

export const ALL_SCOPES: string[] = SCOPE_GROUPS.flatMap((g) => g.scopes.map((s) => s.name));

/** Exactly what goes in the Zoho self client box: commas, no spaces, no line breaks. */
export const SCOPE_STRING = ALL_SCOPES.join(',');
