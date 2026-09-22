// COQL returns an owner as { id, name } and "name" is sometimes empty, so the
// user list is read once and cached to fill in the missing names.

const { getAccessToken, API_HOST } = require('./zoho');

let cache = null; // { at, map }
const TTL_MS = 6 * 60 * 60 * 1000;

async function getUserMap() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;

  const map = new Map();
  try {
    const token = await getAccessToken();
    const res = await fetch(`${API_HOST}/crm/v7/users?type=AllUsers&per_page=200`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` }
    });
    if (res.ok) {
      const json = await res.json();
      for (const user of json.users || []) {
        const name = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
        if (user.id && name) map.set(String(user.id), name);
      }
    }
  } catch (error) {
    // Names are cosmetic: if the call fails we keep whatever COQL gave us.
  }

  cache = { at: Date.now(), map };
  return map;
}

module.exports = { getUserMap };
