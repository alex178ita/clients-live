# Won Clients & Kleecks Live Status

Next.js app for Vercel, meant to sit in a Zoho CRM Web Tab like the other Kleecks
dashboards. It lists every won client (licence deals only) and, for each of them,
checks the client's home page to see whether Kleecks is still serving it.

## What the table shows

One row per client, built from the won licence deals (`Licence > 0`,
stage `8. Client Won`). Clients whose licence is flagged as lost stay in the list.

| Column | Source |
| --- | --- |
| ▲ alert | licence flagged lost **and** Kleecks still detected live on the site |
| Client | Final Client when the deal is indirect, otherwise the CRM account. Green when live, red when offline, amber when the page could not be read. The name links to the last licence deal in the CRM |
| Status | `live` / `offline` / `n/d` — hover for the signals found, or the reason |
| Channel | Indirect when *Contract & Invoicing Holder* = `Partner`, otherwise Direct |
| Partner | the CRM account of the deal, when indirect (Jakala, Cerved, Neen, FGMC, Execus …) |
| Owner | deal owner of the last licence deal |
| Licence start / end | from the **last** licence deal, i.e. the most recent renewal |
| Closing date | closing date of that same deal |
| Amount | amount of the last licence deal |
| Total won | sum of every won licence deal of the client |
| Deals | how many won licence deals the client has |
| Licence lost | `Licence Lost?` on the last licence deal |
| Domain checked | the page that was probed. No badge means it came from the CRM; `guessed` and `map` mark the clients whose Website is still missing in Zoho |

Delivery-only deals (`Delivery > 0`, `Licence = 0`) are deliberately out of scope.

Everything is sortable (click a header), filterable (search, licence year range,
channel, status, licence lost, how the domain was resolved) and exportable to
Excel — the export contains exactly the rows you are looking at, in the order you
sorted them, with the same colours.

## How "live" is decided

The server fetches the client's home page with a desktop Chrome user agent and
looks for two independent signals; either one is enough:

1. **Response headers** — `x-optimized-by: Kleecks (https://www.kleecks.com)`, or
   the `kleecks-debug` header.
2. **`<body>` classes** — the `KL-*` families (`KL-D-…`, `KL-LANG-…`, `KL-UA-…`,
   `KL-URL-…`, `KL-CMS_URL-LEVEL-…`) and `sp-HOME`.

The class suffixes change from site to site (`KL-D-1` on conte.it, `KL-D-64`
elsewhere), so the families are matched by prefix rather than as fixed strings.

Three states rather than two: a page that loads without any marker is **offline**
(red), but a page we could not read at all — timeout, bot protection, no domain
resolved — is **n/d** (amber), with the reason printed under the pill. That way a
client behind a WAF is never reported as having dropped Kleecks, and the ▲ alert
cannot fire on a false negative.

**The limit worth knowing.** The probe runs server-side from a Vercel IP, and the
bot protection in front of the luxury sites (Akamai, Cloudflare) often refuses
those: the request is answered `403` before it ever reaches Kleecks, and the row
reads `n/d — blocked`. The headers sent are as close to a real Chrome as a
server-side fetch can get, which helps but does not always win. Bulgari, checked
by hand from a normal connection, answers `200` with
`x-optimized-by: Kleecks` — so `n/d — blocked` says nothing about the client, only
that we could not look from there.

If a site only carries the markers on a locale path, put that full URL in the CRM
Website — `https://www.bulgari.com/it-it/` — and the probe uses the path, falling
back to the root.

Results are cached server-side for `LIVE_TTL_MINUTES` (3 hours by default), so the
first visit pays for the probes and the ones after are instant. **Re-check now**
forces a fresh pass.

## Domains

Resolution order, first hit wins:

1. `Website URL` on a won licence deal
2. `Website` on the CRM account — for an indirect deal that is the **Final
   Client's** account, not the partner's: Boggi's own account, not Jakala's
3. `config/domain-overrides.json` — the fallback map, for clients the CRM does
   not cover yet
4. a domain guessed from the client name (legal suffixes stripped, `.com` then
   `.it`, with and without `www.`)

The CRM is the source of truth, so a Website typed into Zoho takes effect on the
next read. The map is only a safety net: it fills the gap where both CRM fields
are empty, and its entries were proposed rather than verified, so fixing the CRM
is always the better move.

```json
"NOVE25 SRL": "https://www.nove25.net/"
```

Keys are matched ignoring case, spaces and punctuation. `"skip"` is the one
value that wins over the CRM: it leaves a client out of the live check entirely,
for holdings and partners with no site of their own.

Filter the table by **Domain from** to see where each domain came from —
*Guessed from name* is the list still needing attention, *Fallback map* the ones
running on an unverified entry.

## Deployment

1. Push this folder to GitHub, connect the repo to a Vercel project in the
   **Kleecks BI** team.
2. Set `APP_PASSWORD`, deploy, then use the `/setup` page below to produce the
   Zoho variables. The rest of `.env.example` is optional tuning.
3. Add the deployment URL as a Web Tab in Zoho CRM. `next.config.js` already
   allows the Zoho domains as frame ancestors; add yours there if it differs.

### Zoho OAuth: the `/setup` page

The deployment carries a guided page at **`/setup`** that turns a Self Client
grant code into the permanent refresh token and then checks it against the CRM,
so none of this has to happen at a terminal. It is behind the same
`APP_PASSWORD`, which is therefore the one variable to set by hand first.

1. Set `APP_PASSWORD` in the Vercel variables and deploy, then open
   `https://<your-deployment>/setup`.
2. Pick the data centre the CRM lives in. The page then links to the right API
   console and shows the exact scope string to copy.
3. In the console: **Add Client → Self Client → Create**, sign in as a user who
   can see every deal. Copy the Client ID and Client Secret from the *Client
   Secret* tab.
4. **Generate Code** tab, paste the scope string the page gave you, 10 minutes,
   **Create** → pick the CRM portal → **Create**, copy the code.
5. Paste Client ID, Client Secret and code into the page and press **Get the
   refresh token**. A Zoho error comes back translated: an expired or reused
   code, a client from another data centre, malformed scopes.
6. The page prints the whole block of Vercel variables ready to copy, then
   **Test the connection** runs the dashboard's own queries with those
   credentials and reports how many won licence deals that user can actually see
   — a restricted profile returns fewer rows rather than an error, and this is
   where you catch it.
7. Paste the block into Vercel (Production, Preview and Development) and
   redeploy.

Nothing typed on that page is stored server-side; the values are returned to the
browser and forgotten. The refresh token itself never expires unless it is
revoked, or unless more than 20 are issued for the same client and user, which
quietly drops the oldest — so keep the one that works rather than regenerating
for a retry.

The three scopes are read-only: the app never writes to the CRM.

<details>
<summary>The same thing by hand, if you prefer curl</summary>

```bash
curl -X POST "https://accounts.zoho.eu/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=THE_CODE"
```

Scope string for the Generate Code tab, on one line:

```
ZohoCRM.coql.READ,ZohoCRM.modules.deals.READ,ZohoCRM.users.READ
```
</details>

After changing `ZOHO_REFRESH_TOKEN` on Vercel, redeploy and give it a few
minutes: warm functions keep the old access token in memory for up to an hour and
Zoho answers `INVALID_OAUTHTOKEN` in the meantime.

### When the dashboard says `invalid_code`

That error comes from the refresh grant, so the problem is the saved
`ZOHO_REFRESH_TOKEN`, not the setup page. Press **Check the saved connection**
at the top of `/setup`: it retries the saved variables, reports what Zoho
refused, shows each value's length and prefix (never the value), and — because a
token issued in one data centre answers `invalid_code` in every other one —
retries the token against all the Zoho data centres and names the one that
accepts it, with the corrected variables ready to copy.

The usual causes, in order:

1. **The grant code was saved instead of the refresh token.** They look nearly
   identical, both `1000.…`, but the code works once and expires in minutes.
2. **A stray newline or space** on the pasted value. The app trims the variables
   now, and the diagnosis flags it.
3. **Data centre mismatch** — token from `.com`, `ZOHO_ACCOUNTS_HOST` on `.eu`.
4. **Client ID/secret from a different Self Client** than the one that issued the
   token. A refresh token only works with the client that created it.
5. The token was revoked, or more than 20 were issued for that client and user,
   which drops the oldest silently.

## Local development

```bash
npm install
cp .env.example .env.local   # fill it in
npm run dev
```
