import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, testOutcome, preflight, addMonthsISO, num, fieldsFor, mergeRules, ASSEMBLY_TYPES } from '../app/src/domain/rules.js';

const status = (res, key) => res.checks.find((c) => c.key === key).status;

test('num parses tester input', () => {
  assert.equal(num('5.2'), 5.2);
  assert.equal(num(' 5,2 '), 5.2);
  assert.equal(num('.8'), 0.8);
  assert.equal(num('5.'), 5);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(num('5.2.1'), null);
  assert.equal(num(null), null);
  assert.equal(num(0), 0);
});

test('RP passes at the minimums', () => {
  const r = evaluate('RP', { rv: '2.0', cv1: '5.0', cv2Tight: true });
  assert.equal(r.result, 'pass');
});

test('RP fails when relief valve opens below 2.0', () => {
  const r = evaluate('RP', { rv: '1.9', cv1: '6.0', cv2Tight: true });
  assert.equal(r.result, 'fail');
  assert.equal(status(r, 'rv'), 'fail');
});

test('RP fails when check 1 is below 5.0', () => {
  const r = evaluate('RP', { rv: '2.5', cv1: '4.9', cv2Tight: true });
  assert.equal(r.result, 'fail');
  assert.equal(status(r, 'cv1'), 'fail');
});

test('RP fails when check 1 is not above the relief valve opening point', () => {
  const r = evaluate('RP', { rv: '5.5', cv1: '5.5', cv2Tight: true });
  assert.equal(r.result, 'fail');
  assert.match(r.checks.find((c) => c.key === 'cv1').message, /above the relief valve/);
});

test('RP fails when relief valve did not open or check 2 leaked', () => {
  assert.equal(evaluate('RP', { rvDidNotOpen: true, cv1: '6', cv2Tight: true }).result, 'fail');
  assert.equal(evaluate('RP', { rv: '2.4', cv1: '6', cv2Tight: false }).result, 'fail');
});

test('RP is incomplete until every required reading is in', () => {
  assert.equal(evaluate('RP', { rv: '2.4', cv1: '6' }).result, 'incomplete');
  assert.equal(evaluate('RP', {}).result, 'incomplete');
});

test('a failing reading decides the result even when others are missing', () => {
  assert.equal(evaluate('RP', { rv: '1.0' }).result, 'fail');
});

test('RP buffer setting: off, warn, fail', () => {
  const readings = { rv: '3.0', cv1: '5.5', cv2Tight: true }; // buffer 2.5
  assert.equal(evaluate('RP', readings).result, 'pass');
  const warn = evaluate('RP', readings, { rpBuffer: 'warn' });
  assert.equal(warn.result, 'pass');
  assert.equal(warn.warnings.length, 1);
  assert.equal(evaluate('RP', readings, { rpBuffer: 'fail' }).result, 'fail');
  // exactly 3.0 buffer is acceptable (floating point safe)
  assert.equal(evaluate('RP', { rv: '2.3', cv1: '5.3', cv2Tight: true }, { rpBuffer: 'fail' }).result, 'pass');
});

test('RP check 2 numeric mode', () => {
  const rules = { rpCheck2Numeric: true };
  assert.equal(evaluate('RP', { rv: '2.5', cv1: '6', cv2: '1.0' }, rules).result, 'pass');
  assert.equal(evaluate('RP', { rv: '2.5', cv1: '6', cv2: '0.9' }, rules).result, 'fail');
  assert.equal(evaluate('RP', { rv: '2.5', cv1: '6', cv2Tight: true }, rules).result, 'incomplete');
});

test('shutoff valve 2 is optional; a leak is a note on the report, not an automatic failure', () => {
  assert.equal(evaluate('DC', { cv1: '1.5', cv2: '1.2' }).result, 'pass');
  const leak = evaluate('DC', { cv1: '1.5', cv2: '1.2', so2Tight: false });
  assert.equal(leak.result, 'pass');
  assert.match(leak.warnings[0], /Shutoff valve 2 leaked/);
});

test('DC thresholds', () => {
  assert.equal(evaluate('DC', { cv1: '1.0', cv2: '1.0' }).result, 'pass');
  assert.equal(evaluate('DC', { cv1: '0.9', cv2: '1.0' }).result, 'fail');
  assert.equal(evaluate('DC', { cv1: '1.0', cv2: '0.0' }).result, 'fail');
  assert.equal(evaluate('DC', { cv1: '1.0' }).result, 'incomplete');
});

test('PVB and SVB thresholds', () => {
  for (const t of ['PVB', 'SVB']) {
    assert.equal(evaluate(t, { air: '1.0', airOpenedFully: true, cv: '1.0' }).result, 'pass');
    assert.equal(evaluate(t, { air: '0.9', airOpenedFully: true, cv: '1.0' }).result, 'fail');
    assert.equal(evaluate(t, { air: '1.5', airOpenedFully: false, cv: '1.0' }).result, 'fail');
    assert.equal(evaluate(t, { air: '1.5', airOpenedFully: true, cv: '0.5' }).result, 'fail');
    assert.equal(evaluate(t, { airDidNotOpen: true, cv: '2' }).result, 'fail');
    assert.equal(evaluate(t, { air: '1.5', cv: '2' }).result, 'incomplete');
  }
});

test('detector assemblies test main and bypass', () => {
  const good = { rv: '2.5', cv1: '6', cv2Tight: true, bp_rv: '2.2', bp_cv1: '5.5', bp_cv2Tight: true };
  assert.equal(evaluate('RPDA', good).result, 'pass');
  assert.equal(evaluate('RPDA', { ...good, bp_cv1: '4.0' }).result, 'fail');
  assert.equal(evaluate('RPDA', { rv: '2.5', cv1: '6', cv2Tight: true }).result, 'incomplete');
  assert.equal(evaluate('DCDA', { cv1: '1.2', cv2: '1.2', bp_cv1: '1.1', bp_cv2: '1.3' }).result, 'pass');
  assert.equal(evaluate('DCDA', { cv1: '1.2', cv2: '1.2', bp_cv1: '0.4', bp_cv2: '1.3' }).result, 'fail');
});

test('Type II bypass minimum is configurable', () => {
  const r = { cv1: '1.2', cv2: '1.2', bp_cv: '0.7' };
  assert.equal(evaluate('DCDA-II', r).result, 'fail');
  assert.equal(evaluate('DCDA-II', r, { type2BypassMin: 0.5 }).result, 'pass');
  assert.equal(evaluate('RPDA-II', { rv: '2.5', cv1: '6', cv2Tight: true, bp_cv: '1.0' }).result, 'pass');
});

test('negative readings fail, unknown types are incomplete', () => {
  assert.equal(evaluate('DC', { cv1: '-1', cv2: '2' }).result, 'fail');
  assert.equal(evaluate('XYZ', {}).result, 'incomplete');
});

test('every type has entry fields that match what evaluate reads', () => {
  for (const { code } of ASSEMBLY_TYPES) {
    const fields = fieldsFor(code);
    assert.ok(fields.length > 0, code);
    const readings = {};
    for (const f of fields) {
      if (f.kind === 'psid') readings[f.key] = '9.0';
      else if (f.kind === 'tight') readings[f.key] = true;
      else if (f.kind === 'yesno') readings[f.key] = true;
    }
    // 9.0 everywhere: RP check 1 equals relief valve, so lower the relief valves.
    for (const k of Object.keys(readings)) if (k.endsWith('rv')) readings[k] = '2.5';
    assert.equal(evaluate(code, readings).result, 'pass', code);
  }
});

test('testOutcome uses the after-repair test when there is one', () => {
  const base = { assemblyType: 'DC', initial: { cv1: '0.4', cv2: '1.5' } };
  assert.equal(testOutcome(base).result, 'fail');
  const repaired = { ...base, repaired: true, final: { cv1: '1.8', cv2: '1.5' } };
  const o = testOutcome(repaired);
  assert.equal(o.initial.result, 'fail');
  assert.equal(o.result, 'pass');
  // Ticking 'repaired' without entering the retest must not save as a finished report.
  assert.equal(testOutcome({ ...base, repaired: true, final: {} }).result, 'incomplete');
  // A passing retest still needs a complete initial test.
  assert.equal(testOutcome({ assemblyType: 'DC', initial: { cv1: '1.5' }, repaired: true, final: { cv1: '1.8', cv2: '1.5' } }).result, 'incomplete');
});

test('testOutcome honours a tester override and says so', () => {
  const o = testOutcome({ assemblyType: 'DC', initial: { cv1: '1.5', cv2: '1.5' }, override: 'fail' });
  assert.equal(o.computed, 'pass');
  assert.equal(o.result, 'fail');
  assert.equal(o.overridden, true);
});

test('addMonthsISO clamps to month end and crosses years', () => {
  assert.equal(addMonthsISO('2026-10-06', 12), '2027-10-06');
  assert.equal(addMonthsISO('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonthsISO('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsISO('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonthsISO('2026-03-15', -3), '2025-12-15');
});

test('preflight flags expired certification and stale gauge', () => {
  const tester = { name: 'Sam', certNo: 'B123', certExpires: '2026-09-30' };
  const gauge = { verified: '2025-09-01' };
  const codes = preflight({ testDate: '2026-10-06', tester, gauge }).map((p) => p.code);
  assert.deepEqual(codes.sort(), ['cert-expired', 'gauge-expired']);
  assert.deepEqual(preflight({ testDate: '2026-10-06', tester: { ...tester, certExpires: '2027-01-01' }, gauge: { verified: '2025-10-06' } }), []);
  const none = preflight({ testDate: '2026-10-06', tester: null, gauge: null }).map((p) => p.code);
  assert.deepEqual(none.sort(), ['no-gauge', 'no-tester']);
});

test('an override that matches the readings is not reported as an override', () => {
  const o = testOutcome({ assemblyType: 'DC', initial: { cv1: '1.5', cv2: '1.5' }, override: 'pass' });
  assert.equal(o.overridden, false);
  assert.equal(o.result, 'pass');
});

test('readings are never rounded across a threshold', () => {
  const r = evaluate('RP', { rv: '1.95', cv1: '4.95', cv2Tight: true });
  assert.equal(r.result, 'fail');
  assert.equal(r.checks.find((c) => c.key === 'cv1').display, '4.95');
  assert.equal(r.checks.find((c) => c.key === 'rv').display, '1.95');
  assert.equal(evaluate('DC', { cv1: '1.0', cv2: '1.20' }).checks[1].display, '1.2');
});

test('ambiguous or exotic number formats are treated as not recorded, never as a pass', () => {
  for (const v of ['1,000', '1e1', '+5', '5 0', '\uFF15', '5.5.5', 'five']) assert.equal(num(v), null, v);
  assert.equal(evaluate('DC', { cv1: '1,000', cv2: '2' }).result, 'incomplete');
});

test('an implausibly high reading carries a hint to check the decimal point', () => {
  const r = evaluate('RP', { rv: '2.5', cv1: '55', cv2Tight: true });
  assert.match(r.checks.find((c) => c.key === 'cv1').hint, /decimal point/);
  assert.equal(evaluate('RP', { rv: '2.5', cv1: '5.5', cv2Tight: true }).checks.find((c) => c.key === 'cv1').hint, '');
});

test('rule settings are sanitised: strings and junk fall back to safe values', () => {
  const m = mergeRules({ intervalMonths: '12', type2BypassMin: '0.5', rpBuffer: 'nonsense', rpCheck1Min: 'abc', rpCheck2Numeric: 'yes' });
  assert.equal(m.intervalMonths, 12);
  assert.equal(m.type2BypassMin, 0.5);
  assert.equal(m.rpBuffer, 'off');
  assert.equal(m.rpCheck1Min, 5.0);
  assert.equal(m.rpCheck2Numeric, false);
  assert.equal(mergeRules({ intervalMonths: 1.5 }).intervalMonths, 2);
  assert.equal(evaluate('DC', { cv1: '1.5', cv2: '1.5' }, { dcCheckMin: 'x' }).result, 'pass');
});

test('a report evaluated with its own saved rules does not change when settings change', () => {
  const saved = { assemblyType: 'RP', initial: { rv: '2.5', cv1: '5.0', cv2Tight: true }, rules: mergeRules() };
  assert.equal(testOutcome(saved, saved.rules).result, 'pass');
  assert.equal(testOutcome(saved, mergeRules({ rpBuffer: 'fail' })).result, 'fail'); // why the rules must be frozen
});
