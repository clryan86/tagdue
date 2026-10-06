// Licence keys: a signed statement of who paid and until when.
// Format:  TD1.<base64url JSON payload>.<base64url ECDSA P-256 / SHA-256 signature>
// Verification needs only the public key below, so it works with no network.
// The matching private key never ships with the app.

export const PUBLIC_KEY_JWK = {"kty":"EC","crv":"P-256","x":"dkLi985Sk0_oO3TvpPsxJ7fZjyy2UI9hosEVw8u7ub0","y":"zL6FujfWzuYfHV_5t-cRtzmvlG1e8leg93wSdBn0QjA"};

export const TRIAL_REPORTS = 15;

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @returns {Promise<{valid:boolean, reason?:string, payload?:object, expired?:boolean}>}
 */
export async function verifyLicense(key, today, jwk = PUBLIC_KEY_JWK) {
  try {
    if (!jwk) return { valid: false, reason: 'This build has no licence key configured' };
    const parts = String(key || '').trim().replace(/\s+/g, '').split('.');
    if (parts.length !== 3 || parts[0] !== 'TD1') return { valid: false, reason: 'That does not look like a TagDue licence key' };
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const sig = b64urlToBytes(parts[2]);
    const pub = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, data);
    if (!ok) return { valid: false, reason: 'The key is not valid. Check that it was pasted in full.' };
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (!payload.exp || !/^\d{4}-\d{2}-\d{2}$/.test(payload.exp)) return { valid: false, reason: 'The key has no expiry date' };
    if (today && payload.exp < today) return { valid: false, expired: true, payload, reason: `This licence ended on ${payload.exp}` };
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'The key could not be read. Check that it was pasted in full.' };
  }
}

/**
 * What the shop may do right now.
 * Saved records stay readable and exportable in every state; only creating
 * new test reports is limited once the trial is used up.
 */
export function entitlement({ license, reportsSaved }) {
  if (license && license.valid) {
    return { mode: 'licensed', canCreate: true, until: license.payload.exp, holder: license.payload.name || '' };
  }
  const left = Math.max(0, TRIAL_REPORTS - (reportsSaved || 0));
  if (left > 0) return { mode: 'trial', canCreate: true, left };
  return { mode: license && license.expired ? 'expired' : 'trial-ended', canCreate: false, left: 0 };
}
