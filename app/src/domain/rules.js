// Field-test pass/fail evaluation for backflow prevention assemblies.
//
// Default thresholds follow the mainstream criteria shared by the USC FCCCHR
// Manual (10th Edition), AWWA M14 Appendix B and the ASSE field-test
// procedures:
//   RP   relief valve opens at >= 2.0 psid; check 1 holds >= 5.0 psid and
//        above the relief valve opening point; check 2 holds tight.
//   DC   each check holds >= 1.0 psid.
//   PVB / SVB  air inlet opens at >= 1.0 psid and opens fully; check >= 1.0.
// Three points differ by jurisdiction and are therefore settings, not
// constants: the legacy 3.0 psid RP buffer, whether RP check 2 is recorded as
// a number, and the Type II bypass check minimum.
//
// The certified tester is always the authority. This module flags; the tester
// decides, and can override the computed result with a recorded reason.

export const ASSEMBLY_TYPES = [
  { code: 'RP', name: 'Reduced pressure principle (RP / RPZ)' },
  { code: 'DC', name: 'Double check valve (DC / DCVA)' },
  { code: 'PVB', name: 'Pressure vacuum breaker (PVB)' },
  { code: 'SVB', name: 'Spill-resistant vacuum breaker (SVB)' },
  { code: 'RPDA', name: 'RP detector assembly (RPDA)' },
  { code: 'RPDA-II', name: 'RP detector assembly, Type II (RPDA-II)' },
  { code: 'DCDA', name: 'Double check detector assembly (DCDA)' },
  { code: 'DCDA-II', name: 'Double check detector assembly, Type II (DCDA-II)' },
];

export const DEFAULT_RULES = Object.freeze({
  rpReliefMin: 2.0,
  rpCheck1Min: 5.0,
  rpBuffer: 'off', // 'off' | 'warn' | 'fail'  (check 1 minus relief opening >= 3.0)
  rpBufferMin: 3.0,
  rpCheck2Numeric: false, // true: record check 2 in psid with a 1.0 minimum
  rpCheck2Min: 1.0,
  dcCheckMin: 1.0,
  vbAirInletMin: 1.0,
  vbCheckMin: 1.0,
  type2BypassMin: 1.0, // USC 1.0; some ASSE jurisdictions use 0.5 for DCDA-II
  intervalMonths: 12,
  gaugeMonths: 12,
});

const NUMERIC_RULES = ['rpReliefMin', 'rpCheck1Min', 'rpBufferMin', 'rpCheck2Min', 'dcCheckMin', 'vbAirInletMin', 'vbCheckMin', 'type2BypassMin', 'intervalMonths', 'gaugeMonths'];

/** Defaults overlaid with saved settings. Bad or non-numeric values fall back to the default. */
export function mergeRules(overrides) {
  const out = { ...DEFAULT_RULES, ...(overrides || {}) };
  for (const k of NUMERIC_RULES) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) && n > 0 ? n : DEFAULT_RULES[k];
  }
  out.intervalMonths = Math.max(1, Math.round(out.intervalMonths));
  out.gaugeMonths = Math.max(1, Math.round(out.gaugeMonths));
  if (!['off', 'warn', 'fail'].includes(out.rpBuffer)) out.rpBuffer = DEFAULT_RULES.rpBuffer;
  out.rpCheck2Numeric = out.rpCheck2Numeric === true;
  return out;
}

/** Parse a reading typed by a tester. Returns a number, or null when blank or invalid. */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = String(v).trim();
  if (/^\d{1,3},\d{3}$/.test(raw)) return null; // "1,000" is ambiguous, not a reading
  const s = raw.replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A reading for display: one decimal normally, two when the tester entered two. Never rounds a value across a threshold. */
function fmt(n) {
  if (n === null) return '';
  const r = Math.round(n * 100) / 100;
  return Math.abs(r * 10 - Math.round(r * 10)) < 1e-9 ? r.toFixed(1) : r.toFixed(2);
}

// Field gauges for this work read 0 to 15 psid. Anything far above that is
// almost always a slipped decimal point (55 for 5.5).
const IMPLAUSIBLE_PSID = 25;

function minCheck(key, label, raw, min, unit = 'psid') {
  const value = num(raw);
  if (value === null) {
    return { key, label, value: null, display: '', status: 'missing', rule: `${min.toFixed(1)} ${unit} or more`, message: 'Not recorded' };
  }
  if (value < 0) {
    return { key, label, value, display: fmt(value), status: 'fail', rule: `${min.toFixed(1)} ${unit} or more`, message: 'A reading cannot be negative' };
  }
  const ok = value >= min;
  return {
    key, label, value, display: fmt(value),
    status: ok ? 'pass' : 'fail',
    rule: `${min.toFixed(1)} ${unit} or more`,
    message: ok ? `Holds at ${fmt(value)} ${unit}` : `${fmt(value)} ${unit} is below the ${min.toFixed(1)} ${unit} minimum`,
    hint: value > IMPLAUSIBLE_PSID ? `${fmt(value)} ${unit} is unusually high. Check the decimal point.` : '',
  };
}

function tightCheck(key, label, raw, required = true) {
  if (raw === true || raw === 'tight') {
    return { key, label, value: true, display: 'Closed tight', status: 'pass', rule: 'Closed tight', message: 'Closed tight' };
  }
  if (raw === false || raw === 'leaked') {
    return { key, label, value: false, display: 'Leaked', status: 'fail', rule: 'Closed tight', message: 'Leaked' };
  }
  return { key, label, value: null, display: '', status: required ? 'missing' : 'skipped', rule: 'Closed tight', message: 'Not recorded' };
}

function evalRP(r, rules, prefix = '', labelPrefix = '') {
  const checks = [];
  const k = (s) => prefix + s;
  const L = (s) => labelPrefix + s;

  // Relief valve
  if (r[k('rvDidNotOpen')] === true) {
    checks.push({ key: k('rv'), label: L('Relief valve'), value: null, display: 'Did not open', status: 'fail', rule: `Opens at ${rules.rpReliefMin.toFixed(1)} psid or more`, message: 'Relief valve did not open' });
  } else {
    const c = minCheck(k('rv'), L('Relief valve opening point'), r[k('rv')], rules.rpReliefMin);
    c.rule = `Opens at ${rules.rpReliefMin.toFixed(1)} psid or more`;
    if (c.status === 'pass') c.message = `Opened at ${c.display} psid`;
    checks.push(c);
  }

  // Check valve 1
  const c1 = minCheck(k('cv1'), L('Check valve 1'), r[k('cv1')], rules.rpCheck1Min);
  const rv = num(r[k('rv')]);
  if (c1.status === 'pass' && rv !== null && r[k('rvDidNotOpen')] !== true) {
    if (c1.value <= rv) {
      c1.status = 'fail';
      c1.message = `Check 1 (${c1.display}) must be above the relief valve opening point (${fmt(rv)})`;
    } else if (rules.rpBuffer !== 'off' && c1.value - rv < rules.rpBufferMin - 1e-9) {
      const buffer = (c1.value - rv).toFixed(1);
      if (rules.rpBuffer === 'fail') {
        c1.status = 'fail';
        c1.message = `Buffer of ${buffer} psid is below the ${rules.rpBufferMin.toFixed(1)} psid your jurisdiction requires`;
      } else {
        c1.status = 'warn';
        c1.message = `Holds at ${c1.display} psid, but the buffer over the relief valve is only ${buffer} psid`;
      }
    }
  }
  checks.push(c1);

  // Check valve 2
  if (rules.rpCheck2Numeric) {
    checks.push(minCheck(k('cv2'), L('Check valve 2'), r[k('cv2')], rules.rpCheck2Min));
  } else {
    checks.push(tightCheck(k('cv2Tight'), L('Check valve 2'), r[k('cv2Tight')]));
  }
  return checks;
}

function evalDC(r, rules, prefix = '', labelPrefix = '') {
  return [
    minCheck(prefix + 'cv1', labelPrefix + 'Check valve 1', r[prefix + 'cv1'], rules.dcCheckMin),
    minCheck(prefix + 'cv2', labelPrefix + 'Check valve 2', r[prefix + 'cv2'], rules.dcCheckMin),
  ];
}

function evalVB(r, rules) {
  const checks = [];
  if (r.airDidNotOpen === true) {
    checks.push({ key: 'air', label: 'Air inlet', value: null, display: 'Did not open', status: 'fail', rule: `Opens at ${rules.vbAirInletMin.toFixed(1)} psid or more`, message: 'Air inlet did not open' });
  } else {
    const a = minCheck('air', 'Air inlet opening point', r.air, rules.vbAirInletMin);
    a.rule = `Opens at ${rules.vbAirInletMin.toFixed(1)} psid or more`;
    if (a.status === 'pass') a.message = `Opened at ${a.display} psid`;
    checks.push(a);
    const full = r.airOpenedFully;
    if (full === true) {
      checks.push({ key: 'airOpenedFully', label: 'Air inlet opened fully', value: true, display: 'Yes', status: 'pass', rule: 'Opens fully', message: 'Opened fully' });
    } else if (full === false) {
      checks.push({ key: 'airOpenedFully', label: 'Air inlet opened fully', value: false, display: 'No', status: 'fail', rule: 'Opens fully', message: 'Air inlet did not open fully' });
    } else {
      checks.push({ key: 'airOpenedFully', label: 'Air inlet opened fully', value: null, display: '', status: 'missing', rule: 'Opens fully', message: 'Not recorded' });
    }
  }
  checks.push(minCheck('cv', 'Check valve', r.cv, rules.vbCheckMin));
  return checks;
}

/** Which reading fields a given assembly type uses. Drives the entry form and the report. */
export function fieldsFor(type, rulesIn) {
  const rules = mergeRules(rulesIn);
  const rp = (p, lp) => [
    { key: p + 'rv', label: lp + 'Relief valve opened at', kind: 'psid', altKey: p + 'rvDidNotOpen', altLabel: 'Did not open' },
    { key: p + 'cv1', label: lp + 'Check valve 1 held at', kind: 'psid' },
    rules.rpCheck2Numeric
      ? { key: p + 'cv2', label: lp + 'Check valve 2 held at', kind: 'psid' }
      : { key: p + 'cv2Tight', label: lp + 'Check valve 2', kind: 'tight' },
  ];
  const dc = (p, lp) => [
    { key: p + 'cv1', label: lp + 'Check valve 1 held at', kind: 'psid' },
    { key: p + 'cv2', label: lp + 'Check valve 2 held at', kind: 'psid' },
  ];
  const so2 = { key: 'so2Tight', label: 'Shutoff valve 2', kind: 'tight', optional: true };
  switch (type) {
    case 'RP': return [...rp('', ''), so2];
    case 'DC': return [...dc('', ''), so2];
    case 'PVB':
    case 'SVB':
      return [
        { key: 'air', label: 'Air inlet opened at', kind: 'psid', altKey: 'airDidNotOpen', altLabel: 'Did not open' },
        { key: 'airOpenedFully', label: 'Air inlet opened fully', kind: 'yesno' },
        { key: 'cv', label: 'Check valve held at', kind: 'psid' },
      ];
    case 'RPDA': return [...rp('', 'Main: '), ...rp('bp_', 'Bypass: '), so2];
    case 'DCDA': return [...dc('', 'Main: '), ...dc('bp_', 'Bypass: '), so2];
    case 'RPDA-II': return [...rp('', 'Main: '), { key: 'bp_cv', label: 'Bypass check held at', kind: 'psid' }, so2];
    case 'DCDA-II': return [...dc('', 'Main: '), { key: 'bp_cv', label: 'Bypass check held at', kind: 'psid' }, so2];
    default: return [];
  }
}

/**
 * Evaluate one set of readings.
 * @returns {{result: 'pass'|'fail'|'incomplete', checks: Array, warnings: string[]}}
 */
export function evaluate(type, readings, rulesIn) {
  const rules = mergeRules(rulesIn);
  const r = readings || {};
  let checks;
  switch (type) {
    case 'RP': checks = evalRP(r, rules); break;
    case 'DC': checks = evalDC(r, rules); break;
    case 'PVB':
    case 'SVB': checks = evalVB(r, rules); break;
    case 'RPDA': checks = [...evalRP(r, rules, '', 'Main: '), ...evalRP(r, rules, 'bp_', 'Bypass: ')]; break;
    case 'DCDA': checks = [...evalDC(r, rules, '', 'Main: '), ...evalDC(r, rules, 'bp_', 'Bypass: ')]; break;
    case 'RPDA-II':
      checks = [...evalRP(r, rules, '', 'Main: '), minCheck('bp_cv', 'Bypass check', r.bp_cv, rules.type2BypassMin)];
      break;
    case 'DCDA-II':
      checks = [...evalDC(r, rules, '', 'Main: '), minCheck('bp_cv', 'Bypass check', r.bp_cv, rules.type2BypassMin)];
      break;
    default:
      return { result: 'incomplete', checks: [], warnings: [`Unknown assembly type "${type}"`] };
  }
  if (['RP', 'DC', 'RPDA', 'DCDA', 'RPDA-II', 'DCDA-II'].includes(type)) {
    // A leaking downstream shutoff does not by itself fail the assembly, but it
    // can invalidate the readings, so it is carried onto the report as a note.
    const so2 = tightCheck('so2Tight', 'Shutoff valve 2', r.so2Tight, false);
    if (so2.status === 'fail') {
      so2.status = 'warn';
      so2.message = 'Shutoff valve 2 leaked. The readings may not be valid unless the leak was compensated for.';
    }
    checks.push(so2);
  }

  const warnings = checks.filter((c) => c.status === 'warn').map((c) => c.message);
  let result;
  if (checks.some((c) => c.status === 'fail')) result = 'fail';
  else if (checks.some((c) => c.status === 'missing')) result = 'incomplete';
  else result = 'pass';
  return { result, checks, warnings };
}

/**
 * Overall outcome of a test record: the initial test, or the test after repair
 * when one was done. A tester override wins and is reported as such.
 */
export function testOutcome(test, rulesIn) {
  const type = test.assemblyType;
  const initial = evaluate(type, test.initial, rulesIn);
  const final = test.repaired ? evaluate(type, test.final, rulesIn) : null;
  let computed = final ? final.result : initial.result;
  // A report with an after-repair test still needs a complete initial test.
  if (final && initial.result === 'incomplete' && computed !== 'incomplete') computed = 'incomplete';
  const overridden = (test.override === 'pass' || test.override === 'fail') && test.override !== computed;
  return {
    initial,
    final,
    computed,
    result: overridden ? test.override : computed,
    overridden,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-06 -> Oct 6, 2026. Returns the input unchanged if it is not an ISO date. */
export function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m || +m[2] < 1 || +m[2] > 12) return iso || '';
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

/** Problems with the tester's credentials or gauge on the test date. Warnings only. */
export function preflight({ testDate, tester, gauge, rules: rulesIn }) {
  const rules = mergeRules(rulesIn);
  const out = [];
  if (!tester) out.push({ code: 'no-tester', message: 'No tester selected' });
  else {
    if (!tester.certNo) out.push({ code: 'no-cert', message: `${tester.name || 'Tester'} has no certification number on file` });
    if (tester.certExpires && testDate && tester.certExpires < testDate) {
      out.push({ code: 'cert-expired', message: `${tester.name || 'Tester'}'s certification expired on ${prettyDate(tester.certExpires)}` });
    }
  }
  if (!gauge) out.push({ code: 'no-gauge', message: 'No test kit selected' });
  else if (!gauge.verified) out.push({ code: 'gauge-unverified', message: 'The test kit has no accuracy verification date on file' });
  else if (testDate) {
    const limit = addMonthsISO(gauge.verified, rules.gaugeMonths);
    if (limit < testDate) {
      out.push({ code: 'gauge-expired', message: `Test kit accuracy was last verified on ${prettyDate(gauge.verified)}, more than ${rules.gaugeMonths} months before this test` });
    }
  }
  return out;
}

/** Add calendar months to an ISO date (YYYY-MM-DD), clamping to the month's last day. */
export function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
