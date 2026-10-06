import { h, clear, toast } from './dom.js';
import { load, reload } from './store.js';
import { refreshLicense } from './nav.js';
import { dueView } from './views/due.js';
import { customersView, customerView, customerEditView, assemblyView, assemblyEditView } from './views/customers.js';
import { testEditView, reportView } from './views/test.js';
import { reportsView } from './views/reports.js';
import { settingsView } from './views/settings.js';

const routes = [
  [/^\/due$/, () => dueView(), 'due'],
  [/^\/customers$/, () => customersView(), 'customers'],
  [/^\/customer\/new$/, () => customerEditView(null), 'customers'],
  [/^\/customer\/([^/]+)\/edit$/, (m) => customerEditView(m[1]), 'customers'],
  [/^\/customer\/([^/]+)$/, (m) => customerView(m[1]), 'customers'],
  [/^\/assembly\/new\/([^/]+)$/, (m) => assemblyEditView(null, m[1]), 'customers'],
  [/^\/assembly\/([^/]+)\/edit$/, (m) => assemblyEditView(m[1]), 'customers'],
  [/^\/assembly\/([^/]+)$/, (m) => assemblyView(m[1]), 'customers'],
  [/^\/test\/new\/([^/]+)$/, (m) => testEditView(null, m[1]), 'due'],
  [/^\/test\/([^/]+)\/edit$/, (m) => testEditView(m[1]), 'reports'],
  [/^\/report\/([^/]+)$/, (m) => reportView(m[1]), 'reports'],
  [/^\/reports$/, () => reportsView(), 'reports'],
  [/^\/settings(?:\/(\w+))?$/, (m) => settingsView(m[1]), 'settings'],
];

const TABS = [
  ['due', '#/due', 'Due'],
  ['customers', '#/customers', 'Customers'],
  ['reports', '#/reports', 'Reports'],
  ['settings', '#/settings', 'Settings'],
];

let lastPath = null;

export function render() {
  const path = (location.hash || '#/due').slice(1);
  const root = document.getElementById('app');
  let view = null;
  let tab = 'due';
  for (const [re, fn, t] of routes) {
    const m = path.match(re);
    if (m) {
      try { view = fn(m.map((x) => (x === undefined ? x : decodeURIComponent(x)))); } catch (err) { view = errorView(err); }
      tab = t;
      break;
    }
  }
  if (!view) view = h('section', null, h('h1', null, 'Page not found'), h('p', null, h('a', { href: '#/due' }, 'Go to what is due')));
  clear(root);
  root.appendChild(h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/due', 'aria-label': 'TagDue home' }, h('span', { class: 'brand-tag', 'aria-hidden': 'true' }), 'TagDue'),
    h('nav', { class: 'tabs', 'aria-label': 'Main' }, TABS.map(([id, href, label]) =>
      h('a', { href, class: id === tab ? 'active' : '', 'aria-current': id === tab ? 'page' : null }, label)))));
  root.appendChild(h('main', { id: 'main', tabindex: '-1' }, view));
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
}

function errorView(err) {
  console.error(err);
  return h('section', null,
    h('h1', null, 'This screen could not be shown'),
    h('p', null, 'Your records are safe. Go back and try again. If it keeps happening, make a backup in Settings for safe keeping and report this message:'),
    h('pre', { class: 'error' }, String(err && err.message ? err.message : err)));
}

async function boot() {
  const root = document.getElementById('app');
  try {
    await load();
    await refreshLicense();
  } catch (err) {
    clear(root);
    root.appendChild(h('main', null,
      h('h1', null, 'TagDue could not open its storage'),
      h('p', null, 'This usually means the browser is in private mode or storage is blocked. Open TagDue in a normal window and try again.'),
      h('pre', { class: 'error' }, String(err && err.message ? err.message : err))));
    return;
  }
  window.addEventListener('hashchange', render);
  // A failed write must never pass silently: the tester has to know the record did not save.
  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast('That did not save. Storage on this device may be full or blocked. What you entered is still on screen.', { error: true });
  });
  // Coming back to this tab: pick up anything changed in another tab or window.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try { await reload(); await refreshLicense(); } catch (err) { console.warn(err); }
  });
  window.addEventListener('tagdue:render', render);
  if (!location.hash) history.replaceState(null, '', '#/due');
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) toast('An update is ready. Close and reopen TagDue to use it.');
        });
      });
    } catch (err) {
      console.warn('Offline support could not be set up', err);
    }
  }
}

boot();
