// Local storage of the shop's records in IndexedDB. Everything stays on the
// device; nothing is sent anywhere. The whole data set is held in memory
// (it is small) and each change is written through.
import { DEFAULT_RULES, mergeRules } from './domain/rules.js';
import { DEFAULT_REMINDER } from './domain/due.js';

const DB_NAME = 'tagdue';
const DB_VERSION = 1;
export const COLLECTIONS = ['customers', 'assemblies', 'tests', 'testers', 'gauges'];

export const state = {
  customers: [], assemblies: [], tests: [], testers: [], gauges: [],
  settings: defaultSettings(),
  license: null, // result of verifyLicense, set at boot
};

export function defaultSettings() {
  return {
    company: { name: '', address: '', cityStateZip: '', phone: '', email: '', contractorLicense: '' },
    rules: { ...DEFAULT_RULES },
    reminder: { ...DEFAULT_REMINDER },
    licenseKey: '',
    lastTesterId: '',
    lastGaugeId: '',
    lastBackup: '',
  };
}

let db = null;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const c of COLLECTIONS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
    result = fn(t);
  });
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function load() {
  db = await open();
  for (const c of COLLECTIONS) state[c] = await getAll(c);
  const saved = await new Promise((resolve, reject) => {
    const req = db.transaction('meta').objectStore('meta').get('settings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  state.settings = mergeSettings(saved);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

function mergeSettings(saved) {
  const d = defaultSettings();
  if (!saved) return d;
  return {
    ...d, ...saved,
    company: { ...d.company, ...(saved.company || {}) },
    rules: mergeRules(saved.rules),
    reminder: { ...d.reminder, ...(saved.reminder || {}) },
  };
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export async function put(collection, record) {
  if (!record.id) record.id = newId();
  record.updatedAt = Date.now();
  await tx([collection], 'readwrite', (t) => { t.objectStore(collection).put(record); });
  const list = state[collection];
  const i = list.findIndex((r) => r.id === record.id);
  if (i >= 0) list[i] = record; else list.push(record);
  return record;
}

export async function putMany(collection, records) {
  await tx([collection], 'readwrite', (t) => {
    const s = t.objectStore(collection);
    for (const r of records) { if (!r.id) r.id = newId(); r.updatedAt = Date.now(); s.put(r); }
  });
  for (const r of records) {
    const i = state[collection].findIndex((x) => x.id === r.id);
    if (i >= 0) state[collection][i] = r; else state[collection].push(r);
  }
}

export async function remove(collection, id) {
  await tx([collection], 'readwrite', (t) => { t.objectStore(collection).delete(id); });
  state[collection] = state[collection].filter((r) => r.id !== id);
}

/**
 * Save settings. Pass the top-level keys that changed, e.g. saveSettings('company').
 * Only those keys are written over what is stored, so a second open tab or
 * window cannot wipe out the licence key or anything else it did not change.
 * With no keys, the whole settings object is written.
 */
export function saveSettings(...keys) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(['meta'], 'readwrite');
    const store = t.objectStore('meta');
    let merged = state.settings;
    if (keys.length) {
      const req = store.get('settings');
      req.onsuccess = () => {
        merged = mergeSettings(req.result);
        for (const k of keys) merged[k] = state.settings[k];
        store.put(merged, 'settings');
      };
    } else {
      store.put(state.settings, 'settings');
    }
    t.oncomplete = () => { state.settings = merged; resolve(); };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  });
}

/** Re-read everything from storage, to pick up changes made in another tab or window. */
export async function reload() {
  if (!db) return;
  for (const c of COLLECTIONS) state[c] = await getAll(c);
  const saved = await new Promise((resolve, reject) => {
    const req = db.transaction('meta').objectStore('meta').get('settings');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  state.settings = mergeSettings(saved);
}

export const byId = (collection, id) => state[collection].find((r) => r.id === id) || null;

export function exportAll() {
  const out = { app: 'TagDue', format: 1, exportedAt: new Date().toISOString(), settings: state.settings };
  for (const c of COLLECTIONS) out[c] = state[c];
  return out;
}

/** Replace everything on this device with the contents of a backup. Validates first. */
export async function importAll(data) {
  if (!data || data.app !== 'TagDue' || data.format !== 1) throw new Error('This file is not a TagDue backup');
  for (const c of COLLECTIONS) {
    if (!Array.isArray(data[c])) throw new Error(`The backup is missing its ${c} list`);
    if (data[c].some((r) => !r || typeof r.id !== 'string')) throw new Error(`The backup has a damaged record in ${c}`);
  }
  const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (data.tests.some((t) => !isDate(t.date) || typeof t.assemblyId !== 'string' || typeof t.initial !== 'object' || t.initial === null)) {
    throw new Error('The backup has a damaged test report. Nothing was changed.');
  }
  if (data.assemblies.some((a) => typeof a.customerId !== 'string' || typeof a.type !== 'string')) {
    throw new Error('The backup has a damaged assembly record. Nothing was changed.');
  }
  // Keep the licence already on this device: restoring an older backup must not lock a paying shop out.
  const restored = mergeSettings(data.settings);
  if (state.settings.licenseKey) restored.licenseKey = state.settings.licenseKey;
  await tx([...COLLECTIONS, 'meta'], 'readwrite', (t) => {
    for (const c of COLLECTIONS) {
      const s = t.objectStore(c);
      s.clear();
      for (const r of data[c]) s.put(r);
    }
    t.objectStore('meta').put(restored, 'settings');
  });
  for (const c of COLLECTIONS) state[c] = data[c];
  state.settings = restored;
}

export async function clearAll() {
  await tx([...COLLECTIONS, 'meta'], 'readwrite', (t) => {
    for (const c of COLLECTIONS) t.objectStore(c).clear();
    t.objectStore('meta').clear();
  });
  for (const c of COLLECTIONS) state[c] = [];
  state.settings = defaultSettings();
}
