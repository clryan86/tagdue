// CSV reading and writing (RFC 4180), plus the customer/assembly import mapping.

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true; // a quote only opens a field at its start, so 2" stays a size
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

export function toCSV(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection in exported data.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const ALIASES = {
  customer: ['customer', 'customer name', 'name', 'account name', 'owner', 'business', 'business name', 'facility', 'facility name', 'premise name'],
  contact: ['contact', 'contact name', 'contact person', 'attention'],
  email: ['email', 'e-mail', 'customer email', 'contact email'],
  phone: ['phone', 'telephone', 'customer phone', 'contact phone', 'phone number'],
  address: ['address', 'service address', 'street', 'street address', 'site address', 'address of service', 'premise address'],
  city: ['city', 'town'],
  state: ['state', 'st'],
  zip: ['zip', 'zip code', 'postal code', 'zipcode'],
  type: ['type', 'assembly type', 'device type', 'bpa type', 'backflow type'],
  make: ['make', 'manufacturer', 'mfr', 'brand'],
  model: ['model', 'model number', 'model #'],
  serial: ['serial', 'serial number', 'serial #', 'serial no', 'serial no.'],
  size: ['size', 'assembly size', 'device size'],
  location: ['location', 'assembly location', 'device location', 'physical location', 'bpa location'],
  serves: ['serves', 'service type', 'bpa serves', 'system serviced', 'type of service', 'use'],
  hazard: ['hazard', 'hazard type', 'hazard level'],
  purveyor: ['water system', 'purveyor', 'water provider', 'utility', 'pws name', 'water district'],
  account: ['account', 'account number', 'account #', 'account no', 'water account', 'customer no'],
  lastTested: ['last test', 'last tested', 'last test date', 'test date', 'date tested', 'last tested date'],
  installed: ['installed', 'install date', 'installation date'],
  inService: ['in service', 'active', 'status'],
  serviceAddress: ['device address', 'assembly address'],
};

const TYPE_MAP = [
  [/^(rpda|rpdz)\W*(ii|2)\b|reduced pressure.*detector.*type\W*(ii|2)\b/i, 'RPDA-II'],
  [/^(dcda)\W*(ii|2)\b|double check.*detector.*type\W*(ii|2)\b/i, 'DCDA-II'],
  [/rpda|rpdz|rp detector|reduced pressure.*detector/i, 'RPDA'],
  [/dcda|double check.*detector/i, 'DCDA'],
  [/^(rp|rpz|rpza|rpa|rpba|rppa)$|reduced pressure/i, 'RP'],
  [/^(dc|dcv|dcva|dca)$|double check/i, 'DC'],
  [/svb|srvb|srpvb|spill/i, 'SVB'],
  [/pvb|pvba|pressure vacuum/i, 'PVB'],
];

export function normaliseType(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  for (const [re, code] of TYPE_MAP) if (re.test(s)) return code;
  return '';
}

/** Accepts YYYY-MM-DD, M/D/YYYY, M/D/YY and M-D-YYYY, each optionally followed by a time. Returns ISO or ''. */
export function normaliseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:\s+\d.*)?$/);
    if (!m) return '';
    mo = +m[1]; d = +m[2]; y = +m[3];
    // Two-digit years are read as 20xx. One that lands in the future is then caught as a mistake
    // by the caller, instead of quietly becoming a date a century ago.
    if (y < 100) y += 2000;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const key = String(h).trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [field, names] of Object.entries(ALIASES)) {
      if (map[field] === undefined && names.includes(key)) map[field] = idx;
    }
  });
  return map;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Turn a spreadsheet of assemblies (one row per device) into customers and assemblies.
 * Rows sharing a customer name and address become one customer. Customers and
 * assemblies already on file (same name and address; same serial and make) are
 * reused or skipped rather than duplicated.
 * @param existing {customers, assemblies} already stored
 * @returns {{customers, assemblies, skipped: Array<{row:number, reason:string}>, unmapped: string[], rowsRead: number}}
 *   `skipped` holds every row that was left out or needs checking.
 */
export function importRows(rows, makeId, existing = { customers: [], assemblies: [] }, today = localToday()) {
  if (!rows.length) return { customers: [], assemblies: [], skipped: [], unmapped: [], rowsRead: 0 };
  const map = mapHeaders(rows[0]);
  const mappedIdx = new Set(Object.values(map));
  const unmapped = rows[0].filter((_, i) => !mappedIdx.has(i)).map((h) => String(h).trim()).filter(Boolean);
  // Spreadsheets (and our own export) put an apostrophe before values that look like formulas.
  const get = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] ?? '').trim().replace(/^'(?=[=+\-@])/, ''));
  const customers = [];
  const assemblies = [];
  const skipped = [];
  const rowsRead = rows.length - 1;
  if (map.customer === undefined) {
    return { customers, assemblies, skipped: [{ row: 1, reason: 'No "Customer" or "Name" column found' }], unmapped, rowsRead };
  }
  const keyOf = (name, address) => (name + '|' + address).toLowerCase().replace(/\s+/g, ' ');
  const byKey = new Map();
  for (const c of existing.customers || []) byKey.set(keyOf(c.name || '', c.address || ''), c);
  const deviceKey = (customerId, make, serial) => [customerId, (make || '').toLowerCase(), (serial || '').toLowerCase()].join('|');
  const known = new Set((existing.assemblies || []).filter((a) => a.serial).map((a) => deviceKey(a.customerId, a.make, a.serial)));

  const dateField = (r, f, label, i) => {
    const raw = get(r, f);
    if (!raw) return '';
    const iso = normaliseDate(raw);
    if (!iso) { skipped.push({ row: i + 1, reason: `${label} "${raw}" was not understood and was left blank. Use a form like 10/20/2025.` }); return ''; }
    if (iso > today) { skipped.push({ row: i + 1, reason: `${label} "${raw}" is in the future and was left blank.` }); return ''; }
    return iso;
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = get(r, 'customer');
    if (!name) { skipped.push({ row: i + 1, reason: 'No customer name, row left out' }); continue; }
    const address = get(r, 'address');
    const key = keyOf(name, address);
    let c = byKey.get(key);
    if (!c) {
      let email = get(r, 'email');
      if (email && !/^[^\s@?&,;]+@[^\s@?&,;]+\.[^\s@?&,;]+$/.test(email)) {
        skipped.push({ row: i + 1, reason: `Email "${email}" does not look right and was left blank.` });
        email = '';
      }
      c = {
        id: makeId(), name, contact: get(r, 'contact'), email, phone: get(r, 'phone'),
        address, city: get(r, 'city'), state: get(r, 'state'), zip: get(r, 'zip'), notes: '',
      };
      byKey.set(key, c);
      customers.push(c);
    }
    const hasDevice = ['type', 'make', 'model', 'serial', 'size', 'location'].some((f) => get(r, f));
    if (!hasDevice) continue;
    const make = get(r, 'make');
    const serial = get(r, 'serial');
    if (serial && known.has(deviceKey(c.id, make, serial))) {
      skipped.push({ row: i + 1, reason: `${make} #${serial} is already on file for ${name}, row left out`.trim() });
      continue;
    }
    if (serial) known.add(deviceKey(c.id, make, serial));
    const rawType = get(r, 'type');
    const type = normaliseType(rawType);
    if (!type) skipped.push({ row: i + 1, reason: rawType ? `Assembly type "${rawType}" was not recognised and was saved as RP. Check it.` : 'No assembly type given, saved as RP. Check it.' });
    const inService = get(r, 'inService').toLowerCase();
    assemblies.push({
      id: makeId(), customerId: c.id, type: type || 'RP',
      make, model: get(r, 'model'), serial, size: get(r, 'size'),
      location: get(r, 'location'), serves: get(r, 'serves'), hazard: get(r, 'hazard'),
      purveyor: get(r, 'purveyor'), account: get(r, 'account'),
      serviceAddress: get(r, 'serviceAddress'),
      installed: dateField(r, 'installed', 'Install date', i),
      lastTestedImported: dateField(r, 'lastTested', 'Last test date', i),
      active: !['no', 'n', 'false', 'removed', 'inactive'].includes(inService),
    });
  }
  return { customers, assemblies, skipped, unmapped, rowsRead };
}
