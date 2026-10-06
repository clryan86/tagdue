import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportPDF, safeText, reportFilename } from '../app/src/pdf.js';

const base = {
  id: '3f2b8c1e-aaaa', assemblyType: 'RP', date: '2026-10-06', time: '09:15', reason: 'Annual test', linePressure: '62',
  initial: { rv: '2.6', cv1: '6.4', cv2Tight: true, so2Tight: true }, parts: [], final: {}, remarks: '', result: 'pass',
  snapshot: {
    company: { name: 'Ace Backflow', address: '1 Main St', cityStateZip: 'Austin, TX 78701', phone: '555-0100', email: 'a@ace.example' },
    customer: { name: 'Oak Dental', contact: 'Pat', phone: '555-0111', email: 'o@oak.example', address: '12 Oak St', city: 'Austin', state: 'TX', zip: '78702' },
    assembly: { type: 'RP', make: 'Watts', model: '009M2', serial: 'A100', size: '3/4 in', location: 'Mechanical room', purveyor: 'City water', account: '12345' },
    tester: { name: 'Sam Lee', certNo: 'BP001', certBody: 'TCEQ', certExpires: '2027-05-01' },
    gauge: { make: 'Mid-West', model: '845-5', serial: 'G77', verified: '2026-03-01' },
  },
};

async function pageCount(bytes) {
  const { PDFDocument } = await import('../app/vendor/pdf-lib.esm.min.js');
  return (await PDFDocument.load(bytes)).getPageCount();
}

test('builds a one-page PDF for a normal passing test', async () => {
  const bytes = await buildReportPDF(base);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  assert.equal(await pageCount(bytes), 1);
});

test('handles a failed test with repairs, retest, override, long and odd text', async () => {
  const t = structuredClone(base);
  t.assemblyType = 'RPDA'; t.snapshot.assembly.type = 'RPDA';
  t.snapshot.assembly.bypassSerial = 'B-1';
  t.initial = { rv: '1.2', cv1: '3.0', cv2Tight: false, bp_rv: '2.2', bp_cv1: '5.5', bp_cv2Tight: true };
  t.repaired = true; t.parts = ['Rubber kit', 'Spring'];
  t.repairNotes = 'Replaced “everything” — café line ≥ spec \u{1F6B0} 中文\n' + 'word '.repeat(400) + 'x'.repeat(500);
  t.final = { rv: '2.8', cv1: '7.1', cv2Tight: true, bp_rv: '2.4', bp_cv1: '6.0', bp_cv2Tight: true };
  t.override = 'fail'; t.overrideReason = 'Body is cracked';
  t.remarks = 'Line 1\nLine 2\tTabbed';
  t.snapshot.customer.name = 'A'.repeat(300);
  const bytes = await buildReportPDF(t);
  assert.ok((await pageCount(bytes)) >= 2);
});

test('tolerates missing snapshot, empty readings and a bad signature', async () => {
  const bytes = await buildReportPDF({ id: 'x', assemblyType: 'DC', date: '2026-10-06', initial: {}, signature: 'data:image/png;base64,AAAA' });
  assert.equal(await pageCount(bytes), 1);
});

test('safeText keeps Latin-1 and replaces what the font cannot draw', () => {
  assert.equal(safeText('café “ok” — ≥ 5'), 'café "ok" - >= 5');
  assert.equal(safeText('中'), '?');
  assert.equal(safeText(null), '');
});

test('report file names are safe', () => {
  assert.equal(reportFilename(base), 'backflow-test-2026-10-06-Oak-Dental-A100.pdf');
  assert.equal(reportFilename({ date: '2026-10-06', snapshot: { customer: { name: '../../etc' } } }), 'backflow-test-2026-10-06-etc.pdf');
});
