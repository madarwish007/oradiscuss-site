// SIGNED DELIVERY. A member proves nothing about who they are; they present a
// reference, and a short lived signed link comes back.
//
// The link is signed by US, not by R2. Presigning against the bucket would mean
// putting S3 style access keys on the Worker and handing out a URL that R2 will
// honour whatever we later decide about the buyer. Signing our own link keeps
// three properties that matter more than the saved code:
//
//   1. THE URL NEVER NAMES AN R2 KEY. It names a pack and a version, and the
//      object key is looked up in D1 at download time. There is therefore no
//      string a caller can bend into reading another object.
//   2. ENTITLEMENT IS RECHECKED WHEN THE FILE IS SERVED, not only when the link
//      is minted. A refund that lands in the five minutes between the two stops
//      the download.
//   3. Revocation is ours. Rotating R2_SIGNING_KEY invalidates every link in
//      flight and nothing else.
//
// FAIL CLOSED is the rule on every path below: a missing secret, a missing
// binding, an unparseable parameter and an unverifiable signature all refuse.
// The only way to a file is a signature we recomputed ourselves.

import { json, fail, clientKey, readJsonBody } from './http.js';
import { hmacSha256Hex, timingSafeEqualHex, HEX_64 } from './crypto.js';
import { readSecret } from './integrations.js';
import {
  normaliseReference,
  referenceHash,
  readEntitlement,
  deleteEntitlement,
  isActive,
  bumpDownloads,
} from './entitlement.js';

// Short by design. Long enough to survive a slow phone on hotel wifi, short
// enough that a link pasted into a public channel is dead before it is read.
export const DOWNLOAD_TTL_SECONDS = 300;

// The verifier's own clamp, and it is not the same number as the TTL above by
// accident. A link whose expiry sits further out than this is refused even if
// the signature is perfect, so a future edit that sets a silly TTL, or a key
// that leaks and is used to mint a year long link, is caught at the door rather
// than at review time.
export const MAX_TTL_SECONDS = 900;

// `wrangler secret put` prints "Success!" for an empty pipe, so the length gate
// lives in code. 64 is what `openssl rand -hex 32` produces.
export const SIGNING_KEY_MIN_LENGTH = 32;

const PACK_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const NOT_CONFIGURED =
  'Downloads are not open yet: the download signing key is not set on this Worker. Nothing was looked up.';
const NO_LIMITER =
  'Downloads are closed because their rate limiter is not configured on this Worker. Nothing was looked up.';
// One sentence for every refusal that involves a reference, on purpose. An
// error that distinguishes "no such reference" from "that membership lapsed"
// is a free oracle for anyone testing references in bulk.
const NO_ENTITLEMENT =
  'That reference does not have an active membership against it. If you have just purchased, give the payment a minute and try again.';
const BAD_LINK =
  'That download link is not valid, or it has expired. Request a fresh one from the re-issue page.';

function signingKey(env) {
  const secret = readSecret(env, 'R2_SIGNING_KEY');
  return secret.set && secret.value.length >= SIGNING_KEY_MIN_LENGTH ? secret.value : null;
}

function canonical({ pack, version, hash, expires }) {
  return ['v1', pack, version, hash, String(expires)].join('\n');
}

export async function signDownloadUrl(env, { origin, pack, version, hash, now = Date.now() }) {
  const key = signingKey(env);
  if (!key) return null;
  const expires = Math.floor(now / 1000) + DOWNLOAD_TTL_SECONDS;
  const signature = await hmacSha256Hex(key, canonical({ pack, version, hash, expires }));
  const query = new URLSearchParams({ p: pack, v: version, h: hash, e: String(expires), s: signature });
  return {
    url: `${origin}/api/download?${query.toString()}`,
    expires_at: new Date(expires * 1000).toISOString(),
    expires_in: DOWNLOAD_TTL_SECONDS,
  };
}

// Every reason is returned rather than thrown, so the caller can log which gate
// refused while telling the visitor one unvarying sentence.
export async function verifyDownloadUrl(env, url, now = Date.now()) {
  const key = signingKey(env);
  if (!key) return { ok: false, reason: 'no_signing_key' };

  const params = url.searchParams;
  const pack = params.get('p') ?? '';
  const version = params.get('v') ?? '';
  const hash = params.get('h') ?? '';
  const expiresRaw = params.get('e') ?? '';
  const signature = params.get('s') ?? '';

  if (!PACK_RE.test(pack)) return { ok: false, reason: 'bad_pack' };
  if (!VERSION_RE.test(version)) return { ok: false, reason: 'bad_version' };
  if (!HEX_64.test(hash)) return { ok: false, reason: 'bad_hash' };
  if (!HEX_64.test(signature)) return { ok: false, reason: 'bad_signature_format' };
  if (!/^\d{1,12}$/.test(expiresRaw)) return { ok: false, reason: 'bad_expiry_format' };

  const expires = Number(expiresRaw);
  const seconds = Math.floor(now / 1000);
  if (expires <= seconds) return { ok: false, reason: 'expired' };
  if (expires - seconds > MAX_TTL_SECONDS) return { ok: false, reason: 'ttl_too_long' };

  const expected = await hmacSha256Hex(key, canonical({ pack, version, hash, expires }));
  if (!timingSafeEqualHex(expected, signature)) return { ok: false, reason: 'signature_mismatch' };

  return { ok: true, pack, version, hash, expires };
}

/* ------------------------------------------------------------ D1 releases */

// The catalogue of what exists to download. `pack_release` is written by the
// release pipeline, never by a request, so this is a read only surface.
async function latestRelease(env, pack, tier) {
  return env.DB.prepare(
    `SELECT pack, version, r2_key, sha256, min_tier, released_at
       FROM pack_release
      WHERE pack = ?1 AND min_tier <= ?2
      ORDER BY released_at DESC, version DESC
      LIMIT 1`,
  )
    .bind(pack, tier)
    .first();
}

async function exactRelease(env, pack, version) {
  return env.DB.prepare(
    `SELECT pack, version, r2_key, sha256, min_tier, released_at
       FROM pack_release
      WHERE pack = ?1 AND version = ?2`,
  )
    .bind(pack, version)
    .first();
}

async function latestReleasePerPack(env, tier) {
  const { results } = await env.DB.prepare(
    `SELECT pack, version, r2_key, sha256, min_tier, released_at
       FROM pack_release
      WHERE min_tier <= ?1
      ORDER BY pack ASC, released_at DESC, version DESC`,
  )
    .bind(tier)
    .all();

  const newest = new Map();
  for (const row of results ?? []) if (!newest.has(row.pack)) newest.set(row.pack, row);
  return [...newest.values()];
}

/* --------------------------------------------------------------- limiting */

// A second, much tighter limiter than the site wide one, because these are the
// only endpoints where a caller can test whether a reference exists.
//
// It fails CLOSED when the binding is absent. That is a deliberate trade: an
// unlimited reference oracle is a worse failure than a download page that says
// it is shut, and the binding is declared for both environments in
// wrangler.toml, so an absence means a broken deploy rather than a normal state.
async function tightLimit(request, env) {
  if (!env.REISSUE_RATE_LIMIT) return fail(503, 'not_configured', NO_LIMITER);
  const { success } = await env.REISSUE_RATE_LIMIT.limit({ key: clientKey(request) });
  if (!success) {
    return fail(429, 'rate_limited', 'Too many attempts from this connection. Wait a minute and try again.');
  }
  return null;
}

/* ----------------------------------------------------------------- routes */

// POST /api/download: a reference and a pack name, in exchange for one link.
export async function postDownload(request, env) {
  const limited = await tightLimit(request, env);
  if (limited) return limited;
  if (!signingKey(env)) return fail(503, 'not_configured', NOT_CONFIGURED);

  const parsed = await readJsonBody(request);
  if (parsed.error) return fail(400, 'bad_request', parsed.error);

  const reference = normaliseReference(parsed.value.reference);
  if (!reference) {
    return fail(400, 'bad_reference', 'That does not look like a transaction reference from your receipt.');
  }

  const pack = typeof parsed.value.pack === 'string' ? parsed.value.pack.trim().toLowerCase() : '';
  if (!PACK_RE.test(pack)) return fail(400, 'bad_pack', 'Name one of the packs listed on your download page.');

  const hash = await referenceHash(reference);
  const record = await readEntitlement(env, hash);
  if (!isActive(record)) return fail(403, 'no_entitlement', NO_ENTITLEMENT);

  const release = await latestRelease(env, pack, record.tier);
  if (!release) {
    return fail(404, 'no_release', 'There is no released version of that pack for your membership yet.');
  }

  const link = await signDownloadUrl(env, {
    origin: new URL(request.url).origin,
    pack: release.pack,
    version: release.version,
    hash,
  });

  return json({ ok: true, tier: record.tier, links: [{ ...linkShape(release), ...link }] });
}

// POST /api/reissue: the self serve counter. Same proof, every pack at once,
// which is what somebody who lost their email actually needs.
export async function postReissue(request, env) {
  const limited = await tightLimit(request, env);
  if (limited) return limited;
  if (!signingKey(env)) return fail(503, 'not_configured', NOT_CONFIGURED);

  const parsed = await readJsonBody(request);
  if (parsed.error) return fail(400, 'bad_request', parsed.error);

  const reference = normaliseReference(parsed.value.reference);
  if (!reference) {
    return fail(400, 'bad_reference', 'That does not look like a transaction reference from your receipt.');
  }

  const hash = await referenceHash(reference);
  const record = await readEntitlement(env, hash);
  if (!isActive(record)) return fail(403, 'no_entitlement', NO_ENTITLEMENT);

  const releases = await latestReleasePerPack(env, record.tier);
  const origin = new URL(request.url).origin;
  const links = [];
  for (const release of releases) {
    const link = await signDownloadUrl(env, {
      origin,
      pack: release.pack,
      version: release.version,
      hash,
    });
    links.push({ ...linkShape(release), ...link });
  }

  return json({
    ok: true,
    tier: record.tier,
    expires_at: record.expires_at ?? null,
    links,
  });
}

function linkShape(release) {
  return { pack: release.pack, version: release.version, sha256: release.sha256 };
}

// GET /api/download: the signed link itself, arriving as a browser navigation.
export async function getDownload(request, env) {
  const url = new URL(request.url);
  const verdict = await verifyDownloadUrl(env, url);
  if (!verdict.ok) {
    // The reason is ours to keep. The visitor gets one sentence whichever gate
    // refused, so a probe cannot tell a bad signature from a stale link.
    console.warn('download_link_rejected', verdict.reason);
    return fail(403, 'bad_link', BAD_LINK);
  }

  const record = await readEntitlement(env, verdict.hash);
  if (!isActive(record)) return fail(403, 'no_entitlement', NO_ENTITLEMENT);

  const release = await exactRelease(env, verdict.pack, verdict.version);
  if (!release || release.min_tier > record.tier) {
    return fail(404, 'no_release', 'That release is not available on your membership.');
  }

  if (!env.PACKS) return fail(503, 'not_configured', 'The pack store is not bound on this Worker.');
  const object = await env.PACKS.get(release.r2_key);
  if (!object) {
    console.error('pack_object_missing', release.r2_key);
    return fail(404, 'no_object', 'That release is registered but its file is not in the store yet.');
  }

  await bumpDownloads(env, verdict.hash);

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${release.pack}-${release.version}.zip"`,
      'Content-Length': String(object.size ?? ''),
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      // Published beside the file so a member can verify the artifact against
      // the same digest the release pipeline recorded.
      'X-Artifact-SHA256': release.sha256,
    },
  });
}

// POST /api/entitlement/delete: the deletion right, self serve.
//
// It deletes on knowledge of the reference, which is the same knowledge that
// grants a download, so this adds no exposure. It is a real route rather than
// an inbox promise because a right that needs a human to honour it is a right
// that waits for one.
export async function postDelete(request, env) {
  const limited = await tightLimit(request, env);
  if (limited) return limited;

  const parsed = await readJsonBody(request);
  if (parsed.error) return fail(400, 'bad_request', parsed.error);

  const reference = normaliseReference(parsed.value.reference);
  if (!reference) {
    return fail(400, 'bad_reference', 'That does not look like a transaction reference from your receipt.');
  }
  if (parsed.value.confirm !== true) {
    return fail(400, 'not_confirmed', 'Deleting the hash ends member access. Send confirm to proceed.');
  }

  const hash = await referenceHash(reference);
  const held = await deleteEntitlement(env, hash);

  return json({
    ok: true,
    deleted: held,
    message: held
      ? 'The hash for that reference is deleted. Member downloads against it no longer work.'
      : 'Nothing was held for that reference, so there was nothing to delete.',
    // Said plainly rather than left as a surprise: while a subscription is
    // live, the Merchant of Record keeps sending lifecycle events, and the next
    // one recreates the hash. Ending the subscription is what stops that.
    note: 'While a subscription is still live at the Merchant of Record, its next event recreates this hash. Cancel the subscription to stop that.',
  });
}
