import { h, setChildren, field, toast, confirmDialog, download } from '../dom.js';
import { state, byId, put, remove, putMany, saveSettings, exportAll, importAll, clearAll, newId } from '../store.js';
import { DEFAULT_RULES } from '../domain/rules.js';
import { DEFAULT_REMINDER, formatDate, todayISO, isISODate } from '../domain/due.js';
import { parseCSV, toCSV, importRows } from '../domain/csv.js';
import { verifyLicense, TRIAL_REPORTS } from '../domain/license.js';
import { navigate, rerender, currentEntitlement, refreshLicense } from '../nav.js';
import { backLink } from './shared.js';
import { testsCSV } from './reports.js';
import { loadSampleData } from '../sample.js';
import { CONFIG } from '../config.js';

export function settingsView(section) {
  switch (section) {
    case 'company': return companyView();
    case 'testers': return peopleView();
    case 'gauges': return gaugesView();
    case 'rules': return rulesView();
    case 'reminder': return reminderView();
    case 'data': return dataView();
    case 'licence': return licenceView();
    case 'help': return helpView();
    default: return home();
  }
}

function home() {
  const e = currentEntitlement();
  const co = state.settings.company;
  const item = (href, title, sub) => h('li', null, h('a', { href }, h('span', { class: 'row-main' }, title), h('span', { class: 'row-sub' }, sub)));
  return h('section', null,
    h('h1', null, 'Settings'),
    h('ul', { class: 'rows' },
      item('#/settings/company', 'Company', co.name || 'Name, address and phone printed on reports'),
      item('#/settings/testers', 'Testers', state.testers.length ? state.testers.map((t) => t.name).join(', ') : 'Add a tester and certification'),
      item('#/settings/gauges', 'Test kits', state.gauges.length ? `${state.gauges.length} on file` : 'Add your gauge and its verification date'),
      item('#/settings/rules', 'Pass and fail rules', 'Thresholds your water systems use'),
      item('#/settings/reminder', 'Reminder message', 'What customers get when a test is coming due'),
      item('#/settings/data', 'Your data', state.settings.lastBackup ? `Last backup ${formatDate(state.settings.lastBackup)}` : 'Back up, restore, import and export'),
      item('#/settings/licence', 'Licence', e.mode === 'licensed' ? `Licensed until ${formatDate(e.until)}` : e.mode === 'trial' ? `Free trial, ${e.left} of ${TRIAL_REPORTS} reports left` : 'Enter a licence key')),
    h('ul', { class: 'rows' }, item('#/settings/help', 'How TagDue works', 'A two-minute guide, and how to put it on your home screen')),
    h('p', { class: 'quiet' }, `TagDue ${CONFIG.version}. Your records are stored on this device only.`));
}

function saved(path = '/settings') { toast('Saved'); navigate(path); }

function companyView() {
  const co = { ...state.settings.company };
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Company'),
    h('p', { class: 'quiet' }, 'Printed at the top of every report.'),
    h('form', { onSubmit: async (e) => { e.preventDefault(); state.settings.company = co; await saveSettings('company'); saved(); } },
      field('Company name', co, 'name', { autocomplete: 'organization' }),
      field('Street address', co, 'address', { optional: true }),
      field('City, state and ZIP', co, 'cityStateZip', { optional: true }),
      h('div', { class: 'grid2' },
        field('Phone', co, 'phone', { type: 'tel', optional: true }),
        field('Email', co, 'email', { type: 'email', optional: true })),
      field('Contractor or business licence number', co, 'contractorLicense', { optional: true }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save company')));
}

function listEditor({ title, intro, collection, describe, blank, form, validate, back = '#/settings' }) {
  let editing = null; // record being edited, or a blank for a new one
  const section = h('section');
  const draw = () => {
    setChildren(section, 
      backLink(back, 'Settings'), h('h1', null, title), h('p', { class: 'quiet' }, intro),
      state[collection].length ? h('ul', { class: 'rows' }, state[collection].map((r) => h('li', null, h('button', { class: 'rowbtn', onClick: () => { editing = { ...r }; draw(); } },
        h('span', { class: 'row-main' }, describe(r).main), h('span', { class: 'row-sub' }, describe(r).sub))))) : null,
      editing ? editor() : h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: () => { editing = blank(); draw(); } }, 'Add ' + title.toLowerCase().replace(/s$/, ''))));
  };
  const editor = () => {
    const error = h('p', { class: 'form-error', role: 'alert' });
    const isNew = !editing.id;
    return h('form', {
      class: 'panel',
      onSubmit: async (e) => {
        e.preventDefault();
        const problem = validate(editing);
        if (problem) { error.textContent = problem; return; }
        await put(collection, editing);
        editing = null; toast('Saved'); draw();
      },
    },
    h('h2', null, isNew ? 'New' : 'Edit'),
    form(editing), error,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn ghost', type: 'button', onClick: () => { editing = null; draw(); } }, 'Cancel'),
      !isNew ? h('button', {
        class: 'btn danger ghost', type: 'button',
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Remove this?', body: 'Reports already saved keep their own copy of these details.', confirm: 'Remove', danger: true }))) return;
          await remove(collection, editing.id); editing = null; draw();
        },
      }, 'Remove') : null));
  };
  draw();
  return section;
}

function peopleView() {
  return listEditor({
    title: 'Testers', collection: 'testers',
    intro: 'Each report prints the tester’s name, certification number and expiry. TagDue warns you when a certification has lapsed.',
    describe: (t) => ({ main: t.name, sub: [t.certNo, t.certBody, t.certExpires ? 'expires ' + formatDate(t.certExpires) : ''].filter(Boolean).join(', ') }),
    blank: () => ({ name: '', certNo: '', certBody: '', certExpires: '' }),
    validate: (t) => (!t.name.trim() ? 'Enter the tester’s name.' : t.certExpires && !isISODate(t.certExpires) ? 'The expiry date is not a real date.' : ''),
    form: (t) => [
      field('Name', t, 'name', { autocomplete: 'name' }),
      h('div', { class: 'grid2' },
        field('Certification or licence number', t, 'certNo'),
        field('Issued by', t, 'certBody', { optional: true, placeholder: 'TCEQ, ASSE, ABPA, state health dept.' })),
      field('Certification expires', t, 'certExpires', { type: 'date', optional: true }),
      t.signature ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onChange: (e) => { if (e.currentTarget.checked) t.signature = ''; } }), 'Forget the saved signature') : null,
    ],
  });
}

function gaugesView() {
  return listEditor({
    title: 'Test kits', collection: 'gauges',
    intro: 'Water systems want the test kit’s serial number and the date its accuracy was last verified, usually within the past 12 months.',
    describe: (g) => ({ main: [g.make, g.model].filter(Boolean).join(' ') || 'Test kit', sub: [g.serial ? '#' + g.serial : '', g.verified ? 'verified ' + formatDate(g.verified) : 'no verification date'].filter(Boolean).join(', ') }),
    blank: () => ({ make: '', model: '', serial: '', verified: '' }),
    validate: (g) => (!g.serial.trim() ? 'Enter the serial number.' : g.verified && !isISODate(g.verified) ? 'The verification date is not a real date.' : g.verified > todayISO() ? 'The verification date is in the future.' : ''),
    form: (g) => [
      h('div', { class: 'grid2' }, field('Make', g, 'make', { placeholder: 'Mid-West, Watts, Apollo' }), field('Model', g, 'model')),
      h('div', { class: 'grid2' }, field('Serial number', g, 'serial'), field('Accuracy last verified', g, 'verified', { type: 'date' })),
    ],
  });
}

function rulesView() {
  const r = { ...state.settings.rules };
  r.rpCheck2Numeric = r.rpCheck2Numeric ? 'yes' : 'no';
  const error = h('p', { class: 'form-error', role: 'alert' });
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Pass and fail rules'),
    h('p', null, 'TagDue checks each reading as you type. The defaults are the widely used criteria: an RP relief valve opening at 2.0 psid or more with check 1 at 5.0 psid or more, and 1.0 psid or more for double checks and vacuum breakers. A few points vary between water systems. Set them to match the procedure your certification and your water systems require.'),
    h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        const n = Number(r.intervalMonths), b = Number(r.type2BypassMin);
        if (!(Number.isInteger(n) && n >= 1 && n <= 120)) { error.textContent = 'The test interval must be a whole number of months from 1 to 120.'; return; }
        if (!(b > 0 && b <= 5)) { error.textContent = 'The Type II bypass minimum must be a number such as 1.0 or 0.5.'; return; }
        state.settings.rules = { ...DEFAULT_RULES, rpBuffer: r.rpBuffer, rpCheck2Numeric: r.rpCheck2Numeric === 'yes', type2BypassMin: b, intervalMonths: n };
        await saveSettings('rules'); saved();
      },
    },
    field('RP: buffer between check 1 and the relief valve', r, 'rpBuffer', {
      options: [['off', 'Not required (current USC and AWWA procedure)'], ['warn', 'Note it on the report when under 3.0 psid'], ['fail', 'Fail when under 3.0 psid']],
      hint: 'Older procedures asked for check 1 to read at least 3.0 psid above the relief valve opening point.',
    }),
    field('RP: how check valve 2 is recorded', r, 'rpCheck2Numeric', {
      options: [['no', 'Closed tight or leaked'], ['yes', 'A reading in psid, 1.0 or more to pass']],
      hint: 'Some states, including South Carolina and Florida, record a number.',
    }),
    field('Type II detector assemblies: bypass check minimum (psid)', r, 'type2BypassMin', { inputmode: 'decimal', hint: 'Commonly 1.0. Some ASSE-based programs use 0.5 for a DCDA-II.' }),
    field('Test every (months)', r, 'intervalMonths', { inputmode: 'numeric', hint: 'Yearly is standard. You can set a different interval on a single assembly.' }),
    error,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save rules'),
      h('button', { class: 'btn ghost', type: 'button', onClick: async () => { state.settings.rules = { ...DEFAULT_RULES }; await saveSettings('rules'); toast('Rules reset to the defaults'); rerender(); } }, 'Reset to the defaults'))),
    h('p', { class: 'quiet' }, 'TagDue flags readings; it does not replace your judgment or your water system’s rules. You can always record a different result on a report, with your reason.'));
}

function reminderView() {
  const m = { ...state.settings.reminder };
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Reminder message'),
    h('p', null, 'Sent from your own email or phone when you tap Remind. These words are replaced for each customer: {customer}, {address}, {device}, {due}, {company}, {phone}.'),
    h('form', { onSubmit: async (e) => { e.preventDefault(); state.settings.reminder = m; await saveSettings('reminder'); saved(); } },
      field('Subject', m, 'subject'),
      field('Message', m, 'body', { multiline: true, rows: 12 }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save message'),
        h('button', { class: 'btn ghost', type: 'button', onClick: async () => { state.settings.reminder = { ...DEFAULT_REMINDER }; await saveSettings('reminder'); toast('Message reset'); rerender(); } }, 'Reset to the original'))));
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

function assembliesCSV() {
  const header = ['Customer', 'Contact', 'Email', 'Phone', 'Address', 'City', 'State', 'ZIP', 'Type', 'Manufacturer', 'Model', 'Serial', 'Size', 'Location', 'Serves', 'Hazard', 'Water system', 'Account', 'Installed', 'Last test', 'In service', 'Device address'];
  const rows = [];
  for (const c of state.customers) {
    const list = state.assemblies.filter((a) => a.customerId === c.id);
    const base = [c.name, c.contact, c.email, c.phone, c.address, c.city, c.state, c.zip];
    if (!list.length) { rows.push([...base, ...Array(14).fill('')]); continue; }
    for (const a of list) {
      const tests = state.tests.filter((t) => t.assemblyId === a.id && t.result === 'pass').map((t) => t.date).sort();
      const last = [tests[tests.length - 1], a.lastTestedImported].filter(Boolean).sort().pop() || '';
      rows.push([...base, a.type, a.make, a.model, a.serial, a.size, a.location, a.serves, a.hazard, a.purveyor, a.account, a.installed, last, a.active === false ? 'No' : 'Yes', a.serviceAddress]);
    }
  }
  return toCSV([header, ...rows]);
}

function dataView() {
  const result = h('div', { class: 'stack', role: 'status' });
  const counts = `${state.customers.length} customers, ${state.assemblies.length} assemblies, ${state.tests.length} reports`;

  const backup = async () => {
    download(`tagdue-backup-${todayISO()}.json`, JSON.stringify(exportAll()), 'application/json');
    state.settings.lastBackup = todayISO();
    await saveSettings('lastBackup');
    toast('Backup file saved');
  };
  const restore = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { setChildren(result, h('div', { class: 'notice warn' }, 'That file could not be read. Choose a TagDue backup file ending in .json.')); return; }
    if (!(await confirmDialog({ title: 'Replace everything on this device?', body: `The backup from ${String(data.exportedAt || '').slice(0, 10) || 'an unknown date'} will replace the ${counts} here now.`, confirm: 'Replace with backup', danger: true }))) return;
    // Keep whichever licence key is valid for longest: the one on this device or the one in the backup.
    let keep = state.settings.licenseKey || '';
    try {
      const mine = keep ? await verifyLicense(keep, todayISO()) : { valid: false };
      const theirKey = data && data.settings && typeof data.settings.licenseKey === 'string' ? data.settings.licenseKey : '';
      const theirs = theirKey ? await verifyLicense(theirKey, todayISO()) : { valid: false };
      if (theirs.valid && (!mine.valid || theirs.payload.exp > mine.payload.exp)) keep = theirKey;
      else if (!keep) keep = theirKey;
    } catch (err) { console.warn(err); }
    try { await importAll(data, keep); await refreshLicense(); toast('Backup restored'); navigate('/due'); } catch (err) { setChildren(result, h('div', { class: 'notice warn' }, err.message)); }
  };
  const importCsv = async () => {
    const file = await pickFile('.csv,text/csv');
    if (!file) return;
    const rows = parseCSV(await file.text());
    const out = importRows(rows, newId, { customers: state.customers, assemblies: state.assemblies });
    const notes = out.skipped.length ? h('ul', null, out.skipped.slice(0, 40).map((x) => h('li', null, `Row ${x.row}: ${x.reason}`)), out.skipped.length > 40 ? h('li', null, `and ${out.skipped.length - 40} more`) : null) : null;
    if (!out.customers.length && !out.assemblies.length) {
      setChildren(result, h('div', { class: 'notice warn' },
        out.rowsRead ? `${out.rowsRead} rows were read, but nothing new was found to add. ` : 'That file has no rows. ',
        'The first row must hold column names such as Customer, Address, Type, Serial and Last test date.', notes));
      return;
    }
    const check = out.skipped.length ? ` ${out.skipped.length} ${out.skipped.length === 1 ? 'row needs' : 'rows need'} checking; the list is shown afterwards.` : '';
    if (!(await confirmDialog({ title: 'Add these records?', body: `${out.rowsRead} rows read. ${out.customers.length} new customers and ${out.assemblies.length} new assemblies will be added to what is already here.${check}`, confirm: 'Add them' }))) return;
    await putMany('customers', out.customers);
    await putMany('assemblies', out.assemblies);
    setChildren(result, h('div', { class: 'notice' + (out.skipped.length ? ' warn' : '') },
      h('strong', null, `Added ${out.customers.length} customers and ${out.assemblies.length} assemblies. `),
      out.unmapped.length ? `Columns not used: ${out.unmapped.join(', ')}. ` : '',
      notes));
  };
  const erase = async () => {
    if (!(await confirmDialog({ title: 'Erase everything on this device?', body: `This removes ${counts}, your settings and your licence key from this device. Make a backup first if you may need them.`, confirm: 'Erase everything', danger: true }))) return;
    await clearAll(); await refreshLicense(); toast('Everything erased'); navigate('/due');
  };

  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Your data'),
    h('p', null, `On this device: ${counts}. TagDue keeps your records on this device and does not upload them. That is why it works with no signal, and it is also why a backup matters: if the phone or tablet is lost, so are records that were never backed up.`),
    state.settings.lastBackup ? h('p', { class: 'quiet' }, `Last backup: ${formatDate(state.settings.lastBackup)}.`) : h('div', { class: 'notice warn' }, 'No backup has been made from this device yet.'),
    h('h2', null, 'Back up and restore'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: backup }, 'Save a backup file'), h('button', { class: 'btn', onClick: restore }, 'Restore from a backup')),
    h('p', { class: 'hint' }, 'Keep the backup file somewhere off this device, such as email or cloud storage. Restoring a backup on a second device copies everything across.'),
    h('h2', null, 'Bring in a spreadsheet'),
    h('p', null, 'Save your list as CSV with one assembly per row. TagDue reads columns named Customer, Contact, Email, Phone, Address, City, State, ZIP, Type, Manufacturer, Model, Serial, Size, Location, Water system, Account and Last test date. Records already on file are not added twice.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: importCsv }, 'Import a CSV file')),
    h('h2', null, 'Take your records out'),
    h('p', null, 'Your records are yours. Export them at any time, with or without a licence.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onClick: () => download(`tagdue-customers-assemblies-${todayISO()}.csv`, assembliesCSV(), 'text/csv') }, 'Export customers and assemblies'),
      h('button', { class: 'btn', onClick: () => download(`tagdue-tests-${todayISO()}.csv`, testsCSV(state.tests), 'text/csv') }, 'Export all test reports')),
    result,
    h('h2', null, 'Start over'),
    h('div', { class: 'row' },
      !state.customers.length ? h('button', { class: 'btn', onClick: async () => { await loadSampleData(); toast('Sample records loaded'); navigate('/due'); } }, 'Load sample records') : null,
      h('button', { class: 'btn danger ghost', onClick: erase }, 'Erase everything on this device')));
}

function licenceView() {
  const e = currentEntitlement();
  const draft = { key: state.settings.licenseKey || '' };
  const error = h('p', { class: 'form-error', role: 'alert' });
  const status = e.mode === 'licensed'
    ? h('div', { class: 'notice' }, h('strong', null, 'Licensed'), state.license.payload.name ? ` to ${state.license.payload.name}` : '', ` until ${formatDate(e.until)}.`)
    : e.mode === 'trial'
      ? h('div', { class: 'notice' }, `Free trial: ${e.left} of ${TRIAL_REPORTS} test reports left. Every feature works during the trial.`)
      : h('div', { class: 'notice warn' }, e.mode === 'expired' ? `Your licence ended on ${formatDate(state.license.payload.exp)}. ` : 'The free trial is used up. ', 'Saved records stay available and exportable.');
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'Licence'),
    status,
    h('p', null, `${CONFIG.priceLine} One key covers every tester in the shop. There is no charge per report and no contract.`),
    CONFIG.purchaseUrl ? h('div', { class: 'row' }, h('a', { class: 'btn primary', href: CONFIG.purchaseUrl, target: '_blank', rel: 'noopener' }, 'Buy a licence')) : null,
    CONFIG.supportEmail ? h('p', { class: 'quiet' }, 'Questions: ', h('a', { href: `mailto:${CONFIG.supportEmail}` }, CONFIG.supportEmail)) : null,
    h('form', {
      onSubmit: async (ev) => {
        ev.preventDefault();
        error.textContent = '';
        const key = draft.key.trim();
        if (!key) {
          if (!state.settings.licenseKey) return;
          if (!(await confirmDialog({ title: 'Remove the licence key from this device?', body: 'Keep a copy of the key first. Without it, new reports stop once the free trial is used up.', confirm: 'Remove key', danger: true }))) return;
          state.settings.licenseKey = ''; await saveSettings('licenseKey'); await refreshLicense(); rerender(); return;
        }
        if (!(globalThis.crypto && crypto.subtle)) { error.textContent = 'This browser cannot check licence keys here. Open TagDue from its https address and try again.'; return; }
        const res = await verifyLicense(key, todayISO());
        if (!res.valid) { error.textContent = res.reason; return; }
        state.settings.licenseKey = key; await saveSettings('licenseKey'); await refreshLicense();
        toast('Licence key accepted'); rerender();
      },
    },
    field('Licence key', draft, 'key', { multiline: true, rows: 4, placeholder: 'TD1…' }),
    error,
    h('button', { class: 'btn primary', type: 'submit' }, 'Save licence key')));
}

function helpView() {
  const step = (title, text) => h('li', null, h('strong', null, title), h('br'), text);
  return h('section', null, backLink('#/settings', 'Settings'), h('h1', null, 'How TagDue works'),
    h('ol', { class: 'steps' },
      step('Set up once.', 'Add your company, each tester’s certification and your test kit under Settings. They print on every report.'),
      step('Add your customers and assemblies.', 'Type them in, or import the spreadsheet you already keep under Settings, Your data. Give each assembly its last test date and TagDue works out when it is next due.'),
      step('On site, open the assembly and start a test.', 'Type each reading. TagDue says straight away whether it passes and why. If it fails and you fix it, tick the repair box and enter the retest on the same report.'),
      step('Sign and save.', 'Share or download the PDF for the customer and the water system. If the city uses an online portal, use "Copy values for a portal" and paste them in.'),
      step('Mark it filed.', 'Record the date and any confirmation number on the report. The Reports screen shows what has not been filed yet.'),
      step('Next year, the Due screen tells you who to call.', 'Tap Remind to send the customer a message from your own email or phone.')),
    h('h2', null, 'Put it on your home screen'),
    h('p', null, 'On an iPhone or iPad, open TagDue in Safari, tap Share, then "Add to Home Screen". On Android, open it in Chrome, tap the menu, then "Install app" or "Add to Home screen". It then opens like any other app and works with no signal.'),
    h('h2', null, 'Keep a backup'),
    h('p', null, 'Your records live on this device only. Once a week, go to Settings, Your data, and save a backup file somewhere off the device. To move to a new phone, restore that file on it.'),
    h('h2', null, 'Your judgment comes first'),
    h('p', null, 'TagDue checks readings against published field-test criteria and the rules you choose in Settings. It does not replace your certification, your procedure or what your water system requires. You can always set the result yourself; the report then says so and gives your reason.'));
}
