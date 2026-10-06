// Due-date tracking: when each assembly must next be tested, and how urgent it is.
import { addMonthsISO, mergeRules } from './rules.js';

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(fromISO, toISO) {
  const a = Date.UTC(...isoParts(fromISO));
  const b = Date.UTC(...isoParts(toISO));
  return Math.round((b - a) / 86400000);
}

function isoParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Work out an assembly's standing.
 * @param assembly  assembly record (may carry intervalMonths, lastTestedImported, installed)
 * @param tests     saved tests for this assembly, each with {date, result}
 * @returns {{status, due, lastDate, lastResult, days}}
 *   status: 'failed' | 'overdue' | 'soon' (<=30 days) | 'upcoming' (<=60) | 'ok' | 'untested'
 */
export function standing(assembly, tests, rulesIn, today = todayISO()) {
  const rules = mergeRules(rulesIn);
  const own = Math.round(Number(assembly.intervalMonths));
  const interval = Number.isFinite(own) && own > 0 ? own : rules.intervalMonths;
  const sorted = [...(tests || [])].filter((t) => isISODate(t.date)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const last = sorted[0] || null;
  const imported = isISODate(assembly.lastTestedImported) ? assembly.lastTestedImported : null;

  if (last && last.result === 'fail' && (!imported || imported <= last.date)) {
    return { status: 'failed', due: last.date, lastDate: last.date, lastResult: 'fail', days: daysBetween(today, last.date) };
  }

  let lastDate = null;
  const lastPass = sorted.find((t) => t.result === 'pass');
  if (lastPass) lastDate = lastPass.date;
  if (imported && (!lastDate || imported > lastDate)) lastDate = imported;

  let due;
  if (lastDate) due = addMonthsISO(lastDate, interval);
  else if (isISODate(assembly.installed)) due = addMonthsISO(assembly.installed, interval);
  else return { status: 'untested', due: null, lastDate: null, lastResult: null, days: null };

  const days = daysBetween(today, due);
  let status;
  if (days < 0) status = 'overdue';
  else if (days <= 30) status = 'soon';
  else if (days <= 60) status = 'upcoming';
  else status = 'ok';
  return { status, due, lastDate, lastResult: lastDate ? 'pass' : null, days };
}

const ORDER = { failed: 0, overdue: 1, soon: 2, upcoming: 3, untested: 4, ok: 5 };

/** Sort key: most urgent first, then by due date. */
export function compareStanding(a, b) {
  const o = ORDER[a.status] - ORDER[b.status];
  if (o !== 0) return o;
  if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  return 0;
}

export function formatDate(iso) {
  if (!isISODate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function dueLabel(s) {
  switch (s.status) {
    case 'failed': return 'Failed, needs repair and retest';
    case 'untested': return 'No test on record';
    case 'overdue': return s.days === -1 ? '1 day overdue' : `${-s.days} days overdue`;
    default:
      if (s.days === 0) return 'Due today';
      if (s.days === 1) return 'Due tomorrow';
      return `Due in ${s.days} days`;
  }
}

/** Fill a reminder template. Unknown placeholders are left untouched. */
export function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values && values[k] != null ? String(values[k]) : m));
}

export const DEFAULT_REMINDER = {
  subject: 'Backflow test due {due} at {address}',
  body: `Hello {customer},

The backflow prevention assembly at {address} ({device}) is due for its required test by {due}.

We tested it last time and have its records on file, so the visit is quick. Reply to this email or call {phone} and we will get you on the schedule and send the report to your water provider.

Thank you,
{company}`,
};
