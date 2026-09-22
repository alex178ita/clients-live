// Probe a client homepage for the Kleecks fingerprint.
//
// Two independent signals, either one is enough:
//   1. response headers  -> x-optimized-by: Kleecks (https://www.kleecks.com), kleecks-debug
//   2. <body> classes    -> KL-* families (KL-D-n, KL-LANG-xx, KL-UA-*, KL-URL-*,
//                           KL-CMS_URL-LEVEL-n, ...) and sp-HOME
//
// The class suffixes are generated per page (KL-D-1 on conte.it, KL-D-64 elsewhere),
// so the families are matched by prefix rather than as fixed strings.

const BODY_CLASS_PATTERNS = [
  /\bKL-CMS_URL-LEVEL-[\w-]+/i,
  /\bKL-D-[\w-]+/i,
  /\bKL-LANG-[\w-]+/i,
  /\bKL-UA-[\w-]+/i,
  /\bKL-URL-[\w-]+/i,
  /\bsp-HOME\b/
];

const DESKTOP_UA =
  process.env.PROBE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// A bare User-Agent is not enough for the WAFs in front of the luxury sites:
// Akamai and friends score the whole header set, and a request missing the
// sec-* and Accept-Encoding headers a real Chrome always sends gets a 403.
function browserHeaders() {
  return {
    'User-Agent': DESKTOP_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  };
}

const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 12000);
const MAX_BYTES = Number(process.env.PROBE_MAX_BYTES || 400_000);
const TTL_MS = Number(process.env.LIVE_TTL_MINUTES || 180) * 60 * 1000;

// Module-level cache. It lives for as long as the serverless instance stays warm,
// which is exactly the "short cache" behaviour we want: the first visitor pays
// for the probes, the ones right after do not.
const cache = new Map(); // key -> { checkedAt, result }

function detectInHeaders(headers) {
  const found = [];
  const optimizedBy = headers.get('x-optimized-by');
  if (optimizedBy && /kleecks/i.test(optimizedBy)) found.push(`x-optimized-by: ${optimizedBy.trim()}`);
  if (headers.get('kleecks-debug')) found.push('kleecks-debug');
  return found;
}

function detectInBody(html) {
  const bodyTag = (html.match(/<body[^>]*>/i) || [])[0] || '';
  const classAttr = (bodyTag.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
  const found = [];
  for (const pattern of BODY_CLASS_PATTERNS) {
    const hit = classAttr.match(pattern);
    if (hit) found.push(hit[0]);
  }
  return { found, bodyClass: classAttr };
}

async function readCapped(res) {
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) return await res.text();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    // The <body> tag lives in the first few KB; stop as soon as we have it.
    if (/<body[^>]*>/i.test(out)) break;
  }
  try { await reader.cancel(); } catch (err) { /* already closed */ }
  return out;
}

async function probeUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: browserHeaders()
    });

    const headerSignals = detectInHeaders(res.headers);
    let bodySignals = [];
    let bodyClass = '';

    if (res.ok) {
      const html = await readCapped(res);
      const parsed = detectInBody(html);
      bodySignals = parsed.found;
      bodyClass = parsed.bodyClass;
    }

    const signals = [...headerSignals, ...bodySignals];
    if (signals.length > 0) {
      return { status: 'live', httpStatus: res.status, finalUrl: res.url || url, signals, bodyClass };
    }
    if (res.ok) {
      return { status: 'offline', httpStatus: res.status, finalUrl: res.url || url, signals: [], bodyClass };
    }
    // 4xx/5xx with no marker: the page never rendered for us, so we cannot call it.
    // 403 and 429 from a datacentre IP are the WAF, not the client dropping us.
    const reason =
      res.status === 403 || res.status === 429
        ? `HTTP ${res.status} — blocked by the site's bot protection`
        : `HTTP ${res.status}`;
    return { status: 'unknown', httpStatus: res.status, finalUrl: res.url || url, signals: [], reason };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS} ms` : String((err && err.message) || err);
    return { status: 'unknown', httpStatus: null, finalUrl: url, signals: [], reason };
  } finally {
    clearTimeout(timer);
  }
}

async function checkClient({ key, candidates }, { force = false } = {}) {
  if (!candidates || candidates.length === 0) {
    return { status: 'unknown', reason: 'no domain resolved', signals: [], checkedAt: new Date().toISOString(), cached: false };
  }

  const cacheKey = candidates[0];
  const hit = cache.get(cacheKey);
  if (!force && hit && Date.now() - hit.checkedAt < TTL_MS) {
    return { ...hit.result, checkedAt: new Date(hit.checkedAt).toISOString(), cached: true };
  }

  let last = null;
  for (const url of candidates) {
    const result = await probeUrl(url);
    last = result;
    if (result.status === 'live' || result.status === 'offline') break;
  }

  const checkedAt = Date.now();
  cache.set(cacheKey, { checkedAt, result: last });
  return { ...last, checkedAt: new Date(checkedAt).toISOString(), cached: false };
}

// Probe with a bounded number of sockets in flight.
async function checkAll(targets, { force = false, concurrency = Number(process.env.PROBE_CONCURRENCY || 12) } = {}) {
  const results = {};
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const target = targets[index];
      results[target.key] = await checkClient(target, { force });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}

module.exports = { checkAll, checkClient, detectInBody, detectInHeaders, BODY_CLASS_PATTERNS };
