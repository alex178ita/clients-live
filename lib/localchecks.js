// Results pushed in by the local script, kept in a single JSON blob.
//
// The probe that runs on Vercel is answered 403 by the bot protection in front
// of several clients, so the same check also runs from a normal office
// connection and posts its findings here. Only the latest run is kept: the
// dashboard shows a state, not a history.

const { put, get } = require('@vercel/blob');

const BLOB_PATH = 'local-checks/latest.json';
const CACHE_TTL_MS = 60 * 1000;

let cache = null; // { at, payload }
let lastReadError = null;

// A Blob store is created either public or private and the SDK refuses the
// wrong one outright, so the mode settles itself at runtime: start from the
// configured value and flip on the mismatch error, rather than making anyone
// hand-configure it.
let accessMode = (process.env.BLOB_ACCESS || 'private').trim() === 'public' ? 'public' : 'private';

function otherAccess(mode) {
  return mode === 'public' ? 'private' : 'public';
}

function isAccessMismatch(error) {
  return /access on a (private|public) store|configured with (private|public) access/i.test(
    String((error && error.message) || error)
  );
}

// Two ways a Blob store can be wired up, and a project connected from the
// dashboard today gets the second one:
//   - the classic read-write token, BLOB_READ_WRITE_TOKEN
//   - OIDC, where BLOB_STORE_ID names the store and the runtime supplies the
//     credential (VERCEL_OIDC_TOKEN) on its own
function configured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function storageMode() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'token';
  if (process.env.BLOB_STORE_ID) return 'oidc';
  return null;
}

const EMPTY = { runAt: null, source: null, results: {} };

function normalise(payload) {
  return {
    runAt: (payload && payload.runAt) || null,
    source: (payload && payload.source) || null,
    results: payload && payload.results && typeof payload.results === 'object' ? payload.results : {}
  };
}

async function readOnce(access) {
  // useCache: false — a run posted seconds ago has to be visible at once.
  const found = await get(BLOB_PATH, { access, useCache: false });
  if (!found || found.statusCode !== 200 || !found.stream) return EMPTY;
  const payload = await new Response(found.stream).json();
  return normalise(payload);
}

async function readLocalChecks({ force = false } = {}) {
  if (!configured()) return EMPTY;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;

  try {
    let payload;
    try {
      payload = await readOnce(accessMode);
    } catch (error) {
      if (!isAccessMismatch(error)) throw error;
      accessMode = otherAccess(accessMode);
      payload = await readOnce(accessMode);
    }

    lastReadError = null;
    cache = { at: Date.now(), payload };
    return payload;
  } catch (error) {
    // Never let a storage hiccup take the dashboard down: the live probe alone
    // is still a usable answer.
    lastReadError = String((error && error.message) || error);
    return cache ? cache.payload : EMPTY;
  }
}

async function writeOnce(body, access) {
  return put(BLOB_PATH, body, {
    access,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
}

async function writeLocalChecks(payload) {
  if (!configured()) {
    throw new Error(
      'No Blob store is connected: this deployment has neither BLOB_STORE_ID nor BLOB_READ_WRITE_TOKEN. ' +
        'Connect a Blob store to the project in the Vercel dashboard, then redeploy.'
    );
  }

  const body = JSON.stringify(payload);

  try {
    await writeOnce(body, accessMode);
  } catch (error) {
    if (!isAccessMismatch(error)) throw error;
    accessMode = otherAccess(accessMode);
    await writeOnce(body, accessMode);
  }

  cache = { at: Date.now(), payload: normalise(payload) };
  return payload;
}

module.exports = {
  readLocalChecks,
  writeLocalChecks,
  configured,
  storageMode,
  blobAccess: () => accessMode,
  lastStorageError: () => lastReadError,
  BLOB_PATH
};
