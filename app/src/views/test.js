import { h, setChildren, field, toast, confirmDialog, sheet, download } from '../dom.js';
import { state, byId, put, remove, saveSettings } from '../store.js';
import { fieldsFor, testOutcome, preflight, mergeRules } from '../domain/rules.js';
import { todayISO, formatDate, isISODate } from '../domain/due.js';
import { navigate, rerender, currentEntitlement } from '../nav.js';
import { backLink, resultBadge, deviceLine, customerAddress, rulesFor, assemblyStanding } from './shared.js';
import { buildReportPDF, reportFilename, typeName } from '../pdf.js';

const REASONS = ['Annual test', 'New installation', 'Replacement', 'Retest after repair', 'Requested by water system', 'Other'];
const PARTS = ['Cleaned only', 'Rubber kit', 'Check disc', 'Seat', 'Spring', 'O-rings', 'Diaphragm', 'Relief valve kit', 'Air inlet kit', 'Shutoff valve', 'Assembly replaced'];

const draftKey = (existing, a) => (existing ? `tagdue-draft-edit-${existing.id}` : `tagdue-draft-new-${a.id}`);

function readDraft(key) {
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    return d && typeof d === 'object' && d.t && typeof d.t.initial === 'object' ? d : null;
  } catch { return null; }
}
function writeDraft(key, t) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), t })); } catch { /* storage full or blocked: the form still works */ }
}
function dropDraft(key) {
  try { localStorage.removeItem(key); } catch { /* nothing to drop */ }
}

export function testEditView(id, assemblyId) {
  const existing = id ? byId('tests', id) : null;
  if (id && !existing) return h('section', null, backLink('#/reports', 'Reports'), h('p', null, 'That report is no longer here.'));
  const a = byId('assemblies', existing ? existing.assemblyId : assemblyId);
  if (!a) return h('section', null, backLink('#/due', 'What is due'), h('p', null, 'That assembly is no longer here.'));
  const c = byId('customers', a.customerId);
  // A saved report keeps the rules and the assembly type it was made under.
  const rules = mergeRules(existing ? rulesFor(existing) : state.settings.rules);
  const type = existing ? existing.assemblyType : a.type;

  if (!existing) {
    const e = currentEntitlement();
    if (!e.canCreate) {
      return h('section', null,
        backLink(`#/assembly/${a.id}`, 'Assembly'),
        h('h1', null, e.mode === 'expired' ? 'Your licence has ended' : 'The free trial is used up'),
        h('p', null, 'Everything you have recorded stays here. You can open, share and export every report. To record new tests, enter a licence key.'),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/settings/licence' }, 'Enter a licence key')));
    }
    if (!state.testers.length || !state.gauges.length) {
      return h('section', null,
        backLink(`#/assembly/${a.id}`, 'Assembly'),
        h('h1', null, 'Two things before the first test'),
        h('p', null, 'Every report carries the tester’s certification and the test kit’s serial number and verification date. Add them once and TagDue fills them in from then on.'),
        h('div', { class: 'row' },
          !state.testers.length ? h('a', { class: 'btn primary', href: '#/settings/testers' }, 'Add a tester') : null,
          !state.gauges.length ? h('a', { class: 'btn primary', href: '#/settings/gauges' }, 'Add a test kit') : null));
    }
  }

  const now = new Date();
  const fresh = () => (existing ? structuredClone(existing) : {
    assemblyId: a.id,
    assemblyType: type,
    date: todayISO(now),
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    reason: assemblyStanding(a).status === 'failed' ? 'Retest after repair' : 'Annual test',
    testerId: byId('testers', state.settings.lastTesterId) ? state.settings.lastTesterId : state.testers[0].id,
    gaugeId: byId('gauges', state.settings.lastGaugeId) ? state.settings.lastGaugeId : state.gauges[0].id,
    linePressure: '', installedCorrectly: null,
    initial: {}, repaired: false, parts: [], repairNotes: '', repairedBy: '', final: {},
    remarks: '', override: '', overrideReason: '', signature: '',
  });
  const key = draftKey(existing, a);
  const draft = readDraft(key);
  const restored = !!(draft && draft.t.assemblyId === a.id && draft.t.assemblyType === type && (!existing || draft.t.id === existing.id));
  const t = restored ? draft.t : fresh();
  t.parts = t.parts || [];
  t.final = t.final || {};
  t.initial = t.initial || {};
  let rememberSignature = false;

  // The tester and test kit as printed on the report: the saved copy for a
  // report being corrected, unless a different one is chosen.
  const recorded = existing ? existing.snapshot || {} : {};
  const testerFor = (tid) => (existing && tid === existing.testerId && recorded.tester ? recorded.tester : byId('testers', tid));
  const gaugeFor = (gid) => (existing && gid === existing.gaugeId && recorded.gauge ? recorded.gauge : byId('gauges', gid));
  const gaugeLabel = (g) => [g.make, g.model, g.serial ? '#' + g.serial : ''].filter(Boolean).join(' ') || 'Test kit';
  const testerOptions = state.testers.map((x) => [x.id, x.name]);
  if (existing && !byId('testers', existing.testerId) && recorded.tester) testerOptions.unshift([existing.testerId, `${recorded.tester.name || 'Tester'} (as recorded)`]);
  const gaugeOptions = state.gauges.map((g) => [g.id, gaugeLabel(g)]);
  if (existing && !byId('gauges', existing.gaugeId) && recorded.gauge) gaugeOptions.unshift([existing.gaugeId, `${gaugeLabel(recorded.gauge)} (as recorded)`]);

  const warnBox = h('div', { class: 'stack' });
  const initialVerdict = h('div', { class: 'verdict', role: 'status', 'aria-live': 'polite' });
  const finalVerdict = h('div', { class: 'verdict', role: 'status', 'aria-live': 'polite' });
  const overallVerdict = h('div', { class: 'verdict overall', role: 'status' });
  const repairSection = h('fieldset', { class: 'repairs' });
  const finalSection = h('div', null);
  const error = h('p', { class: 'form-error', role: 'alert' });

  const initialInputs = readingInputs(type, t.initial, rules, () => update());
  const finalInputs = readingInputs(type, t.final, rules, () => update(), 'After repair: ');

  let ready = false;
  function update() {
    const pre = preflight({ testDate: t.date, tester: testerFor(t.testerId), gauge: gaugeFor(t.gaugeId), rules });
    setChildren(warnBox, pre.map((p) => h('div', { class: 'notice warn' }, p.message, '. The report will still save, but the water system may reject it.')));

    const o = testOutcome(t, rules);
    initialInputs.mark(o.initial);
    setVerdict(initialVerdict, o.initial, 'Initial test');

    repairSection.hidden = !(o.initial.result === 'fail' || t.repaired);
    finalSection.hidden = !t.repaired;
    if (o.final) {
      finalInputs.mark(o.final);
      setVerdict(finalVerdict, o.final, 'Test after repair');
    }
    overallVerdict.className = 'verdict overall ' + o.result;
    setChildren(overallVerdict,
      h('strong', null, o.result === 'pass' ? 'This report will say: Passed' : o.result === 'fail' ? 'This report will say: Failed' : 'Readings are not complete yet'),
      o.overridden ? h('span', null, ` Set by the tester. Readings alone indicate ${o.computed}.`) : null);
    if (ready) writeDraft(key, t);
  }

  const partsBox = h('div', { class: 'chips wrap' }, PARTS.map((p) => {
    const b = h('button', { type: 'button', class: 'chip' + (t.parts.includes(p) ? ' on' : ''), 'aria-pressed': String(t.parts.includes(p)) }, p);
    b.addEventListener('click', () => {
      if (t.parts.includes(p)) t.parts = t.parts.filter((x) => x !== p); else t.parts.push(p);
      b.classList.toggle('on');
      b.setAttribute('aria-pressed', String(t.parts.includes(p)));
      update();
    });
    return b;
  }));

  repairSection.append(
    h('legend', null, 'Repairs'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: t.repaired, onChange: (e) => { t.repaired = e.currentTarget.checked; update(); } }),
      'I repaired it and tested it again on this visit'),
    h('p', { class: 'hint' }, 'Leave this unticked to save the failed test now. The assembly then shows as failed until you record a passing retest.'),
    h('div', null,
      h('p', { class: 'label' }, 'Work done'),
      partsBox,
      field('Repair notes', t, 'repairNotes', { multiline: true, optional: true, onChange: update }),
      field('Repaired by, if not the tester', t, 'repairedBy', { optional: true, onChange: update })),
    finalSection);
  finalSection.append(h('h3', null, 'Test after repair'), finalInputs.el, finalVerdict);

  const pad = signaturePad(t.signature, (dataUrl) => { t.signature = dataUrl; update(); });
  const testerHasSaved = () => !!byId('testers', t.testerId)?.signature;
  const useSaved = h('button', { type: 'button', class: 'btn small', hidden: !testerHasSaved(), onClick: () => { const sig = byId('testers', t.testerId).signature; t.signature = sig; pad.load(sig); update(); } }, 'Use my saved signature');

  const overrideReason = field('Why the result differs from the readings', t, 'overrideReason', { multiline: true, rows: 2, onChange: update });
  overrideReason.hidden = !t.override;

  async function save(e) {
    e.preventDefault();
    error.textContent = '';
    if (!isISODate(t.date)) { error.textContent = 'Enter the date of the test.'; return; }
    if (t.date > todayISO()) { error.textContent = 'The test date is in the future. Check the date.'; return; }
    t.assemblyType = type;
    if (!t.repaired) t.final = {};
    const o = testOutcome(t, rules);
    if (o.result === 'incomplete') {
      const which = o.initial.result === 'incomplete' ? 'the initial test' : 'the test after repair';
      error.textContent = `Some readings for ${which} are still blank. Fill them in, or set the result yourself under "Record a different result".`;
      return;
    }
    if (o.overridden && !String(t.overrideReason || '').trim()) { error.textContent = 'Say why the result differs from the readings. It prints on the report.'; return; }
    if (!o.overridden) { t.override = ''; t.overrideReason = ''; }
    const tester = testerFor(t.testerId);
    const gauge = gaugeFor(t.gaugeId);
    if (!tester || !gauge) { error.textContent = 'Choose a tester and a test kit.'; return; }
    const { signature: _omit, ...testerInfo } = tester;
    if (existing && existing.snapshot) {
      // Correcting a report must not rewrite its history: keep the customer,
      // assembly and company as they were, and the tester and test kit unless changed.
      t.snapshot = { ...structuredClone(existing.snapshot), tester: testerInfo, gauge: { ...gauge } };
      t.correctedAt = Date.now();
    } else {
      t.snapshot = { company: { ...state.settings.company }, customer: c ? { ...c } : {}, assembly: { ...a }, tester: testerInfo, gauge: { ...gauge } };
    }
    t.rules = { ...rules };
    t.result = o.result;
    t.computedResult = o.computed;
    if (!t.createdAt) t.createdAt = Date.now();
    let saved;
    try {
      saved = await put('tests', t);
    } catch (err) {
      console.error(err);
      error.textContent = 'The report did not save. Storage on this device may be full or blocked. Your readings are still here; free some space and press save again.';
      return;
    }
    dropDraft(key);
    try {
      state.settings.lastTesterId = t.testerId;
      state.settings.lastGaugeId = t.gaugeId;
      await saveSettings('lastTesterId', 'lastGaugeId');
      const live = byId('testers', t.testerId);
      if (rememberSignature && t.signature && live) { live.signature = t.signature; await put('testers', live); }
    } catch (err) { console.warn(err); }
    toast(o.result === 'pass' ? 'Report saved: passed' : 'Report saved: failed');
    navigate(`/report/${saved.id}`);
  }

  const form = h('form', { onSubmit: save, novalidate: true, class: 'testform' },
    h('div', { class: 'grid3' },
      field('Test date', t, 'date', { type: 'date', onChange: update }),
      field('Time', t, 'time', { type: 'time', optional: true, onChange: update }),
      field('Reason', t, 'reason', { options: REASONS, onChange: update })),
    h('div', { class: 'grid2' },
      field('Tester', t, 'testerId', { options: testerOptions, onChange: () => { useSaved.hidden = !testerHasSaved(); update(); } }),
      field('Test kit', t, 'gaugeId', { options: gaugeOptions, onChange: update })),
    warnBox,
    h('div', { class: 'grid2' },
      field('Line pressure (psi)', t, 'linePressure', { inputmode: 'decimal', optional: true, maxlength: 6, onChange: update }),
      h('div', { class: 'field' },
        h('span', { class: 'label' }, 'Installed correctly ', h('span', { class: 'opt' }, 'optional')),
        segmented([[true, 'Yes'], [false, 'No']], t.installedCorrectly, (v) => { t.installedCorrectly = v; update(); }, 'Installed correctly'))),
    h('fieldset', null,
      h('legend', null, 'Initial test'),
      initialInputs.el,
      initialVerdict),
    repairSection,
    field('Remarks', t, 'remarks', { multiline: true, optional: true, onChange: update }),
    h('details', { open: !!t.override },
      h('summary', null, 'Record a different result'),
      h('p', { class: 'hint' }, 'You are the certified tester. If the readings do not tell the whole story, set the result yourself. The report states that you did and why.'),
      field('Result', t, 'override', { options: [['', 'Use the readings'], ['pass', 'Passed'], ['fail', 'Failed']], onChange: (v) => { overrideReason.hidden = !v; update(); } }),
      overrideReason),
    h('fieldset', null,
      h('legend', null, 'Tester signature'),
      pad.el,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', onClick: () => pad.clear() }, 'Clear'),
        useSaved,
        h('label', { class: 'check inline' }, h('input', { type: 'checkbox', onChange: (e) => { rememberSignature = e.currentTarget.checked; } }), 'Save for next time')),
      h('p', { class: 'hint' }, 'Sign with a finger or stylus. Leave blank to sign the printed report by hand.')),
    overallVerdict,
    error,
    h('div', { class: 'row sticky-actions' }, h('button', { class: 'btn primary big', type: 'submit' }, existing ? 'Save corrected report' : 'Save report')));

  update();
  ready = true;

  const typeChanged = existing && a.type !== type;
  return h('section', null,
    backLink(existing ? `#/report/${id}` : `#/assembly/${a.id}`, existing ? 'Report' : 'Assembly'),
    h('h1', null, existing ? 'Correct this report' : 'Test report'),
    h('p', { class: 'subject' }, h('strong', null, c ? c.name : ''), h('br'), customerAddress(c, a), h('br'), typeName(type), h('br'), deviceLine(existing ? { ...a, type } : a), a.location ? `, ${a.location}` : ''),
    restored ? h('div', { class: 'notice' }, 'Picked up where you left off. These readings were not saved as a report yet. ',
      h('button', { class: 'btn small', type: 'button', onClick: async () => { if (await confirmDialog({ title: 'Clear this form?', body: 'The unsaved readings will be discarded.', confirm: 'Clear the form', danger: true })) { dropDraft(key); rerender(); } } }, 'Start over')) : null,
    typeChanged ? h('div', { class: 'notice warn' }, `This report was made when the assembly was recorded as ${type}. It stays a ${type} report. For the assembly as it is now (${a.type}), record a new test.`) : null,
    form);
}

function setVerdict(el, evaluation, title) {
  el.className = 'verdict ' + evaluation.result;
  if (evaluation.result === 'incomplete') {
    const left = evaluation.checks.filter((c) => c.status === 'missing').length;
    setChildren(el, h('span', null, `${title}: ${left} ${left === 1 ? 'reading' : 'readings'} to go`));
    return;
  }
  const fails = evaluation.checks.filter((c) => c.status === 'fail');
  setChildren(el, 
    h('strong', null, `${title}: ${evaluation.result === 'pass' ? 'Passed' : 'Failed'}`),
    fails.length ? h('ul', null, fails.map((f) => h('li', null, `${f.label}: ${f.message}`))) : null,
    evaluation.warnings.length ? h('ul', null, evaluation.warnings.map((w) => h('li', null, 'Note: ' + w))) : null);
}

function segmented(options, current, onChange, groupLabel) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': groupLabel });
  const buttons = options.map(([value, label]) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(current === value), class: current === value ? 'on' : '' }, label);
    b.addEventListener('click', () => {
      const next = b.classList.contains('on') ? null : value;
      buttons.forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      if (next !== null) { b.classList.add('on'); b.setAttribute('aria-checked', 'true'); }
      onChange(next);
    });
    return b;
  });
  // Arrow keys move between the choices, as with any radio group.
  wrap.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = buttons[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length];
    next.focus();
    if (!next.classList.contains('on')) next.click();
  });
  wrap.append(...buttons);
  return wrap;
}

/** The reading entry block for one test (initial or after repair). */
function readingInputs(type, readings, rules, onChange, ariaPrefix = '') {
  const fields = fieldsFor(type, rules);
  const rowsByKey = new Map();
  const el = h('div', { class: 'readings' }, fields.map((f) => {
    const msg = h('p', { class: 'reading-msg' });
    let control;
    if (f.kind === 'psid') {
      const input = h('input', { type: 'text', inputmode: 'decimal', class: 'psid', 'aria-label': ariaPrefix + f.label + ' (psid)', autocomplete: 'off', placeholder: '0.0', maxlength: 6 });
      input.value = readings[f.key] ?? '';
      input.disabled = !!(f.altKey && readings[f.altKey]);
      input.addEventListener('input', () => { readings[f.key] = input.value; onChange(); });
      const alt = f.altKey ? h('label', { class: 'check inline' },
        h('input', { type: 'checkbox', checked: !!readings[f.altKey], onChange: (e) => { readings[f.altKey] = e.currentTarget.checked; input.disabled = e.currentTarget.checked; if (e.currentTarget.checked) { input.value = ''; readings[f.key] = ''; } onChange(); } }),
        f.altLabel) : null;
      control = h('div', { class: 'reading-control' }, h('div', { class: 'psid-wrap' }, input, h('span', { 'aria-hidden': 'true' }, 'psid')), alt);
    } else if (f.kind === 'tight') {
      control = h('div', { class: 'reading-control' }, segmented([[true, 'Closed tight'], [false, 'Leaked']], readings[f.key] ?? null, (v) => { if (v === null) delete readings[f.key]; else readings[f.key] = v; onChange(); }, ariaPrefix + f.label));
    } else {
      control = h('div', { class: 'reading-control' }, segmented([[true, 'Yes'], [false, 'No']], readings[f.key] ?? null, (v) => { if (v === null) delete readings[f.key]; else readings[f.key] = v; onChange(); }, ariaPrefix + f.label));
    }
    const row = h('div', { class: 'reading' },
      h('p', { class: 'reading-label' }, f.label, f.optional ? h('span', { class: 'opt' }, ' optional') : null),
      control, msg);
    rowsByKey.set(f.key, { row, msg });
    if (f.altKey) rowsByKey.set(f.altKey, { row, msg });
    return row;
  }));
  function mark(evaluation) {
    for (const { row, msg } of rowsByKey.values()) { row.dataset.status = ''; msg.textContent = ''; }
    for (const c of evaluation.checks) {
      const target = rowsByKey.get(c.key) || rowsByKey.get(c.key + 'DidNotOpen');
      if (!target) continue;
      if (c.status === 'skipped') continue;
      if (c.status === 'missing') { target.msg.textContent = 'Needs ' + c.rule.replace(/^Opens at /, '').toLowerCase(); continue; }
      target.row.dataset.status = c.status;
      target.msg.textContent = (c.status === 'pass' ? 'OK. ' : c.status === 'warn' ? 'Check. ' : 'Fails. ') + c.message + (c.hint ? ' ' + c.hint : '');
      if (c.hint && c.status === 'pass') target.row.dataset.status = 'warn';
    }
  }
  return { el, mark };
}

function signaturePad(initial, onChange) {
  const canvas = h('canvas', { class: 'sigpad', width: 900, height: 270, 'aria-label': 'Signature area', role: 'img' });
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let last = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#13212C';
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p;
  });
  const end = () => { if (!drawing) return; drawing = false; onChange(canvas.toDataURL('image/png')); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const load = (dataUrl) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = dataUrl;
  };
  if (initial) load(initial);
  return { el: canvas, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); onChange(''); }, load };
}

export function reportView(id) {
  const t = byId('tests', id);
  if (!t) return h('section', null, backLink('#/reports', 'Reports'), h('p', null, 'That report is no longer here.'));
  const rules = rulesFor(t);
  const o = testOutcome(t, rules);
  const snap = t.snapshot || {};
  const c = snap.customer || {};
  const a = snap.assembly || {};

  const makePdf = async () => new File([await buildReportPDF(t, rules)], reportFilename(t), { type: 'application/pdf' });
  const busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing…';
    try { await fn(); } catch (err) { if (err && err.name !== 'AbortError') { console.error(err); toast('The PDF could not be made: ' + (err.message || err)); } }
    btn.disabled = false; btn.textContent = label;
  };

  const canShareFiles = typeof navigator.canShare === 'function' && (() => { try { return navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; } })();

  const readingList = (title, ev) => h('div', null,
    h('h3', null, title, ' ', resultBadge(ev.result)),
    h('table', { class: 'readtable' }, h('tbody', null, ev.checks.filter((k) => k.status !== 'skipped').map((k) =>
      h('tr', { class: k.status }, h('th', { scope: 'row' }, k.label), h('td', null, k.display === '' ? '–' : (typeof k.value === 'number' ? k.display + ' psid' : k.display)), h('td', null, k.rule))))));

  return h('section', null,
    backLink(`#/assembly/${t.assemblyId}`, 'Assembly'),
    h('div', { class: `stamp ${o.result}` },
      h('strong', null, o.result === 'pass' ? 'Passed' : o.result === 'fail' ? 'Failed' : 'Incomplete'),
      h('span', null, `Tested ${formatDate(t.date)}${t.time ? ' at ' + t.time : ''}`)),
    h('p', { class: 'subject' }, h('strong', null, c.name || ''), h('br'), customerAddress(c, a), h('br'), deviceLine(a)),
    h('div', { class: 'row' },
      canShareFiles ? h('button', { class: 'btn primary', onClick: (e) => busy(e.currentTarget, async () => { const file = await makePdf(); await navigator.share({ files: [file], title: 'Backflow test report' }); }) }, 'Share PDF') : null,
      h('button', { class: 'btn' + (canShareFiles ? '' : ' primary'), onClick: (e) => busy(e.currentTarget, async () => { const file = await makePdf(); download(file.name, file); }) }, 'Download PDF'),
      h('button', { class: 'btn', onClick: () => portalValues(t, o) }, 'Copy values for a portal'),
      o.result === 'fail' ? h('a', { class: 'btn', href: `#/test/new/${t.assemblyId}` }, 'Record a retest') : null),
    o.overridden ? h('div', { class: 'notice' }, `Set by the tester as ${o.result === 'pass' ? 'passed' : 'failed'}. Readings alone indicate ${o.computed}. Reason: ${t.overrideReason}`) : null,
    readingList('Initial test', o.initial),
    t.repaired || (t.parts && t.parts.length) || t.repairNotes ? h('div', null, h('h3', null, 'Repairs'), h('p', null, [(t.parts || []).join(', '), t.repairNotes].filter(Boolean).join('. ') || 'None recorded')) : null,
    o.final ? readingList('Test after repair', o.final) : null,
    h('dl', { class: 'facts' },
      t.linePressure ? [h('dt', null, 'Line pressure'), h('dd', null, t.linePressure + ' psi')] : null,
      [h('dt', null, 'Reason'), h('dd', null, t.reason)],
      [h('dt', null, 'Tester'), h('dd', null, [snap.tester?.name, snap.tester?.certNo].filter(Boolean).join(', '))],
      [h('dt', null, 'Test kit'), h('dd', null, [snap.gauge?.make, snap.gauge?.model, snap.gauge?.serial ? '#' + snap.gauge.serial : '', snap.gauge?.verified ? 'verified ' + formatDate(snap.gauge.verified) : ''].filter(Boolean).join(' '))],
      t.remarks ? [h('dt', null, 'Remarks'), h('dd', null, t.remarks)] : null),
    filingPanel(t),
    h('div', { class: 'row' },
      h('a', { class: 'btn small', href: `#/test/${t.id}/edit` }, 'Correct this report'),
      h('button', {
        class: 'btn small danger ghost',
        onClick: async () => {
          if (!(await confirmDialog({ title: 'Delete this report?', body: 'Most water systems require test records to be kept for at least three years. Delete only a report made by mistake.', confirm: 'Delete report', danger: true }))) return;
          await remove('tests', t.id);
          toast('Report deleted');
          navigate(`/assembly/${t.assemblyId}`);
        },
      }, 'Delete report')));
}

/** Where and when the report was sent to the water system. Kept beside the report, never printed on it. */
function filingPanel(t) {
  const f = { filedOn: t.filedOn || '', filingRef: t.filingRef || '', filingFee: t.filingFee || '' };
  const error = h('p', { class: 'form-error', role: 'alert' });
  const save = async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (f.filedOn && !isISODate(f.filedOn)) { error.textContent = 'The filing date is not a real date.'; return; }
    if (f.filedOn && f.filedOn < t.date) { error.textContent = 'The filing date is before the test date.'; return; }
    const fee = String(f.filingFee).trim().replace(/^\$/, '');
    if (fee && !/^\d+(\.\d{1,2})?$/.test(fee)) { error.textContent = 'Enter the fee as an amount, such as 12.95.'; return; }
    const live = byId('tests', t.id);
    if (!live) return;
    live.filedOn = f.filedOn; live.filingRef = f.filingRef.trim(); live.filingFee = fee;
    try { await put('tests', live); } catch (err) { console.error(err); error.textContent = 'That did not save. Storage on this device may be full or blocked.'; return; }
    toast(f.filedOn ? 'Marked as filed' : 'Filing details saved');
    rerender();
  };
  return h('form', { class: 'panel', onSubmit: save, novalidate: true },
    h('h3', null, 'Filed with the water system ', t.filedOn ? h('span', { class: 'badge pass' }, `Filed ${formatDate(t.filedOn)}`) : h('span', { class: 'badge incomplete' }, 'Not filed yet')),
    h('div', { class: 'grid3' },
      field('Date filed', f, 'filedOn', { type: 'date', optional: true }),
      field('Confirmation number', f, 'filingRef', { optional: true }),
      field('Portal fee paid ($)', f, 'filingFee', { optional: true, inputmode: 'decimal', maxlength: 8 })),
    error,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'submit' }, 'Save filing details'),
      !t.filedOn ? h('button', { class: 'btn small primary', type: 'button', onClick: (e) => { f.filedOn = todayISO(); save(e); } }, 'Filed today') : null));
}

/** Values laid out for re-keying into a water system's online portal, each with a copy button. */
function portalValues(t, o) {
  const snap = t.snapshot || {};
  const a = snap.assembly || {};
  const c = snap.customer || {};
  const rows = [
    ['Account number', a.account], ['Customer', c.name], ['Service address', customerAddress(c, a)],
    ['Assembly type', a.type], ['Manufacturer', a.make], ['Model', a.model], ['Serial number', a.serial], ['Size', a.size], ['Location', a.location],
    ['Test date', t.date], ['Line pressure', t.linePressure],
  ];
  const add = (prefix, ev) => { for (const k of ev.checks) if (k.display !== '') rows.push([prefix + k.label, typeof k.value === 'number' ? k.display : k.display]); };
  add(o.final ? 'Initial: ' : '', o.initial);
  if (o.final) add('After repair: ', o.final);
  rows.push(['Result', o.result === 'pass' ? 'Pass' : 'Fail'],
    ['Tester', snap.tester?.name], ['Certification number', snap.tester?.certNo],
    ['Test kit serial', snap.gauge?.serial], ['Test kit verified', snap.gauge?.verified], ['Remarks', t.remarks]);
  sheet('Values for the portal',
    h('div', null,
      h('p', { class: 'hint' }, 'Tap a value to copy it, then paste it into the water system’s form.'),
      h('ul', { class: 'copylist' }, rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, value]) =>
        h('li', null, h('button', {
          type: 'button',
          onClick: async (e) => {
            try { await navigator.clipboard.writeText(String(value)); toast(`${label} copied`); e.currentTarget.classList.add('copied'); } catch { toast('Copying is blocked in this browser'); }
          },
        }, h('span', null, label), h('strong', null, String(value))))))));
}
