// The Zoho data centres. The setup page only ever talks to one of these hosts,
// so a forged payload cannot turn the token exchange into an open relay.

const DATA_CENTRES = {
  eu: {
    label: 'Europe (.eu)',
    console: 'https://api-console.zoho.eu',
    accounts: 'https://accounts.zoho.eu',
    api: 'https://www.zohoapis.eu',
    crm: 'https://crm.zoho.eu'
  },
  com: {
    label: 'United States (.com)',
    console: 'https://api-console.zoho.com',
    accounts: 'https://accounts.zoho.com',
    api: 'https://www.zohoapis.com',
    crm: 'https://crm.zoho.com'
  },
  in: {
    label: 'India (.in)',
    console: 'https://api-console.zoho.in',
    accounts: 'https://accounts.zoho.in',
    api: 'https://www.zohoapis.in',
    crm: 'https://crm.zoho.in'
  },
  'com.au': {
    label: 'Australia (.com.au)',
    console: 'https://api-console.zoho.com.au',
    accounts: 'https://accounts.zoho.com.au',
    api: 'https://www.zohoapis.com.au',
    crm: 'https://crm.zoho.com.au'
  },
  jp: {
    label: 'Japan (.jp)',
    console: 'https://api-console.zoho.jp',
    accounts: 'https://accounts.zoho.jp',
    api: 'https://www.zohoapis.jp',
    crm: 'https://crm.zoho.jp'
  },
  ca: {
    label: 'Canada (.ca)',
    console: 'https://api-console.zohocloud.ca',
    accounts: 'https://accounts.zohocloud.ca',
    api: 'https://www.zohoapis.ca',
    crm: 'https://crm.zohocloud.ca'
  }
};

const SCOPES = ['ZohoCRM.coql.READ', 'ZohoCRM.modules.deals.READ', 'ZohoCRM.users.READ'];

// Zoho wants them comma separated on a single line: one per line is read as a
// single malformed scope and comes back as "invalid scope".
const SCOPE_STRING = SCOPES.join(',');

function dataCentre(key) {
  return DATA_CENTRES[key] || DATA_CENTRES.eu;
}

module.exports = { DATA_CENTRES, SCOPES, SCOPE_STRING, dataCentre };
