import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, toCSV, importRows, normaliseType, normaliseDate } from '../app/src/domain/csv.js';

test('parse handles quotes, commas, newlines, BOM and CRLF', () => {
  const rows = parseCSV('﻿a,b\r\n"x, y","he said ""hi"""\r\n"line\nbreak",z\r\n\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['line\nbreak', 'z']]);
});

test('round trip', () => {
  const rows = [['name', 'note'], ['A & B, Inc.', 'say "hi"\nplease'], ['', '5']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});

test('export neutralises spreadsheet formulas but not negative numbers', () => {
  assert.equal(toCSV([['=SUM(A1)', '-5.2', '+1 555']]), "'=SUM(A1),-5.2,'+1 555\r\n");
});

test('type and date normalising', () => {
  assert.equal(normaliseType('RPZ'), 'RP');
  assert.equal(normaliseType('Reduced Pressure Principle'), 'RP');
  assert.equal(normaliseType('dcva'), 'DC');
  assert.equal(normaliseType('Double Check Detector'), 'DCDA');
  assert.equal(normaliseType('RPDA-II'), 'RPDA-II');
  assert.equal(normaliseType('SRPVB'), 'SVB');
  assert.equal(normaliseType('PVB'), 'PVB');
  assert.equal(normaliseType('mystery'), '');
  assert.equal(normaliseDate('3/7/2026'), '2026-03-07');
  assert.equal(normaliseDate('03-07-26'), '2026-03-07');
  assert.equal(normaliseDate('2026-03-07'), '2026-03-07');
  assert.equal(normaliseDate('2/30/2026'), '');
  assert.equal(normaliseDate('soon'), '');
});

test('import groups devices under one customer and reports problems', () => {
  let n = 0;
  const id = () => 'id' + (++n);
  const rows = parseCSV([
    'Customer Name,Service Address,City,Email,Device Type,Manufacturer,Serial Number,Last Test Date,Gate code',
    'Oak Dental,12 Oak St,Austin,front@oak.example,RPZ,Watts,A100,10/20/2025,1234',
    'Oak Dental,12 Oak St,Austin,,DCVA,Febco,B200,10/20/2025,',
    ',99 Nowhere,,,RP,,,,',
    'Pine Cafe,4 Pine Rd,Austin,,Whatsit,Zurn,C300,,',
    'Elm School,7 Elm Ave,Austin,,,,,,',
  ].join('\n'));
  const out = importRows(rows, id);
  assert.equal(out.customers.length, 3);
  assert.equal(out.assemblies.length, 3);
  assert.equal(out.assemblies[0].type, 'RP');
  assert.equal(out.assemblies[0].lastTestedImported, '2025-10-20');
  assert.equal(out.assemblies[1].customerId, out.customers[0].id);
  assert.equal(out.assemblies[2].type, 'RP');
  assert.equal(out.skipped.length, 2);
  assert.deepEqual(out.unmapped, ['Gate code']);
});

test('import without a customer column explains itself', () => {
  const out = importRows([['Serial'], ['1']], () => 'x');
  assert.equal(out.customers.length, 0);
  assert.match(out.skipped[0].reason, /Customer/);
});

test('an inch mark inside a field does not swallow the following rows', () => {
  assert.deepEqual(parseCSV('Acme,2",Front\nBeta,1",Back\n'), [['Acme', '2"', 'Front'], ['Beta', '1"', 'Back']]);
});

test('dates: trailing time accepted, two-digit years resolved to the past, junk reported', () => {
  assert.equal(normaliseDate('10/6/2026 14:00'), '2026-10-06');
  assert.equal(normaliseDate('2026-10-06T09:00:00'), '2026-10-06');
  assert.equal(normaliseDate('5/6/27'), '2027-05-06'); // read as 20xx; a future date is rejected on import
  assert.equal(normaliseDate('1/2/26'), '2026-01-02');
  assert.equal(normaliseDate('13/01/2025'), '');
  assert.equal(normaliseDate('45931'), '');
  const rows = parseCSV('Customer,Type,Serial,Last test date\nA,RP,1,Jan 5 2025\nB,RP,2,1/1/2099\nC,RP,3,3/3/2025\n');
  const out = importRows(rows, (() => { let n = 0; return () => 'i' + (++n); })(), undefined, '2026-10-06');
  assert.equal(out.assemblies[0].lastTestedImported, '');
  assert.equal(out.assemblies[1].lastTestedImported, '');
  assert.equal(out.assemblies[2].lastTestedImported, '2025-03-03');
  assert.equal(out.skipped.length, 2);
  assert.equal(out.rowsRead, 3);
});

test('detector and variant type names map correctly; blank type is flagged', () => {
  assert.equal(normaliseType('Reduced Pressure Principle Detector Assembly'), 'RPDA');
  assert.equal(normaliseType('RPDA-II (bypass)'), 'RPDA-II');
  assert.equal(normaliseType('DCDA II'), 'DCDA-II');
  assert.equal(normaliseType('Double Check Detector Assembly Type II'), 'DCDA-II');
  assert.equal(normaliseType('RPZA'), 'RP');
  assert.equal(normaliseType('DCV'), 'DC');
  assert.equal(normaliseType('AVB'), '');
  const out = importRows(parseCSV('Customer,Type,Serial\nA,,77\n'), () => Math.random().toString(36));
  assert.match(out.skipped[0].reason, /No assembly type/);
});

test('re-importing does not duplicate; apostrophe guards are removed; bad emails dropped; in-service read back', () => {
  let n = 0; const id = () => 'n' + (++n);
  const csv = "Customer,Address,Email,Phone,Type,Manufacturer,Serial,In service\nOak Dental,12 Oak St,front@oak.example,'+1 512 555 0100,RP,Watts,A100,No\nPine Cafe,4 Pine Rd,a@b.co?bcc=x@y.z,,DC,Febco,B200,Yes\n";
  const first = importRows(parseCSV(csv), id);
  assert.equal(first.customers[0].phone, '+1 512 555 0100');
  assert.equal(first.customers[1].email, '');
  assert.equal(first.assemblies[0].active, false);
  assert.equal(first.assemblies[1].active, true);
  const again = importRows(parseCSV(csv), id, { customers: first.customers, assemblies: first.assemblies });
  assert.equal(again.customers.length, 0);
  assert.equal(again.assemblies.length, 0);
  // A new device for an existing customer attaches to that customer.
  const more = importRows(parseCSV('Customer,Address,Type,Manufacturer,Serial\nOak Dental,12 Oak St,PVB,Febco,C300\n'), id, { customers: first.customers, assemblies: first.assemblies });
  assert.equal(more.customers.length, 0);
  assert.equal(more.assemblies[0].customerId, first.customers[0].id);
});
