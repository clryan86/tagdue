// Builds the test report PDF on the device. No network involved.
import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib.esm.min.js';
import { testOutcome, ASSEMBLY_TYPES } from './domain/rules.js';
import { formatDate } from './domain/due.js';

const INK = rgb(0.075, 0.13, 0.17);
const MUTED = rgb(0.35, 0.42, 0.47);
const LINE = rgb(0.78, 0.82, 0.85);
const PASS = rgb(0.106, 0.478, 0.263);
const FAIL = rgb(0.706, 0.149, 0.122);
const BAND = rgb(0.94, 0.955, 0.965);

// The built-in PDF fonts cover Windows-1252 only. Swap common typographic
// characters and drop anything else so a stray character can never break a report.
export function safeText(v) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[\t\r]/g, ' ');
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff)) out += ch;
    else out += '?';
  }
  return out;
}

export function typeName(code) {
  const t = ASSEMBLY_TYPES.find((x) => x.code === code);
  return t ? t.name : code;
}

export function reportFilename(test) {
  const snap = test.snapshot || {};
  const who = (snap.customer?.name || 'report').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';
  const serial = (snap.assembly?.serial || '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 20);
  return `backflow-test-${test.date}-${who}${serial ? '-' + serial : ''}.pdf`;
}

export async function buildReportPDF(test, rules) {
  const outcome = testOutcome(test, rules);
  const snap = test.snapshot || {};
  const company = snap.company || {};
  const customer = snap.customer || {};
  const asm = snap.assembly || {};
  const tester = snap.tester || {};
  const gauge = snap.gauge || {};

  const doc = await PDFDocument.create();
  doc.setTitle(safeText(`Backflow test report ${test.date} ${customer.name || ''}`));
  doc.setCreator('TagDue');
  doc.setProducer('TagDue');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 612, H = 792, M = 42;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (str, x, yy, size = 9.5, f = font, color = INK) => {
    page.drawText(safeText(str), { x, y: yy, size, font: f, color });
  };
  const fit = (str, f, size, maxW) => {
    let s = safeText(str).replace(/\n/g, ' ');
    if (f.widthOfTextAtSize(s, size) <= maxW) return s;
    while (s.length > 1 && f.widthOfTextAtSize(s + '...', size) > maxW) s = s.slice(0, -1);
    return s + '...';
  };
  const wrap = (str, f, size, maxW) => {
    const lines = [];
    for (const para of safeText(str).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        let w = word;
        while (f.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
          if (line) { lines.push(line); line = ''; }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const trial = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(trial, size) > maxW && line) { lines.push(line); line = w; } else line = trial;
      }
      lines.push(line);
    }
    return lines;
  };
  const need = (h) => {
    if (y - h < M + 14) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const section = (title) => {
    need(40);
    y -= 4;
    page.drawRectangle({ x: M, y: y - 15, width: W - 2 * M, height: 17, color: BAND });
    text(title, M + 6, y - 11, 9.5, bold);
    y -= 23;
  };
  // Label/value pairs laid out in columns.
  const grid = (pairs, cols = 3) => {
    const colW = (W - 2 * M) / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      need(24);
      pairs.slice(i, i + cols).forEach(([label, value], c) => {
        const x = M + c * colW + 6;
        text(label, x, y, 7.5, font, MUTED);
        text(fit(value || '-', font, 10, colW - 12), x, y - 12, 10);
      });
      y -= 24;
    }
  };

  // Header
  text(fit(company.name || 'Backflow testing', bold, 15, 330), M, y - 6, 15, bold);
  const companyLines = [company.address, company.cityStateZip, [company.phone, company.email].filter(Boolean).join('   '), company.contractorLicense ? 'License ' + company.contractorLicense : ''].filter(Boolean);
  let cy = y - 20;
  for (const l of companyLines) { text(fit(l, font, 8.5, 330), M, cy, 8.5, font, MUTED); cy -= 11; }

  const stampColor = outcome.result === 'pass' ? PASS : outcome.result === 'fail' ? FAIL : MUTED;
  const stampText = outcome.result === 'pass' ? 'PASSED' : outcome.result === 'fail' ? 'FAILED' : 'INCOMPLETE';
  const sw = 150, sh = 44, sx = W - M - sw, sy = y - sh + 8;
  page.drawRectangle({ x: sx, y: sy, width: sw, height: sh, borderColor: stampColor, borderWidth: 2 });
  const tw = bold.widthOfTextAtSize(stampText, 20);
  text(stampText, sx + (sw - tw) / 2, sy + 20, 20, bold, stampColor);
  const sub = outcome.overridden ? 'Tester determination, see below' : `Tested ${formatDate(test.date)}${test.time ? ' ' + test.time : ''}`;
  text(sub, sx + (sw - font.widthOfTextAtSize(safeText(sub), 8)) / 2, sy + 7, 8, font, MUTED);

  y = Math.min(cy, sy) - 10;
  text('Backflow prevention assembly test report', M, y, 12, bold);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: INK });
  y -= 12;

  section('Water system and customer');
  grid([
    ['Water system', asm.purveyor],
    ['Account / customer no.', asm.account],
    ['Reason for test', [test.reason, formatDate(test.date)].filter(Boolean).join(', ')],
    ['Customer', customer.name],
    ['Contact', customer.contact],
    ['Phone', customer.phone],
  ]);
  grid([
    ['Service address', [asm.serviceAddress || customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')],
    ['Email', customer.email],
  ], 2);

  section('Assembly');
  grid([
    ['Type', typeName(asm.type)],
    ['Location', asm.location],
  ], 2);
  grid([
    ['Manufacturer', asm.make],
    ['Model', asm.model],
    ['Serial number', asm.serial],
    ['Size', asm.size],
    ['Serves', asm.serves],
    ['Hazard', asm.hazard],
    ['Line pressure', test.linePressure ? test.linePressure + ' psi' : ''],
    ['Installed correctly', test.installedCorrectly === true ? 'Yes' : test.installedCorrectly === false ? 'No' : ''],
  ]);
  if (asm.bypassSerial || asm.bypassMake || asm.bypassModel) {
    grid([
      ['Bypass manufacturer', asm.bypassMake],
      ['Bypass model / size', [asm.bypassModel, asm.bypassSize].filter(Boolean).join(' / ')],
      ['Bypass serial number', asm.bypassSerial],
    ]);
  }
  const readingsTable = (title, evaluation) => {
    section(title);
    const cols = [M + 6, M + 230, M + 330, M + 470];
    text('Component', cols[0], y, 7.5, font, MUTED);
    text('Reading', cols[1], y, 7.5, font, MUTED);
    text('Required', cols[2], y, 7.5, font, MUTED);
    text('Result', cols[3], y, 7.5, font, MUTED);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
    y -= 13;
    for (const c of evaluation.checks) {
      if (c.status === 'skipped') continue;
      need(16);
      text(fit(c.label, font, 10, 215), cols[0], y, 10);
      const reading = c.display === '' ? '-' : (typeof c.value === 'number' ? c.display + ' psid' : c.display);
      text(reading, cols[1], y, 10, bold);
      text(fit(c.rule, font, 9, 132), cols[2], y, 9, font, MUTED);
      const label = c.status === 'pass' ? 'OK' : c.status === 'warn' ? 'See note' : c.status === 'fail' ? 'FAIL' : '-';
      text(label, cols[3], y, 10, bold, c.status === 'fail' ? FAIL : c.status === 'pass' ? PASS : MUTED);
      y -= 14;
    }
    for (const wmsg of evaluation.warnings) {
      for (const l of wrap('Note: ' + wmsg, font, 8.5, W - 2 * M - 12)) { need(12); text(l, M + 6, y, 8.5, font, MUTED); y -= 11; }
    }
    need(16);
    const verdict = evaluation.result === 'pass' ? 'Passed' : evaluation.result === 'fail' ? 'Failed' : 'Incomplete';
    text(`${title}: ${verdict}`, M + 6, y - 2, 10, bold, evaluation.result === 'pass' ? PASS : evaluation.result === 'fail' ? FAIL : MUTED);
    y -= 14;
  };

  readingsTable('Initial test', outcome.initial);

  if (test.repaired || test.repairNotes || (test.parts && test.parts.length)) {
    section('Repairs and maintenance');
    const parts = (test.parts || []).join(', ');
    if (parts) { need(14); text('Parts and work: ' + fit(parts, font, 10, W - 2 * M - 90), M + 6, y, 10); y -= 14; }
    if (test.repairNotes) {
      for (const l of wrap(test.repairNotes, font, 10, W - 2 * M - 12)) { need(13); text(l, M + 6, y, 10); y -= 13; }
    }
    if (test.repairedBy) { need(14); text('Repaired by: ' + fit(test.repairedBy, font, 10, 400), M + 6, y, 10); y -= 14; }
  }
  if (outcome.final) readingsTable('Test after repair', outcome.final);

  if (outcome.overridden) {
    section('Tester determination');
    const msg = `The tester recorded this test as ${outcome.result === 'pass' ? 'PASSED' : 'FAILED'}. Readings alone indicate ${outcome.computed}. Reason: ${test.overrideReason || 'not given'}`;
    for (const l of wrap(msg, font, 10, W - 2 * M - 12)) { need(13); text(l, M + 6, y, 10); y -= 13; }
  }

  if (test.remarks) {
    section('Remarks');
    for (const l of wrap(test.remarks, font, 10, W - 2 * M - 12)) { need(13); text(l, M + 6, y, 10); y -= 13; }
  }

  section('Test kit and tester');
  grid([
    ['Test kit make and model', [gauge.make, gauge.model].filter(Boolean).join(' ')],
    ['Test kit serial number', gauge.serial],
    ['Accuracy last verified', formatDate(gauge.verified)],
    ['Tester', tester.name],
    ['Certification no.', [tester.certNo, tester.certBody].filter(Boolean).join(', ')],
    ['Certification expires', formatDate(tester.certExpires)],
  ]);

  need(82);
  y -= 6;
  const statement = 'I certify that I tested this assembly on the date shown using an accuracy-verified test kit, following the field test procedure accepted by the water system, and that the readings recorded here are true and correct.';
  for (const l of wrap(statement, font, 8.5, W - 2 * M - 12)) { text(l, M + 6, y, 8.5, font, MUTED); y -= 11; }
  y -= 6;
  const sigTop = y;
  if (test.signature && /^data:image\/png;base64,/.test(test.signature)) {
    try {
      const png = await doc.embedPng(test.signature);
      const maxW = 190, maxH = 36;
      const scale = Math.min(maxW / png.width, maxH / png.height);
      page.drawImage(png, { x: M + 6, y: sigTop - maxH, width: png.width * scale, height: png.height * scale });
    } catch { /* an unreadable signature leaves the line blank for a wet signature */ }
  }
  y = sigTop - 40;
  page.drawLine({ start: { x: M + 6, y }, end: { x: M + 230, y }, thickness: 0.7, color: INK });
  page.drawLine({ start: { x: M + 280, y }, end: { x: M + 430, y }, thickness: 0.7, color: INK });
  text('Tester signature', M + 6, y - 10, 7.5, font, MUTED);
  text('Date', M + 280, y - 10, 7.5, font, MUTED);
  text(formatDate(test.date), M + 284, y + 4, 10);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const foot = safeText(`${company.name || ''}   Report ${String(test.id || '').slice(0, 8)}   Page ${i + 1} of ${pages.length}`);
    p.drawText(foot, { x: M, y: 24, size: 7.5, font, color: MUTED });
    p.drawText('Prepared with TagDue', { x: W - M - font.widthOfTextAtSize('Prepared with TagDue', 7.5), y: 24, size: 7.5, font, color: MUTED });
  });

  return doc.save();
}
