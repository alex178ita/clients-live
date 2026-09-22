// Shared, short-lived cache of the CRM rows so /api/clients and /api/live agree
// on the same list and Zoho is not queried once per batch.

const { fetchWonClients } = require('./clients');

const TTL_MS = Number(process.env.CRM_TTL_MINUTES || 5) * 60 * 1000;

let cache = null; // { at, rows }
let inFlight = null;

async function getRows({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return { rows: cache.rows, fetchedAt: cache.at, cached: true };
  }
  if (!force && inFlight) {
    const rows = await inFlight;
    return { rows, fetchedAt: cache ? cache.at : Date.now(), cached: true };
  }

  inFlight = fetchWonClients()
    .then((rows) => {
      cache = { at: Date.now(), rows };
      return rows;
    })
    .finally(() => {
      inFlight = null;
    });

  const rows = await inFlight;
  return { rows, fetchedAt: cache.at, cached: false };
}

module.exports = { getRows };
