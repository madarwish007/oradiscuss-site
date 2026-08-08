// Primitives for Phase 6 delivery: hashing, HMAC, and a constant-time compare.
//
// Everything here runs on WebCrypto, which the Workers runtime and Node 22+
// both provide, so the same code is exercised by the test suite and by the
// edge. Nothing in this file is processor-specific.
//
// THE HASHING RULE, and it is the privacy page's sentence made literal:
// the only thing we ever hash into storage is a TRANSACTION REFERENCE or a
// SUBSCRIPTION REFERENCE issued by the Merchant of Record. Never an address,
// never a name, never an IP. A hash of a person is still a person, which is
// why /api/subscribe deliberately stores nothing at all.

const encoder = new TextEncoder();

export function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Plain SHA-256, matching the data model recorded in BUILD_PLAN section 2:
// KV key = sha256(transaction reference). Deliberately NOT keyed with a secret.
// A keyed hash would read better on paper and cost far more in practice: the
// key could never be rotated or reinstalled wrong without orphaning every
// entitlement we hold, and this repo has already met a secret that installed
// empty while printing "Success!". References issued by a Merchant of Record
// are long unguessable identifiers, so an unkeyed digest is not brute forcible
// in any case.
export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

// Constant time relative to CONTENT. The length is compared first and that
// comparison is not constant time, which is correct here: every value this is
// used on is a fixed-length hex digest, so a length mismatch is a malformed
// input rather than a near miss, and there is no secret in the length.
//
// The loop never breaks early. That is the whole point: a compare that returns
// on the first differing character tells an attacker how much of a forged
// signature was right, one request at a time.
export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const HEX_64 = /^[0-9a-f]{64}$/;
