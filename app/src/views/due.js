import { h, sheet, toast } from '../dom.js';
import { state, byId, put } from '../store.js';
import { compareStanding, formatDate, fillTemplate, todayISO } from '../domain/due.js';
import { navigate, rerender, currentEntitlement } from '../nav.js';
import { tagCard, assemblyStanding, customerAddress, deviceLine, emptyState } from './shared.js';
import { loadSampleData } from '../sample.js';

let filter = 'attention';
let query = '';

export function dueView() {
  const rows = state.assemblies.filter((a) => a.active !== false).map((a) => ({ a, s: assemblyStanding(a) }));
  rows.sort((x, y) => compareStanding(x.s, y.s));

  if (!state.customers.length) {
    return h('section', null,
      h('h1', null, 'Nothing is due yet'),
      emptyState('Start with your first customer',
        'Add a customer and their assembly, or bring in the spreadsheet you already keep. TagDue then tells you what is due and when.',
        h('a', { class: 'btn primary', href: '#/customer/new' }, 'Add a customer'),
        h('a', { class: 'btn', href: '#/settings/data' }, 'Import a spreadsheet'),
        h('button', { class: 'btn ghost', onClick: async () => { await loadSampleData(); toast('Sample records loaded'); rerender(); } }, 'Look around with sample records')));
  }

  const count = (st) => rows.filter((r) => r.s.status === st).length;
  const counts = { failed: count('failed'), overdue: count('overdue'), soon: count('soon'), upcoming: count('upcoming'), untested: count('untested'), ok: count('ok') };
  const chips = [
    ['attention', 'Needs attention', counts.failed + counts.overdue + counts.soon],
    ['failed', 'Failed', counts.failed],
    ['overdue', 'Overdue', counts.overdue],
    ['soon', 'Next 30 days', counts.soon],
    ['upcoming', '31 to 60 days', counts.upcoming],
    ['untested', 'No test yet', counts.untested],
    ['all', 'All', rows.length],
  ];
  const inFilter = (r) => {
    if (filter === 'all') return true;
    if (filter === 'attention') return ['failed', 'overdue', 'soon'].includes(r.s.status);
    return r.s.status === filter;
  };
  const q = query.trim().toLowerCase();
  const matches = (r) => {
    if (!q) return true;
    const c = byId('customers', r.a.customerId);
    return [c?.name, c?.address, c?.city, r.a.serviceAddress, r.a.serial, r.a.location, r.a.make].some((v) => v && v.toLowerCase().includes(q));
  };
  const shown = rows.filter((r) => inFilter(r) && matches(r));

  const list = h('ul', { class: 'tags' }, shown.map(({ a, s }) => tagCard(a, s, {
    href: `#/assembly/${a.id}`,
    actions: [
      h('a', { class: 'btn primary small', href: `#/test/new/${a.id}` }, s.status === 'failed' ? 'Retest' : 'Start test'),
      s.status !== 'untested' && s.status !== 'failed' ? h('button', { class: 'btn small', onClick: () => remind(a, s) }, a.remindedOn ? 'Remind again' : 'Remind') : null,
    ],
  })));

  const search = h('input', { type: 'search', placeholder: 'Search name, address or serial', 'aria-label': 'Search what is due', value: query });
  search.addEventListener('input', () => {
    query = search.value;
    const pos = search.selectionStart;
    rerender();
    const again = document.querySelector('.searchbar input');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });

  return h('section', null,
    setupNudge(),
    trialNote(),
    h('h1', null, 'What is due'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' }, chips.map(([id, label, n]) =>
      h('button', { class: 'chip' + (filter === id ? ' on' : '') + (['failed', 'overdue'].includes(id) && n ? ' alert' : ''), 'aria-pressed': String(filter === id), onClick: () => { filter = id; rerender(); } },
        label, ' ', h('b', null, n)))),
    h('div', { class: 'searchbar' }, search),
    shown.length ? list : h('p', { class: 'quiet' }, q ? 'No assemblies match that search.' : filter === 'attention' ? 'Nothing needs attention right now. Everything is tested and current.' : 'Nothing in this group.'));
}

function setupNudge() {
  const missing = [];
  if (!state.settings.company.name) missing.push(['your company details', '#/settings/company']);
  if (!state.testers.length) missing.push(['a tester and certification', '#/settings/testers']);
  if (!state.gauges.length) missing.push(['your test kit', '#/settings/gauges']);
  if (!missing.length) return null;
  return h('div', { class: 'notice' },
    h('strong', null, 'Finish setting up. '),
    'Reports need ',
    missing.map(([label, href], i) => [i ? (i === missing.length - 1 ? ' and ' : ', ') : '', h('a', { href }, label)]),
    '.');
}

function trialNote() {
  const e = currentEntitlement();
  if (e.mode === 'licensed') return null;
  if (e.mode === 'trial') {
    if (e.left > 5) return null;
    return h('div', { class: 'notice' }, `Free trial: ${e.left} test ${e.left === 1 ? 'report' : 'reports'} left. `, h('a', { href: '#/settings/licence' }, 'Enter a licence key'));
  }
  return h('div', { class: 'notice warn' },
    e.mode === 'expired' ? 'Your licence has ended. ' : 'The free trial is used up. ',
    'Your records stay available and you can still export them. ',
    h('a', { href: '#/settings/licence' }, 'Enter a licence key'), ' to create new reports.');
}

function remind(a, s) {
  const c = byId('customers', a.customerId) || {};
  const co = state.settings.company;
  const values = {
    customer: c.contact || c.name || '',
    address: customerAddress(c, a),
    device: deviceLine(a),
    due: formatDate(s.due),
    company: co.name || '',
    phone: co.phone || '',
  };
  const draft = {
    subject: fillTemplate(state.settings.reminder.subject, values),
    body: fillTemplate(state.settings.reminder.body, values),
  };
  const subject = h('input', { type: 'text', value: draft.subject, 'aria-label': 'Subject' });
  const body = h('textarea', { rows: 10, 'aria-label': 'Message' });
  body.value = draft.body;
  const mark = async () => { a.remindedOn = todayISO(); await put('assemblies', a); };
  const dlg = sheet('Remind ' + (c.name || 'customer'),
    h('div', null,
      h('div', { class: 'field' }, h('label', null, 'Subject'), subject),
      h('div', { class: 'field' }, h('label', null, 'Message'), body),
      !c.email ? h('p', { class: 'hint' }, 'This customer has no email on file. You can still copy the message or send it as a text.') : null,
      h('div', { class: 'row' },
        c.email ? h('a', {
          class: 'btn primary',
          href: `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`,
          onClick: async (e) => {
            e.currentTarget.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
            await mark(); dlg.close(); rerender();
          },
        }, 'Open in email') : null,
        c.phone ? h('a', {
          class: 'btn',
          href: `sms:${c.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body.value)}`,
          onClick: async (e) => {
            e.currentTarget.href = `sms:${c.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body.value)}`;
            await mark(); dlg.close(); rerender();
          },
        }, 'Send as text') : null,
        h('button', {
          class: 'btn',
          onClick: async () => {
            try { await navigator.clipboard.writeText(subject.value + '\n\n' + body.value); toast('Message copied'); } catch { toast('Copying is blocked in this browser'); return; }
            await mark(); dlg.close(); rerender();
          },
        }, 'Copy message')),
      a.remindedOn ? h('p', { class: 'hint' }, `Last reminded ${formatDate(a.remindedOn)}.`) : null));
}
