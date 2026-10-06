# TagDue

Test reports and due-date tracking for independent backflow testers. It runs
in a phone, tablet or desktop browser, installs to the home screen, and keeps
working with no signal.

- `index.html`, `privacy.html`, `site.css`: the public landing and privacy pages
- `app/`: the application (open `app/` in a browser)

## What it does

- **Checks readings as they are typed.** RP, DC, PVB, SVB, RPDA, DCDA and the
  Type II detector assemblies. Defaults: RP relief valve opens at 2.0 psid or
  more, RP check 1 holds 5.0 psid or more and above the relief opening point,
  DC checks and vacuum-breaker checks and air inlets at 1.0 psid or more.
  The RP 3.0 psid buffer, numeric RP check 2 and the Type II bypass minimum
  differ between jurisdictions and are settings.
- **Warns about paperwork problems**: test kit accuracy verification older
  than 12 months, tester certification expired on the test date.
- **Reports do not change after the fact.** Each saved report keeps the
  rules, assembly type, customer, tester and test kit details it was made
  with; later edits to settings or records do not alter it.
- **Unsaved readings survive** leaving the form, a phone call or a reload.
- **Initial test, repairs, test after repair** on one report, with the
  tester's signature, as a PDF built on the device.
- **Due board**: failed, overdue, next 30 days, 31 to 60 days. Reminder
  messages open in the tester's own email or text app.
- **Filing record**: date filed, confirmation number and portal fee per
  report, with a "not filed yet" list.
- **Values for a portal**: every reported value with a copy button, for
  re-keying into a water system's online form.
- **Import and export**: CSV in, CSV out, full backup and restore as one file.
- **Licence keys** verified on the device (ECDSA P-256). 15 trial reports.
  Saved records stay readable and exportable in every licence state.

## What it does not do

- It does not submit into water-system portals.
- It prints one report layout, not each utility's own form.
- It stores records on one device. No cloud sync, no accounts. Moving to
  another device is done with a backup file.
- No air-gap inspection form yet.

## How it is built

Plain HTML, CSS and JavaScript modules. No build step and no runtime
dependencies other than a vendored copy of pdf-lib. Records are kept in the
browser's IndexedDB. The app makes no network requests after it has loaded;
a Content-Security-Policy in `app/index.html` restricts it to its own origin.

```
app/src/domain/   rules, due dates, CSV, licence checks (no browser APIs)
app/src/views/    screens
app/src/pdf.js    report PDF
app/src/store.js  IndexedDB
app/sw.js         offline cache (generated list, see below)
```

## Working on it

```
npm test                     # unit tests (Node 22+, no install needed)
node tools/stamp-sw.mjs      # after ANY change under app/: refresh the offline file list
npm run serve                # http://localhost:8080  (landing page; app at /app/)
npm run e2e                  # browser journey incl. offline; needs Playwright + Chromium
```

`app/sw.js` carries a version derived from the app's files. If it is not
re-stamped after a change, installed copies will not pick the change up; a
unit test fails when it is stale.

## Publishing

The repository root is a static site. On GitHub: Settings, Pages, deploy from
branch `main`, folder `/ (root)`. The app is then at `<site>/app/`.

## Thresholds: sources

The default criteria are those common to the USC FCCCHR Manual 10th Edition
summary, AWWA M14 (2015) Appendix B and the ASSE field-test procedures as
reprinted by distributors. The primary texts of the USC Manual and the ASSE
5000 series were not consulted directly. The Type II bypass figures (1.0 psid
USC, 0.5 psid ASSE for DCDA-II) rest on a single secondary source. Have a
certified tester confirm the defaults against the current standards before
relying on them commercially.
