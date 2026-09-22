// Results pushed in by the local script, kept in a single JSON blob.
//
// The probe that runs on Vercel is answered 403 by the bot protection in front
// of several clients, so the same check also runs from a normal office
// connection and posts its findings here. Only the latest run is kept: the
// dashboard shows a state, not a history.

const { put, list } = require('@vercel/blob');

const BLOB_PATH = 'local-checks/latest.json';
const CACHE_TTL_MS = 60 * 1000;

let cache = null; // { at, payload }
let lastReadError = null;

// Two ways a Blob store can be wired up, and a project connected from the
// dashboard today gets the second one:
//   - the classic read-write token, BLOB_READ_WRITE_TOKEN
//   - OIDC, where BLOB_STORE_ID names the store and the runtime supplies the
//     credential (VERCEL_OIDC_TOKEN) on its own
function configured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

const EMPTY = { runAt: null, source: null, results: {} };

async function readLocalChecks({ force = false } = {}) {
  if (!configured()) return EMPTY;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;

  try {
    // The blob is overwritten with a random suffix disabled, so the path is
    // stable, but listing is the reliable way to get its current URL.
    const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
    if (!blobs || blobs.length === 0) {
      cache = { at: Date.now(), payload: EMPTY };
      return EMPTY;
    }

    const res = await fetch(blobs[0].url, { cache: 'no-store' });
    if (!res.ok) return cache ? cache.payload : EMPTY;

    const payload = await res.json();
    const normalised = {
      runAt: payload.runAt || null,
      source: payload.source || null,
      results: payload.results && typeof payload.results === 'object' ? payload.results : {}
    };
    cache = { at: Date.now(), payload: normalised };
    return normalised;
  } catch (error) {
    // Never let a storage hiccup take the dashboard down: the live probe alone
    // is still a usable answer.
    lastReadError = String((error && error.message) || error);
    return cache ? cache.payload : EMPTY;
  }
}

async function writeLocalChecks(payload) {
  if (!configured()) {
    throw new Error(
      'No Blob store is connected: this deployment has neither BLOB_STORE_ID nor BLOB_READ_WRITE_TOKEN. ' +
        'Connect a Blob store to the project in the Vercel dashboard, then redeploy.'
    );
  }

  const body = JSON.stringify(payload);
  await put(BLOB_PATH, body, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });

  cache = { at: Date.now(), payload };
  return payload;
}

function storageMode() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'token';
  if (process.env.BLOB_STORE_ID) return 'oidc';
  return null;
}

module.exports = {
  readLocalChecks,
  writeLocalChecks,
  configured,
  storageMode,
  lastStorageError: () => lastReadError,
  BLOB_PATH
};
