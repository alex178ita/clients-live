// Resolve the homepage to probe for each client.
//
// Priority: "skip" in the map  >  Website URL on the deal  >  Website on the
// account (the Final Client's account when the deal is indirect)  >  the map as
// a fallback  >  a domain guessed from the client name.

const overrides = require('../config/domain-overrides.json');

const LEGAL_SUFFIXES = [
  'spa', 'srls', 'srl', 'sau', 'sas', 'sa', 'as', 'ag', 'gmbh', 'bv', 'nv',
  'plc', 'ltd', 'limited', 'llc', 'inc', 'corp', 'corporation',
  'pte', 'co', 'kg', 'oy', 'ab', 'aps', 'sl', 'sarl',
  'societa', 'benefit', 'responsabilita', 'limitata', 'rag',
  'group', 'groupe', 'holding', 'italia', 'italy'
];

const NOISE_WORDS = ['the', 'and', 'di', 'de', 'del', 'della', 'dei', 'delle'];

function stripAccents(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Reduce "GIANNI VERSACE S.R.L." to "gianniversace", "Casa Del Caffe Vergnano S P A"
// to "casacaffevergnano", and so on.
function slugFromName(name) {
  let base = stripAccents(String(name || '')).toLowerCase();
  // "S.P.A." and "S P A" both have to collapse to the single token "spa" before
  // the legal suffixes are dropped, so punctuation and lone letters go first.
  base = base.replace(/[^a-z0-9\s.\-']/g, ' ');
  base = base.replace(/\b([a-z])\s*\.\s*(?=[a-z]\b|[a-z]\s*\.)/g, '$1');
  base = base.replace(/\bs\s+p\s+a\b/g, 'spa').replace(/\bs\s+r\s+l\b/g, 'srl');

  let tokens = base.split(/[\s\-_.]+/).filter(Boolean);
  const suffixSet = new Set(LEGAL_SUFFIXES);
  tokens = tokens.filter((t) => !suffixSet.has(t));
  tokens = tokens.filter((t) => !NOISE_WORDS.includes(t));
  // Drop lone letters left over from "S.p.A." and friends, but never the first
  // token: "J ACADEMY" must not become "academy", which is somebody else's site.
  tokens = tokens.filter((t, index) => index === 0 || t.length > 1 || /[0-9]/.test(t));
  return tokens.join('');
}

function parseUrl(value) {
  if (!value) return null;
  let raw = String(value).trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!host || !host.includes('.')) return null;
    // A Website that points at a locale — https://www.bulgari.com/it-it/ — is
    // probed at that path: the root of a multi-country site is often a picker
    // that carries no Kleecks markers.
    const path = url.pathname && url.pathname !== '/' ? url.pathname : '/';
    return { host, path };
  } catch (err) {
    return null;
  }
}

function hostFromUrl(value) {
  const parsed = parseUrl(value);
  return parsed ? parsed.host : null;
}

// A host we were given may or may not carry the www prefix; try both — but only
// where www means anything. "us.mcmworldwide.com" is already a third-level host
// naming a region, and "www.us.mcmworldwide.com" is a domain nobody owns: a
// guaranteed DNS failure that only slows the pass down.
function candidatesFor({ host, path }) {
  const suffix = path || '/';
  const list = [`https://${host}${suffix}`];

  if (host.startsWith('www.')) list.push(`https://${host.slice(4)}${suffix}`);
  else if (host.split('.').length === 2) list.push(`https://www.${host}${suffix}`);

  // When a path was given, the root goes in last as a fallback. It is NOT the
  // same page: see checkClient, which will accept "live" from it but never
  // "offline".
  if (suffix !== '/') list.push(`https://${host}/`);
  return list;
}

function normaliseOverrideKey(name) {
  return stripAccents(String(name || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const overrideIndex = new Map();
for (const [key, value] of Object.entries(overrides || {})) {
  if (!key.startsWith('_')) overrideIndex.set(normaliseOverrideKey(key), value);
}

/**
 * @returns {{host: string|null, candidates: string[], source: string}}
 *   source: 'override' | 'deal' | 'account' | 'guess' | 'none'
 */
function resolveDomain({ clientName, dealWebsite, accountWebsite }) {
  const override = overrideIndex.get(normaliseOverrideKey(clientName));

  // "skip" is the one override that still wins outright: it says this client has
  // no site of its own to check, which no CRM field can express.
  if (override === false || override === '' || override === 'skip') {
    return { host: null, candidates: [], source: 'skipped' };
  }

  // The CRM comes first. Whatever is filled in on the deal or on the account —
  // the Final Client's account for an indirect deal — is what gets probed, so a
  // Website typed into Zoho takes effect on the next read.
  const fromDeal = parseUrl(dealWebsite);
  if (fromDeal) return { host: fromDeal.host, candidates: candidatesFor(fromDeal), source: 'deal' };

  const fromAccount = parseUrl(accountWebsite);
  if (fromAccount) return { host: fromAccount.host, candidates: candidatesFor(fromAccount), source: 'account' };

  // Then the manual map, as a safety net for the clients the CRM does not cover
  // yet, ahead of guessing from the name.
  if (override) {
    const parsed = parseUrl(override);
    if (parsed) return { host: parsed.host, candidates: candidatesFor(parsed), source: 'override' };
  }

  const slug = slugFromName(clientName);
  if (slug.length < 3) return { host: null, candidates: [], source: 'none' };

  const tlds = (process.env.GUESS_TLDS || '.com,.it').split(',').map((t) => t.trim()).filter(Boolean);
  const candidates = [];
  for (const tld of tlds) {
    candidates.push(`https://www.${slug}${tld}/`);
    candidates.push(`https://${slug}${tld}/`);
  }
  return { host: `${slug}${tlds[0] || '.com'}`, candidates, source: 'guess' };
}

module.exports = { resolveDomain, slugFromName, hostFromUrl };
