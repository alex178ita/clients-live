// Shared, short-lived cache of the CRM rows so /api/clients and /api/live agree
// on the same list and Zoho is not queried once per batch.

const { fetchWonClients } = require('./clients');

const TTL_MS = Number(process.env.CRM_TTL_MINUTES || 5) * 60 * 1000;

let cache = null; // { at, rows }
let inFlight = null;

// minAt: the moment the caller already knows the CRM was read. Each Vercel
// instance keeps its own copy of this cache, so the one answering /api/clients
// can be fresh while the ones answering the /api/live batches are still serving
// a read from before the edit in Zoho. The browser passes the timestamp it was
// given, and any instance holding something older refetches — once, thanks to
// inFlight, instead of once per batch.
async function getRows({ force = false, minAt = 0 } = {}) {
  const stale = minAt && cache && cache.at < minAt;
  if (!force && !stale && cache && Date.now() - cache.at < TTL_MS) {
    return { rows: cache.rows, fetchedAt: cache.at, cached: true };
  }
  if (stale && inFlight) {
    const rows = await inFlight;
    return { rows, fetchedAt: cache ? cache.at : Date.now(), cached: true };
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
