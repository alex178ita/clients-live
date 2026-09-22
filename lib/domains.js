// Resolve the homepage to probe for each client.
//
// Priority: manual override  >  Website URL on a won licence deal  >
//           Website on the CRM account  >  domain guessed from the client name.

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
  tokens = tokens.filter((t) => t.length > 1 || /[0-9]/.test(t));
  return tokens.join('');
}

function hostFromUrl(value) {
  if (!value) return null;
  let raw = String(value).trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!host || !host.includes('.')) return null;
    return host;
  } catch (err) {
    return null;
  }
}

// A host we were given may or may not carry the www prefix; try both.
function candidatesForHost(host) {
  const list = [`https://${host}/`];
  if (host.startsWith('www.')) list.push(`https://${host.slice(4)}/`);
  else list.push(`https://www.${host}/`);
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
  if (override) {
    if (override === false || override === '' || override === 'skip') {
      return { host: null, candidates: [], source: 'skipped' };
    }
    const host = hostFromUrl(override);
    if (host) return { host, candidates: candidatesForHost(host), source: 'override' };
  }

  const fromDeal = hostFromUrl(dealWebsite);
  if (fromDeal) return { host: fromDeal, candidates: candidatesForHost(fromDeal), source: 'deal' };

  const fromAccount = hostFromUrl(accountWebsite);
  if (fromAccount) return { host: fromAccount, candidates: candidatesForHost(fromAccount), source: 'account' };

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
