import { state } from './store.js';
import { verifyLicense, entitlement } from './domain/license.js';
import { todayISO } from './domain/due.js';

export function rerender() {
  window.dispatchEvent(new Event('tagdue:render'));
}

export function navigate(path) {
  if (location.hash === '#' + path) rerender();
  else location.hash = '#' + path;
}

export function currentEntitlement() {
  return entitlement({ license: state.license, reportsSaved: state.tests.length });
}

export async function refreshLicense() {
  state.license = state.settings.licenseKey ? await verifyLicense(state.settings.licenseKey, todayISO()) : null;
}
