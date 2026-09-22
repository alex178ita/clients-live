// Build one row per won client out of the won licence deals.
//
// Rules agreed with Alex:
//  - only deals with Licence > 0 count (Delivery-only deals are ignored here)
//  - a deal is indirect when Contract & Invoicing Holder = "Partner": the CRM
//    account is then the partner and Final Client is the client we show
//  - licence start / end / closing date / amount come from the LAST licence deal
//    (the most recent renewal), and so does the "Licence Lost?" flag
//  - clients stay in the list even when the licence is lost

const { coqlAll } = require('./zoho');
const { resolveDomain } = require('./domains');
const { getUserMap } = require('./users');

const WON_STAGE = process.env.WON_STAGE || '8. Client Won';

const DEAL_FIELDS = [
  'id',
  'Deal_Name',
  'Stage',
  'Contact_Holder',
  'Final_Client.id',
  'Final_Client.Account_Name',
  'Final_Client.Website',
  'Account_Name.id',
  'Account_Name.Account_Name',
  'Account_Name.Website',
  'Licence',
  'Delivery',
  'Amount',
  'Licence_Lost',
  'Licence_Lost_Date_Hidden',
  'Licence_Start_Date',
  'Licence_End_Date',
  'Closing_Date',
  'Website_URL',
  'Owner',
  'Customer_Success_Manager',
  'Licence_Modules'
].join(', ');

function buildQuery() {
  return (
    `select ${DEAL_FIELDS} from Deals ` +
    `where Licence > 0 and Stage = '${WON_STAGE}' ` +
    `order by id asc`
  );
}

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function ownerName(owner, userMap) {
  if (!owner) return null;
  if (typeof owner === 'string') return owner;
  const fromMap = owner.id && userMap ? userMap.get(String(owner.id)) : null;
  return owner.name || owner.full_name || fromMap || null;
}

function isLaterLicence(candidate, current) {
  if (!current) return true;
  const a = candidate.licenceEnd || candidate.closingDate || '';
  const b = current.licenceEnd || current.closingDate || '';
  if (a !== b) return a > b;
  return String(candidate.dealId) > String(current.dealId);
}

async function fetchWonClients() {
  const [deals, userMap] = await Promise.all([coqlAll(buildQuery), getUserMap()]);
  const byClient = new Map();

  for (const raw of deals) {
    const indirect = raw.Contact_Holder === 'Partner';
    const finalClientId = raw['Final_Client.id'];
    const finalClientName = raw['Final_Client.Account_Name'];
    const useFinalClient = indirect && finalClientName;

    const clientId = useFinalClient ? finalClientId : raw['Account_Name.id'];
    const clientName = useFinalClient ? finalClientName : raw['Account_Name.Account_Name'];
    if (!clientName) continue;

    const key = String(clientId || clientName);

    const deal = {
      dealId: raw.id,
      dealName: raw.Deal_Name,
      licence: Number(raw.Licence || 0),
      delivery: Number(raw.Delivery || 0),
      amount: Number(raw.Amount || 0),
      licenceStart: toDateOnly(raw.Licence_Start_Date),
      licenceEnd: toDateOnly(raw.Licence_End_Date),
      closingDate: toDateOnly(raw.Closing_Date),
      licenceLost: Boolean(raw.Licence_Lost),
      licenceLostDate: toDateOnly(raw.Licence_Lost_Date_Hidden),
      owner: ownerName(raw.Owner, userMap),
      csm: ownerName(raw.Customer_Success_Manager, userMap),
      modules: raw.Licence_Modules || null,
      websiteUrl: raw.Website_URL || null,
      // Some partner deals carry the partner itself as Final Client; that is a
      // direct deal in everything but the flag, so no partner is shown.
      partner:
        indirect && raw['Account_Name.Account_Name'] !== clientName
          ? raw['Account_Name.Account_Name']
          : null
    };

    let entry = byClient.get(key);
    if (!entry) {
      entry = {
        key,
        clientId: clientId || null,
        clientName,
        accountWebsite: useFinalClient ? raw['Final_Client.Website'] : raw['Account_Name.Website'],
        deals: [],
        last: null
      };
      byClient.set(key, entry);
    }

    if (!entry.accountWebsite) {
      entry.accountWebsite = useFinalClient ? raw['Final_Client.Website'] : raw['Account_Name.Website'];
    }
    entry.deals.push(deal);
    if (isLaterLicence(deal, entry.last)) entry.last = deal;
  }

  const rows = [];
  for (const entry of byClient.values()) {
    const last = entry.last;
    const dealWebsite = entry.deals
      .slice()
      .sort((a, b) => String(b.dealId).localeCompare(String(a.dealId)))
      .map((d) => d.websiteUrl)
      .find(Boolean);

    const domain = resolveDomain({
      clientName: entry.clientName,
      dealWebsite,
      accountWebsite: entry.accountWebsite
    });

    const anyLost = entry.deals.some((d) => d.licenceLost);

    rows.push({
      key: entry.key,
      clientId: entry.clientId,
      clientName: entry.clientName,
      channel: last.partner ? 'Indirect' : 'Direct',
      partner: last.partner,
      partners: Array.from(new Set(entry.deals.map((d) => d.partner).filter(Boolean))),
      owner: last.owner,
      csm: last.csm,
      licenceStart: last.licenceStart,
      licenceEnd: last.licenceEnd,
      closingDate: last.closingDate,
      amount: last.amount,
      licenceAmount: last.licence,
      totalWonAmount: entry.deals.reduce((sum, d) => sum + (d.amount || 0), 0),
      licenceDeals: entry.deals.length,
      lost: Boolean(last.licenceLost),
      lostEver: anyLost,
      lostDate: last.licenceLostDate,
      modules: last.modules,
      lastDealId: last.dealId,
      lastDealName: last.dealName,
      domain: domain.host,
      domainSource: domain.source,
      probeCandidates: domain.candidates
    });
  }

  rows.sort((a, b) => a.clientName.localeCompare(b.clientName, 'en'));
  return rows;
}

module.exports = { fetchWonClients };
