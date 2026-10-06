// End-to-end check in a real browser: the full tester journey, then offline.
//   node e2e/smoke.mjs            (needs Playwright with Chromium available)
// Serves ./app on a local port itself. Screenshots go to e2e/shots/.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'app');
const shots = join(here, 'shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
await mkdir(shots, { recursive: true });

let failures = 0;
const ok = (cond, label) => { if (cond) console.log('  ok  ' + label); else { failures++; console.log('  FAIL ' + label); } };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(base);
  await page.getByRole('heading', { name: 'Nothing is due yet' }).waitFor();
  await page.screenshot({ path: join(shots, '01-empty.png') });

  // Settings: company, tester, test kit
  await page.goto(base + '#/settings/company');
  await page.getByLabel('Company name').fill('Ace Backflow Testing');
  await page.getByLabel('Phone').fill('(512) 555-0100');
  await page.getByRole('button', { name: 'Save company' }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.goto(base + '#/settings/testers');
  await page.getByRole('button', { name: 'Add tester' }).click();
  await page.getByLabel('Name').fill('Sam Lee');
  await page.getByLabel('Certification or licence number').fill('BP0099');
  await page.getByLabel('Certification expires').fill('2028-01-31');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Sam Lee').waitFor();
  await page.goto(base + '#/settings/gauges');
  await page.getByRole('button', { name: 'Add test kit' }).click();
  await page.getByLabel('Make').fill('Mid-West');
  await page.getByLabel('Serial number').fill('G-7781');
  const lastYear = new Date(); lastYear.setMonth(lastYear.getMonth() - 14);
  await page.getByLabel('Accuracy last verified').fill(lastYear.toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Mid-West').waitFor();
  ok(true, 'tester and test kit saved');

  // Customer and assembly
  await page.goto(base + '#/customer/new');
  await page.getByLabel('Customer or business name').fill('Oak Street Dental');
  await page.getByLabel('Email').fill('front@oakdental.example');
  await page.getByLabel('Street address').fill('12 Oak St');
  await page.getByLabel('City').fill('Austin');
  await page.getByRole('button', { name: 'Save and add an assembly' }).click();
  await page.getByRole('heading', { name: /Add an assembly/ }).waitFor();
  await page.getByLabel('Manufacturer', { exact: true }).fill('Watts');
  await page.getByLabel('Model', { exact: true }).fill('009M2');
  await page.getByLabel('Serial number', { exact: true }).fill('A148822');
  await page.getByLabel('Size', { exact: true }).fill('3/4 in');
  await page.getByLabel('Where it is on the property').fill('Mechanical closet');
  await page.getByRole('button', { name: 'Save assembly' }).click();
  await page.getByRole('link', { name: 'Start test' }).click();
  await page.getByRole('heading', { name: 'Test report' }).waitFor();

  // Stale gauge warning shows
  ok(await page.getByText(/Test kit accuracy was last verified/).count() === 1, 'warns that the test kit verification is out of date');

  // Failing readings show live, with reasons
  await page.getByLabel('Relief valve opened at (psid)', { exact: true }).fill('1.4');
  await page.getByLabel('Check valve 1 held at (psid)', { exact: true }).fill('4.2');
  await page.getByRole('radiogroup', { name: 'Check valve 2', exact: true }).getByRole('radio', { name: 'Closed tight' }).click();
  ok(await page.getByText('Initial test: Failed').count() === 1, 'live verdict: failed');
  ok(await page.getByText(/1\.4 psid is below the 2\.0 psid minimum/).count() >= 1, 'explains why the relief valve reading fails');
  await page.screenshot({ path: join(shots, '02-failing-readings.png'), fullPage: true });

  // Leaving the form by accident must not lose the readings
  await page.getByRole('link', { name: 'Customers' }).click();
  await page.getByRole('heading', { name: 'Customers' }).waitFor();
  await page.goBack();
  await page.getByText('Picked up where you left off').waitFor();
  ok(await page.getByLabel('Relief valve opened at (psid)', { exact: true }).inputValue() === '1.4', 'unsaved readings come back after leaving the form');

  // Ticking "repaired" without retest readings cannot be saved as a finished report
  await page.getByLabel('I repaired it and tested it again on this visit').check();
  await page.getByRole('button', { name: 'Save report' }).click();
  ok((await page.locator('.testform > .form-error').innerText()).includes('test after repair'), 'a repair with no retest readings is not accepted');
  await page.getByLabel('I repaired it and tested it again on this visit').uncheck();

  // Repair and retest
  await page.getByLabel('I repaired it and tested it again on this visit').check();
  await page.getByRole('button', { name: 'Rubber kit' }).click();
  const final = page.locator('.repairs');
  await final.getByLabel('After repair: Relief valve opened at (psid)').fill('2.8');
  await final.getByLabel('After repair: Check valve 1 held at (psid)').fill('7.2');
  await final.getByRole('radiogroup', { name: 'After repair: Check valve 2' }).getByRole('radio', { name: 'Closed tight' }).click();
  ok(await page.getByText('This report will say: Passed').count() === 1, 'after repair the report will pass');

  // Sign
  const pad = page.locator('canvas.sigpad');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 18, box.y + 60 + Math.sin(i) * 25);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save report' }).click();
  await page.locator('.stamp.pass').waitFor();
  ok(true, 'report saved and shown as passed');
  await page.screenshot({ path: join(shots, '03-report.png'), fullPage: true });

  // PDF
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  const pdfPath = join(shots, 'sample-report.pdf');
  await dl.saveAs(pdfPath);
  const pdf = await readFile(pdfPath);
  ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 3000, `PDF downloaded (${dl.suggestedFilename()}, ${pdf.length} bytes)`);

  // Filing record
  await page.getByRole('button', { name: 'Filed today' }).click();
  await page.getByText(/^Filed /).first().waitFor();
  ok(await page.evaluate(async () => !!(await import('./src/store.js')).state.tests[0].filedOn), 'report can be marked as filed');

  // Portal values
  await page.getByRole('button', { name: 'Copy values for a portal' }).click();
  ok(await page.locator('.copylist li').count() > 10, 'portal value list opens');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // A saved report must not change when settings change later
  const reportUrl = page.url();
  await page.goto(base + '#/settings/rules');
  await page.getByLabel('RP: how check valve 2 is recorded').selectOption('yes');
  await page.getByLabel('RP: buffer between check 1 and the relief valve').selectOption('fail');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.goto(reportUrl);
  await page.locator('.stamp').waitFor();
  ok(await page.locator('.stamp.pass').count() === 1, 'the saved report still reads Passed after the rules were changed');
  await page.goto(base + '#/settings/rules');
  await page.getByRole('button', { name: 'Reset to the defaults' }).click();
  await page.getByText('Rules reset to the defaults').waitFor();

  // Changing the assembly type later must not let a correction store a wrong result
  await page.goto(reportUrl);
  await page.getByRole('link', { name: /Assembly/ }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Assembly type').selectOption('DC');
  await page.getByRole('button', { name: 'Save assembly' }).click();
  await page.getByText('Assembly saved').waitFor();
  await page.goto(reportUrl);
  await page.getByRole('link', { name: 'Correct this report' }).click();
  await page.getByText(/It stays a RP report/).waitFor();
  ok(await page.getByLabel('Relief valve opened at (psid)', { exact: true }).count() === 1, 'correcting an old report keeps its original assembly type');
  await page.getByRole('button', { name: 'Save corrected report' }).click();
  await page.locator('.stamp.pass').waitFor();
  const stored = await page.evaluate(async () => { const { state } = await import('./src/store.js'); const t = state.tests[0]; return { type: t.assemblyType, result: t.result, snapType: t.snapshot.assembly.type }; });
  ok(stored.type === 'RP' && stored.result === 'pass' && stored.snapType === 'RP', 'the corrected report is stored as RP / passed, matching what it shows');
  await page.goto(base + '#/assembly/' + (await page.evaluate(async () => (await import('./src/store.js')).state.assemblies[0].id)) + '/edit');
  await page.getByLabel('Assembly type').selectOption('RP');
  await page.getByRole('button', { name: 'Save assembly' }).click();
  await page.getByText('Assembly saved').waitFor();

  // Due board: next due one year on
  await page.goto(base + '#/due');
  await page.getByRole('button', { name: /^All/ }).click();
  ok(await page.locator('.tag.ok').count() === 1, 'assembly now shows as current, due next year');

  // Sample data on a second customer set, reminder sheet
  await page.goto(base + '#/settings/data');
  ok(await page.getByRole('button', { name: 'Load sample records' }).count() === 0, 'sample loader hidden once real customers exist');

  // CSV import
  const csv = 'Customer,Address,City,Email,Type,Manufacturer,Serial,Last test date\nPine Cafe,4 Pine Rd,Austin,pine@cafe.example,DCVA,Febco,B200,' + (() => { const d = new Date(); d.setMonth(d.getMonth() - 12); d.setDate(d.getDate() + 10); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; })() + '\nElm School,7 Elm Ave,Austin,,RPZ,Watts,C300,1/5/2024\n';
  const csvPath = join(shots, 'import.csv');
  await writeFile(csvPath, csv);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import a CSV file' }).click()]);
  await chooser.setFiles(csvPath);
  await page.getByRole('button', { name: 'Add them' }).click();
  await page.getByText(/Added 2 customers and 2 assemblies/).waitFor();
  ok(true, 'spreadsheet import added 2 customers and 2 assemblies');

  await page.goto(base + '#/due');
  await page.locator('.tag.overdue').first().waitFor();
  ok(await page.locator('.tag.overdue').count() === 1 && await page.locator('.tag.soon').count() === 1, 'due board shows one overdue and one due within 30 days');
  await page.screenshot({ path: join(shots, '04-due-board.png'), fullPage: true });
  await page.locator('.tag.soon').getByRole('button', { name: 'Remind' }).click();
  ok((await page.getByLabel('Message').inputValue()).includes('4 Pine Rd'), 'reminder message is filled in for the customer');
  await page.screenshot({ path: join(shots, '05-reminder.png') });
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Backup round trip
  const [bk] = await Promise.all([page.waitForEvent('download'), (async () => { await page.goto(base + '#/settings/data'); await page.getByRole('button', { name: 'Save a backup file' }).click(); })()]);
  const bkPath = join(shots, 'backup.json');
  await bk.saveAs(bkPath);
  const backup = JSON.parse(await readFile(bkPath, 'utf8'));
  ok(backup.customers.length === 3 && backup.tests.length === 1, 'backup file holds 3 customers and 1 report');

  // Offline: wait for the service worker, cut the network, reload, records still there
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await context.setOffline(true);
  await page.reload();
  await page.goto(base + '#/reports');
  await page.getByRole('heading', { name: 'Reports' }).waitFor();
  ok(await page.getByText('Oak Street Dental').count() >= 1, 'works with the network off: app loads and the report is there');
  const [dl2] = await Promise.all([page.waitForEvent('download'), (async () => { await page.getByText('Oak Street Dental').first().click(); await page.getByRole('button', { name: 'Download PDF' }).click(); })()]);
  ok((await dl2.path()) !== null, 'PDF is built with the network off');
  await context.setOffline(false);

  // Restore the backup into a clean browser profile
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('ctx2 ' + String(e)));
  await p2.goto(base + '#/settings/data');
  const [ch2] = await Promise.all([p2.waitForEvent('filechooser'), p2.getByRole('button', { name: 'Restore from a backup' }).click()]);
  await ch2.setFiles(bkPath);
  await p2.getByRole('button', { name: 'Replace with backup' }).click();
  await p2.getByRole('heading', { name: 'What is due' }).waitFor();
  await p2.getByRole('button', { name: /^All/ }).click();
  ok(await p2.locator('.tag').count() === 3, 'backup restores on a second device');
  await p2.screenshot({ path: join(shots, '06-desktop-due.png'), fullPage: true });

  // Trial limit and licence gate
  await p2.evaluate(async () => {
    const { state, putMany } = await import('./src/store.js');
    const t = state.tests[0];
    await putMany('tests', Array.from({ length: 14 }, (_, i) => ({ ...structuredClone(t), id: 'filler-' + i })));
  });
  await p2.reload();
  await p2.getByRole('button', { name: /^All/ }).click();
  await p2.getByRole('link', { name: 'Start test' }).first().click();
  await p2.getByRole('heading', { name: 'The free trial is used up' }).waitFor({ timeout: 5000 });
  ok(true, 'new reports are blocked after 15 trial reports');
  await p2.goto(base + '#/reports');
  ok(await p2.locator('.rows li').count() === 15, 'saved reports stay readable after the trial');
  if (process.env.TAGDUE_TEST_KEY) {
    await p2.goto(base + '#/settings/licence');
    await p2.getByLabel('Licence key').fill('TD1.bogus.key');
    await p2.getByRole('button', { name: 'Save licence key' }).click();
    ok(await p2.locator('.form-error').innerText() !== '', 'a bad licence key is refused');
    await p2.getByLabel('Licence key').fill(process.env.TAGDUE_TEST_KEY);
    await p2.getByRole('button', { name: 'Save licence key' }).click();
    await p2.getByText(/^Licensed/).waitFor();
    await p2.goto(base + '#/due');
    await p2.getByRole('button', { name: /^All/ }).click();
    await p2.getByRole('link', { name: 'Start test' }).first().click();
    await p2.getByRole('heading', { name: 'Test report' }).waitFor({ timeout: 5000 });
    ok(true, 'a real licence key unlocks new reports');
  }
  await ctx2.close();

  ok(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (err) {
  failures++;
  console.log('  FAIL stopped early: ' + err.message.split('\n')[0]);
  await page.screenshot({ path: join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  if (errors.length) console.log('  console errors: ' + errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
