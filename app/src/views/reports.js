import { h, download, toast } from '../dom.js';
import { state } from '../store.js';
import { formatDate, todayISO } from '../domain/due.js';
import { testOutcome } from '../domain/rules.js';
import { toCSV } from '../domain/csv.js';
import { rerender } from '../nav.js';
import { resultBadge, emptyState, deviceLine, rulesFor } from './shared.js';

let query = '';
let year = '';
let unfiledOnly = false;

export function testsCSV(tests) {
  const header = ['Test date', 'Result', 'Customer', 'Service address', 'City', 'State', 'Water system', 'Account', 'Type', 'Manufacturer', 'Model', 'Serial', 'Size', 'Location', 'Reason', 'Line pressure', 'Initial readings', 'Repaired', 'Parts', 'After-repair readings', 'Tester', 'Certification', 'Test kit serial', 'Test kit verified', 'Remarks', 'Result set by tester', 'Reason', 'Date filed', 'Confirmation number', 'Portal fee'];
  const readings = (ev) => (ev ? ev.checks.filter((c) => c.display !== '').map((c) => `${c.label}: ${c.display}`).join('; ') : '');
  const rows = tests.map((t) => {
    const s = t.snapshot || {};
    const o = testOutcome(t, rulesFor(t));
    return [t.date, o.result, s.customer?.name, s.assembly?.serviceAddress || s.customer?.address, s.customer?.city, s.customer?.state, s.assembly?.purveyor, s.assembly?.account,
      s.assembly?.type, s.assembly?.make, s.assembly?.model, s.assembly?.serial, s.assembly?.size, s.assembly?.location, t.reason, t.linePressure,
      readings(o.initial), t.repaired ? 'Yes' : 'No', (t.parts || []).join('; '), readings(o.final), s.tester?.name, s.tester?.certNo, s.gauge?.serial, s.gauge?.verified, t.remarks, o.overridden ? 'Yes' : 'No', o.overridden ? t.overrideReason : '', t.filedOn, t.filingRef, t.filingFee];
  });
  return toCSV([header, ...rows]);
}

export function reportsView() {
  const all = [...state.tests].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  if (!all.length) {
    return h('section', null, h('h1', null, 'Reports'),
      emptyState('No test reports yet', 'Reports you save appear here, newest first. Start one from an assembly on the Due screen.', h('a', { class: 'btn primary', href: '#/due' }, 'See what is due')));
  }
  const years = [...new Set(all.map((t) => t.date.slice(0, 4)))];
  const q = query.trim().toLowerCase();
  const unfiled = all.filter((t) => !t.filedOn).length;
  const shown = all.filter((t) => (!unfiledOnly || !t.filedOn) && (!year || t.date.startsWith(year)) && (!q || [t.snapshot?.customer?.name, t.snapshot?.customer?.address, t.snapshot?.assembly?.serial, t.snapshot?.assembly?.purveyor, t.snapshot?.tester?.name].some((v) => v && v.toLowerCase().includes(q))));
  const search = h('input', { type: 'search', placeholder: 'Search customer, serial, water system', 'aria-label': 'Search reports', value: query });
  search.addEventListener('input', () => {
    query = search.value;
    const pos = search.selectionStart;
    rerender();
    const again = document.querySelector('.searchbar input');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  const yearSel = h('select', { 'aria-label': 'Year', onChange: (e) => { year = e.currentTarget.value; rerender(); } },
    h('option', { value: '' }, 'All years'), years.map((y) => h('option', { value: y, selected: y === year }, y)));
  const passed = shown.filter((t) => t.result === 'pass').length;
  return h('section', null,
    h('div', { class: 'row between' }, h('h1', null, 'Reports'),
      h('button', { class: 'btn small', onClick: () => { download(`tagdue-tests-${todayISO()}.csv`, testsCSV(shown), 'text/csv'); toast(`${shown.length} ${shown.length === 1 ? 'report' : 'reports'} exported`); } }, 'Export these as a spreadsheet')),
    h('div', { class: 'searchbar' }, search, yearSel),
    h('div', { class: 'chips' },
      h('button', { class: 'chip' + (!unfiledOnly ? ' on' : ''), 'aria-pressed': String(!unfiledOnly), onClick: () => { unfiledOnly = false; rerender(); } }, 'All ', h('b', null, all.length)),
      h('button', { class: 'chip' + (unfiledOnly ? ' on' : '') + (unfiled ? ' alert' : ''), 'aria-pressed': String(unfiledOnly), onClick: () => { unfiledOnly = true; rerender(); } }, 'Not filed yet ', h('b', null, unfiled))),
    h('p', { class: 'quiet' }, `${shown.length} ${shown.length === 1 ? 'report' : 'reports'}: ${passed} passed, ${shown.length - passed} failed.`),
    h('ul', { class: 'rows' }, shown.map((t) => h('li', null, h('a', { href: `#/report/${t.id}` },
      h('span', { class: 'row-main' }, t.snapshot?.customer?.name || 'Unknown customer'),
      h('span', { class: 'row-sub' }, formatDate(t.date), ', ', deviceLine(t.snapshot?.assembly || {}), t.filedOn ? '' : ', not filed yet'),
      resultBadge(t.result))))));
}
