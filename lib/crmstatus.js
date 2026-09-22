// Third and last resort: what the CRM says about the licence.
//
// A handful of sites answer neither Vercel nor the run from the office — a WAF
// that blocks anything without a real browser, a domain that only resolves from
// inside a corporate network. For those the dashboard used to show n/d for good,
// which is honest but useless.
//
// The licence itself is evidence of a kind: a client that is won, not flagged
// lost, and whose last licence deal runs past today is contractually live. That
// is an inference about the contract, not a reading of the site, so it is only
// ever applied where both probes came back blind, and it is labelled "via CRM"
// everywhere it shows.
//
// It is deliberately one-directional. An expired or lost licence is NOT turned
// into "offline": a site left running after a lost licence is exactly the case
// the ▲ alert exists for, and inferring "offline" would hide it.

function today() {
  // Europe/Rome — the licence dates in the CRM are calendar dates, and the
  // comparison has to happen on the same calendar the sales team uses.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
}

function crmLiveGuess(row, now) {
  if (!row) return null;
  if (row.lost) return null;
  // Expired is belt and braces: a licence flagged expired has an end date in
  // the past anyway, but the flag is the CRM's own word for it.
  if (row.expired) return null;
  if (!row.licenceEnd) return null;

  const day = now || today();
  if (row.licenceEnd < day) return null;

  return {
    status: 'live',
    source: 'crm',
    sourceLabel: 'CRM licence',
    licenceEnd: row.licenceEnd,
    signals: [],
    reason:
      `Licence still running (to ${row.licenceEnd}) and not flagged as lost — ` +
      'inferred from the CRM, the site itself could not be read'
  };
}

module.exports = { crmLiveGuess, today };
