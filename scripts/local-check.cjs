#!/usr/bin/env node
/**
 * Runs the Kleecks live check from this machine and posts the results back to
 * the dashboard.
 *
 * The probe that runs on Vercel is answered 403 by the bot protection in front
 * of several clients, because it comes from a datacentre IP. Run from a normal
 * office connection the same request goes through, so this script fills in
 * exactly the rows the dashboard cannot see for itself.
 *
 * Usage:
 *   APP_URL=https://clients-live.vercel.app \
 *   LOCAL_CHECK_TOKEN=xxxxxxxx \
 *   node scripts/local-check.cjs
 *
 * Options:
 *   --dry-run   print the outcome without posting it back
 *   --verbose   one line per client while it runs
 */

const path = require('path');

// Same detection as the server: markers stay in one place so the two can never
// drift apart.
const { checkAll } = require(path.join(__dirname, '..', 'lib', 'livecheck.js'));

const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const TOKEN = (process.env.LOCAL_CHECK_TOKEN || '').trim();
const CONCURRENCY = Number(process.env.LOCAL_CONCURRENCY || 6);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const VERBOSE = args.has('--verbose');

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!APP_URL) fail('APP_URL is not set (e.g. https://clients-live.vercel.app)');
  if (!TOKEN) fail('LOCAL_CHECK_TOKEN is not set — use the same value saved on Vercel');

  process.stdout.write('Asking the dashboard what to check… ');
  const res = await fetch(`${APP_URL}/api/local-check`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  if (res.status === 401) fail('The token was refused. Check LOCAL_CHECK_TOKEN here and on Vercel.');
  if (!res.ok) fail(`The dashboard answered ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const { targets, lastRunAt, blobConfigured, storageMode, blobAccess } = await res.json();
  console.log(`${targets.length} clients.`);
  if (blobConfigured === false) {
    console.warn(
      '! No Blob store is connected on Vercel (neither BLOB_STORE_ID nor BLOB_READ_WRITE_TOKEN):\n' +
        '  connect one to the project from the dashboard and redeploy, or the results have nowhere to go.'
    );
  } else if (storageMode) {
    console.log(
      `Storage: Blob via ${storageMode === 'oidc' ? 'BLOB_STORE_ID (OIDC)' : 'read-write token'}` +
        (blobAccess ? `, ${blobAccess} store.` : '.')
    );
  }
  if (lastRunAt) console.log(`Previous run: ${new Date(lastRunAt).toLocaleString()}`);

  const list = targets.map((t) => ({ key: t.key, name: t.clientName, candidates: t.urls }));
  console.log(`Checking with ${CONCURRENCY} at a time…\n`);

  const started = Date.now();
  const byKey = await checkAll(list, { force: true, concurrency: CONCURRENCY });

  const results = [];
  const counts = { live: 0, offline: 0, unknown: 0 };
  for (const target of list) {
    const outcome = byKey[target.key] || { status: 'unknown', reason: 'no result' };
    counts[outcome.status] = (counts[outcome.status] || 0) + 1;
    results.push({
      key: target.key,
      status: outcome.status,
      signals: outcome.signals || [],
      reason: outcome.reason || null,
      httpStatus: outcome.httpStatus || null,
      finalUrl: outcome.finalUrl || null,
      checkedAt: outcome.checkedAt || new Date().toISOString()
    });
    if (VERBOSE) {
      const mark = outcome.status === 'live' ? '✓' : outcome.status === 'offline' ? '·' : '?';
      console.log(`  ${mark} ${String(target.name).padEnd(44).slice(0, 44)} ${outcome.status}${outcome.reason ? ` — ${outcome.reason}` : ''}`);
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${counts.live} live · ${counts.offline} offline · ${counts.unknown} not reachable — in ${seconds}s`);

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing was posted.');
    return;
  }

  const post = await fetch(`${APP_URL}/api/local-check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ results, source: `local script on ${require('os').hostname()}` })
  });

  if (!post.ok) fail(`Could not store the results (${post.status}): ${(await post.text()).slice(0, 300)}`);

  const stored = await post.json();
  console.log(`\n✓ Sent: ${stored.stored} clients stored at ${new Date(stored.runAt).toLocaleString()}`);
  console.log('  The dashboard now uses these for every row it could not read itself.');
}

main().catch((error) => fail(String(error && error.stack ? error.stack : error)));
