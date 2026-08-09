// THE FOUNDER GATE, in one place.
//
// Two endpoint families are behind WATCH_ADMIN_TOKEN now: publishing a Security
// Watch brief, and the release pipeline (announce a release to subscribers,
// mint a review link for a released pack). They are different actions with the
// same answer to "who may do this", so they share one implementation of the
// answer rather than two copies that drift.
//
// This module was extracted from worker/watch-publish.js, which had the only
// copy. The extraction is deliberate rather than tidy: a constant time compare
// that exists twice is a constant time compare that gets fixed once.
//
// THERE IS ONE SECRET, ON PURPOSE. A second admin token would double the number
// of values that have to be generated, installed, rotated and remembered, and
// the failure mode of a forgotten rotation is an endpoint that still opens.
//
// THE RULES, and they are the design:
//
//   1. Refuse if WATCH_ADMIN_TOKEN is not installed. An absent token means the
//      action is IMPOSSIBLE, never that it is unguarded. This is the difference
//      between a closed door and no door, and it is why the refusal is a 503
//      that names the missing secret rather than a 401 that invites guessing.
//   2. Compare the presented token in constant time, against digests, so a
//      wrong length cannot be measured from the outside.
//   3. Return a Response on refusal rather than a boolean, so no caller can
//      forget to act on the verdict.

import { fail, clientKey } from './http.js';
import { sha256Hex, timingSafeEqualHex } from './crypto.js';
import { readSecret } from './integrations.js';

export const NOT_AUTHORISED = 'That request is not authorised.';

// `what` names the action in the 503 so the founder reading it knows which
// endpoint refused and what did NOT happen as a result. `tag` is the log line,
// kept per caller so a log search can tell the publish gate from the release
// gate without reading the request path.
export async function authoriseAdmin(request, env, { what, tag }) {
  const secret = readSecret(env, 'WATCH_ADMIN_TOKEN');
  if (!secret.set) {
    console.error(`${tag}_not_configured`);
    return fail(503, 'not_configured', what);
  }

  const header = request.headers.get('Authorization') ?? '';
  const presented = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  if (!presented) return fail(401, 'no_token', NOT_AUTHORISED);

  // Both sides are hashed before the compare. The constant time helper refuses
  // strings of different lengths, which is right for fixed length digests and
  // wrong for a token somebody typed: hashing first gives two 64 character hex
  // strings whatever was presented, so the compare tells an attacker nothing
  // about the length of the real token.
  const a = await sha256Hex(presented[1].trim());
  const b = await sha256Hex(secret.value);
  if (!timingSafeEqualHex(a, b)) {
    console.warn(`${tag}_bad_token`);
    return fail(401, 'bad_token', NOT_AUTHORISED);
  }
  return null;
}

// The tight limiter, shared with the delivery routes. Used when it is bound and
// not fail closed when it is absent, deliberately: the token is the control
// here, and a founder locked out of his own release button by a missing binding
// is a worse failure than an unthrottled endpoint that still needs the token.
export async function throttleAdmin(request, env, { tag }) {
  if (!env.REISSUE_RATE_LIMIT) {
    console.warn(`${tag}_unlimited`);
    return null;
  }
  const { success } = await env.REISSUE_RATE_LIMIT.limit({ key: clientKey(request) });
  return success ? null : fail(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.');
}
