import test from 'node:test';
import assert from 'node:assert/strict';
import { standing, compareStanding, daysBetween, isISODate, dueLabel, fillTemplate, formatDate } from '../app/src/domain/due.js';

const today = '2026-10-06';

test('isISODate rejects impossible dates', () => {
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2026-2-3'), false);
  assert.equal(isISODate('2024-02-29'), true);
  assert.equal(isISODate(null), false);
});

test('daysBetween', () => {
  assert.equal(daysBetween('2026-10-06', '2026-10-07'), 1);
  assert.equal(daysBetween('2026-10-06', '2026-10-06'), 0);
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2); // across US DST change
  assert.equal(daysBetween('2026-10-06', '2025-10-06'), -365);
});

test('untested assembly with no install date', () => {
  assert.equal(standing({}, [], null, today).status, 'untested');
});

test('due one interval after the last passing test', () => {
  const s = standing({}, [{ date: '2025-10-20', result: 'pass' }], null, today);
  assert.equal(s.due, '2026-10-20');
  assert.equal(s.status, 'soon');
  assert.equal(s.days, 14);
});

test('status buckets', () => {
  const at = (d) => standing({}, [{ date: d, result: 'pass' }], null, today).status;
  assert.equal(at('2025-10-05'), 'overdue');
  assert.equal(at('2025-10-06'), 'soon'); // due today
  assert.equal(at('2025-11-05'), 'soon'); // 30 days
  assert.equal(at('2025-11-06'), 'upcoming'); // 31 days
  assert.equal(at('2025-12-05'), 'upcoming'); // 60 days
  assert.equal(at('2025-12-06'), 'ok');
});

test('a failed latest test outranks everything', () => {
  const s = standing({}, [{ date: '2026-09-01', result: 'fail' }, { date: '2025-09-01', result: 'pass' }], null, today);
  assert.equal(s.status, 'failed');
});

test('a later pass clears an earlier failure', () => {
  const s = standing({}, [{ date: '2026-09-01', result: 'fail' }, { date: '2026-09-03', result: 'pass' }], null, today);
  assert.equal(s.status, 'ok');
  assert.equal(s.due, '2027-09-03');
});

test('same-day fail then pass uses the later record', () => {
  const s = standing({}, [{ date: '2026-09-01', result: 'fail', createdAt: 1 }, { date: '2026-09-01', result: 'pass', createdAt: 2 }], null, today);
  assert.equal(s.status, 'ok');
});

test('imported last-test date and per-assembly interval', () => {
  assert.equal(standing({ lastTestedImported: '2025-09-01' }, [], null, today).status, 'overdue');
  assert.equal(standing({ lastTestedImported: '2025-09-01', intervalMonths: 84 }, [], null, today).due, '2032-09-01');
  assert.equal(standing({ installed: '2026-08-01' }, [], null, today).due, '2027-08-01');
});

test('sorting puts failures and overdue first', () => {
  const list = [{ status: 'ok', due: '2027-01-01' }, { status: 'overdue', due: '2026-01-01' }, { status: 'failed', due: '2026-09-01' }, { status: 'soon', due: '2026-10-10' }, { status: 'overdue', due: '2025-01-01' }];
  list.sort(compareStanding);
  assert.deepEqual(list.map((x) => x.status), ['failed', 'overdue', 'overdue', 'soon', 'ok']);
  assert.equal(list[1].due, '2025-01-01');
});

test('labels and templates', () => {
  assert.equal(dueLabel({ status: 'overdue', days: -1 }), '1 day overdue');
  assert.equal(dueLabel({ status: 'soon', days: 0 }), 'Due today');
  assert.equal(dueLabel({ status: 'ok', days: 90 }), 'Due in 90 days');
  assert.equal(formatDate('2026-10-06'), 'Oct 6, 2026');
  assert.equal(fillTemplate('Hi {customer}, due {due} {unknown}', { customer: 'Ann', due: 'Oct 6' }), 'Hi Ann, due Oct 6 {unknown}');
});

test('odd interval values cannot produce a malformed due date', () => {
  assert.equal(standing({ lastTestedImported: '2025-09-01', intervalMonths: 1.5 }, [], null, today).due, '2025-11-01');
  assert.equal(standing({ lastTestedImported: '2025-09-01', intervalMonths: 'abc' }, [], null, today).due, '2026-09-01');
  assert.equal(standing({ lastTestedImported: '2025-09-01' }, [], { intervalMonths: '12' }, today).due, '2026-09-01');
});
