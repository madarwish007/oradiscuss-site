// THE RELEASE PIPELINE, worker half.
//
// Founder ruling, 9 Aug 2026: "updating the website and sending the email to
// subscribers that inform them about the updates should be automated as well."
// scripts/release-pack.sh is the other half: it builds the customer zip from
// HEAD, hashes it, puts it in R2 and emits the SQL that records it. Once that
// SQL is applied, /changelog/ already renders the release from D1 with no page
// edit anywhere, because worker/changelog.js reads the table. What was missing
// was the two things a person still had to do by hand, and they are here:
//
//   POST /api/release/announce   tell subscribers a pack was updated, once
//   POST /api/release/link       see exactly what a customer receives
//
// BOTH ARE BEHIND WATCH_ADMIN_TOKEN, the token that already gates publishing,
// and both REFUSE when it is not installed. An absent token means these actions
// are impossible, never that they are unguarded. There is deliberately no
// second secret: see worker/admin-auth.js.
//
// NOTHING HERE MAKES A PAID PACK REACHABLE WITHOUT A SIGNED LINK. The review
// route does not read R2 and does not stream a file. It mints a short lived
// entitlement and hands back a link that goes through worker/delivery.js like
// every customer link, so the founder exercises the real path including the
// entitlement recheck at download time, rather than a privileged imitation of
// it that could pass while the real one was broken.

import { json, fail, readJsonBody } from './http.js';
import { authoriseAdmin, throttleAdmin } from './admin-auth.js';
import { beehiivSendRelease, releaseSendReadiness } from './integrations.js';
import { escapeHtml, renderNotes } from './changelog.js';
import { signDownloadUrl } from './delivery.js';
import { referenceHash, writeEntitlement } from './entitlement.js';

// The same shapes worker/delivery.js validates, and they must stay the same
// shapes: a pack or version this file accepted but that file refused would be a
// release the founder could announce and nobody could download.
const PACK_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const NOT_CONFIGURED =
  'The release pipeline is not open on this Worker: WATCH_ADMIN_TOKEN is not set. No release was changed and nothing was sent.';

const GATE = { what: NOT_CONFIGURED, tag: 'release_admin' };

const authorise = (request, env) => authoriseAdmin(request, env, GATE);
const throttle = (request, env) => throttleAdmin(request, env, GATE);

// How long the founder's review entitlement lives. Comfortably longer than the
// signed link it is minted beside (worker/delivery.js signs for 300 seconds) so
// a slow click fails as an expired LINK with a clear message rather than as a
// mysterious "no entitlement", and short enough that the grant is worthless
// within the quarter hour whatever happens to it.
export const REVIEW_ENTITLEMENT_TTL_SECONDS = 900;

// Tier 2 is the top of the catalogue (migrations/0002: toolkit-academy). The
// review grant sits there so the founder can review any pack whatever its
// min_tier, including one released to a tier he does not personally hold.
const REVIEW_TIER = 2;

/* ------------------------------------------------------------- the reader */

// Deliberately NOT reused from worker/delivery.js, and deliberately not added
// to it either. Every reader in that file filters on the caller's tier, which is
// the point of that file. This one ignores tier because the founder is not a
// member, and a tier blind reader living next to the entitlement checks is
// exactly the function a later edit would call by mistake.
async function readRelease(env, pack, version) {
  if (version) {
    return env.DB.prepare(
      `SELECT pack, version, r2_key, sha256, min_tier, released_at, notified_at, notify_status
         FROM pack_release
        WHERE pack = ?1 AND version = ?2`,
    )
      .bind(pack, version)
      .first();
  }
  return env.DB.prepare(
    `SELECT pack, version, r2_key, sha256, min_tier, released_at, notified_at, notify_status
       FROM pack_release
      WHERE pack = ?1
      ORDER BY released_at DESC, version DESC
      LIMIT 1`,
  )
    .bind(pack)
    .first();
}

// The release notes as the changelog holds them. There is exactly one copy of
// what changed, in D1, and both the page and the email render it from there.
async function readNotes(env, pack, version) {
  const row = await env.DB.prepare(
    `SELECT body_md FROM changelog WHERE pack = ?1 AND version = ?2 ORDER BY id DESC LIMIT 1`,
  )
    .bind(pack, version)
    .first();
  return typeof row?.body_md === 'string' ? row.body_md : '';
}

// One reader for the two body fields both routes need from the request.
async function readTarget(request, { versionRequired }) {
  const parsed = await readJsonBody(request);
  if (parsed.error) return { refusal: fail(400, 'bad_request', parsed.error) };

  const pack = typeof parsed.value.pack === 'string' ? parsed.value.pack.trim().toLowerCase() : '';
  if (!PACK_RE.test(pack)) {
    return { refusal: fail(400, 'bad_pack', 'Name the pack, for example healthcheck.') };
  }

  const raw = typeof parsed.value.version === 'string' ? parsed.value.version.trim() : '';
  if (raw && !VERSION_RE.test(raw)) {
    return { refusal: fail(400, 'bad_version', 'That is not a version this pipeline can have released.') };
  }
  if (!raw && versionRequired) {
    return {
      refusal: fail(400, 'bad_version', 'Name the exact version to announce. Announcing "the latest" is how the wrong thing gets mailed.'),
    };
  }

  return { pack, version: raw, body: parsed.value };
}

/* ------------------------------------------------------------- announcing */

// POST /api/release/announce
//
// Records the subscriber notification for one released version, at most once,
// ever. The ORDER OF OPERATIONS is the design and it is the same order
// worker/watch-publish.js uses, for the same reason:
//
//   1. Refuse without the token.
//   2. Refuse if the release is not recorded. There is nothing to announce
//      before the SQL from scripts/release-pack.sh has been applied, and saying
//      so is better than mailing a link to a page that has no entry on it.
//   3. Refuse to repeat: a release carrying a notification claim is never
//      claimed again.
//   4. PRE-FLIGHT the configuration before claiming. No beehiiv key or no
//      segment means nothing could have left this Worker, so no claim is taken,
//      the release stays announceable, and the answer says plainly that it was
//      NOT sent. This is the state this build ships in.
//   5. Claim atomically, then send. The claim is a conditional UPDATE whose
//      WHERE clause requires notified_at IS NULL, so two simultaneous calls
//      cannot both win it and therefore cannot both send.
//   6. Record the outcome, always, even when it is bad.
export async function postReleaseAnnounce(request, env) {
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;

  const target = await readTarget(request, { versionRequired: true });
  if (target.refusal) return target.refusal;
  const { pack, version } = target;

  const release = await readRelease(env, pack, version);
  if (!release) {
    return fail(
      404,
      'no_release',
      'That version is not recorded in pack_release, so there is nothing to announce. Apply the SQL from scripts/release-pack.sh first.',
    );
  }

  // The deliberate way out of a claimed but undelivered notification. It is an
  // explicit flag rather than a default because the failure it reopens is the
  // ambiguous one: a send that timed out may already have been accepted, and
  // clearing the claim is how the same release reaches the list twice. It
  // cannot touch a notification that actually succeeded.
  const retry = target.body.retry === true && release.notify_status !== 'sent';
  if (release.notified_at && !retry) {
    return json({
      ok: true,
      pack: release.pack,
      version: release.version,
      already_announced: true,
      sent: release.notify_status === 'sent',
      notify_status: release.notify_status ?? null,
      notified_at: release.notified_at,
    });
  }

  // PRE-FLIGHT. Asked before the claim, so that a release cannot be burned by a
  // send that was never possible. It READS the configuration and does not call
  // the sender: beehiivSendRelease is built on this same function, so the answer
  // here is by construction the answer the send would have given.
  const preflight = releaseSendReadiness(env);
  if (!preflight.ready) {
    await recordOutcome(env, release, { sent: false, status: preflight.status }, { claim: false });
    console.warn('release_announce_held', pack, version, preflight.status);
    return json({
      ok: true,
      pack: release.pack,
      version: release.version,
      already_announced: false,
      recorded: true,
      sent: false,
      notify_status: preflight.status,
      // Said plainly rather than left for the founder to infer from a false.
      detail: preflight.detail ?? null,
      message:
        'The release is recorded and the changelog shows it. NOTHING was sent to anybody, because the notification list is not configured on this Worker. Announcing again once it is will send it.',
    });
  }

  const claim = await env.DB.prepare(
    `UPDATE pack_release
        SET notified_at = datetime('now'), notify_status = 'sending'
      WHERE pack = ?1 AND version = ?2 AND (notified_at IS NULL OR ?3 = 1)`,
  )
    .bind(pack, version, retry ? 1 : 0)
    .run();

  // Zero changes means somebody else claimed it between the read and the write.
  // They own the send; this caller does not repeat it.
  if ((claim?.meta?.changes ?? 0) === 0) {
    return json({
      ok: true,
      pack: release.pack,
      version: release.version,
      already_announced: true,
      sent: false,
      notify_status: release.notify_status ?? null,
    });
  }

  const send = await sendToSubscribers(env, release);
  await recordOutcome(env, release, send, { claim: true });

  if (!send.sent) console.warn('release_announce_not_sent', pack, version, send.status, send.detail ?? '');

  return json({
    ok: true,
    pack: release.pack,
    version: release.version,
    already_announced: false,
    recorded: true,
    sent: send.sent,
    notify_status: send.status,
    detail: send.detail ?? null,
  });
}

// The subscriber notification. Reached from postReleaseAnnounce and from
// nowhere else, and test/release.test.js sweeps the worker tree to keep it that
// way rather than trusting this sentence.
//
// THE EMAIL IS A POINTER. It carries the pack, the version, what changed as the
// changelog already records it, and two links to pages on the site. It carries
// NO pack contents, NO credentials, and NO download link: a signed link is dead
// in five minutes and would arrive expired, and a link that was not dead would
// be a way to a paid file that never met the entitlement check.
async function sendToSubscribers(env, release) {
  const title = `${release.pack} ${release.version} is released`;
  const notes = await readNotes(env, release.pack, release.version);

  const body_html = [
    `<p>${escapeHtml(title)}.</p>`,
    renderNotes(notes),
    '<p><a href="https://oradiscuss.com/changelog/">See the full changelog</a></p>',
    '<p>Members: get the updated pack from <a href="https://oradiscuss.com/reissue/">the re-issue page</a>, using the transaction reference on your receipt.</p>',
  ]
    .filter(Boolean)
    .join('');

  try {
    return await beehiivSendRelease(env, { title, subject: title, body_html });
  } catch (err) {
    console.error('release_send_threw', String(err?.message ?? err));
    return { sent: false, status: 'failed', detail: null };
  }
}

// The bookkeeping write. `claim: false` is the pre-flight case: the outcome word
// is recorded but notified_at is left NULL, so the release stays announceable.
async function recordOutcome(env, release, send, { claim }) {
  try {
    await env.DB.prepare(
      `UPDATE pack_release
          SET notify_status = ?1,
              notified_at = CASE WHEN ?2 = 1 THEN notified_at ELSE NULL END
        WHERE pack = ?3 AND version = ?4`,
    )
      .bind(String(send.status).slice(0, 40), claim ? 1 : 0, release.pack, release.version)
      .run();
  } catch (err) {
    // The mail is away, or was never possible. A lost bookkeeping write is
    // recorded and must not turn the answer into an error.
    console.error('release_notify_unrecorded', release.pack, release.version, String(err?.message ?? err));
  }
}

/* ------------------------------------------------- the founder review link */

// POST /api/release/link
//
// "Show me exactly what a customer receives." Until now there was no way to ask
// that: the only route to a pack is a signed link, and a signed link needs an
// entitlement, and the founder deliberately has no customer record.
//
// So this mints a REAL one, briefly. A random reference is generated here, its
// hash becomes a fifteen minute entitlement through the one writer in
// worker/entitlement.js, and the link is signed by the same function that signs
// a customer's. The reference itself is never returned and never logged, so
// what leaves this endpoint is a link to one pack version and nothing that
// could be replayed against /api/reissue for the rest.
//
// WHAT THIS IS NOT: it is not a download. This route never touches R2. The file
// is served by GET /api/download, which verifies the signature, rechecks the
// entitlement and enforces min_tier exactly as it does for a customer. A review
// path that skipped those could pass while the path customers use was broken.
export async function postReleaseLink(request, env) {
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;

  const target = await readTarget(request, { versionRequired: false });
  if (target.refusal) return target.refusal;
  const { pack, version } = target;

  const release = await readRelease(env, pack, version);
  if (!release) {
    return fail(
      404,
      'no_release',
      version
        ? 'That version is not recorded in pack_release.'
        : 'No version of that pack is recorded in pack_release yet.',
    );
  }

  // 32 random bytes as hex. It is a synthetic reference in the shape
  // worker/entitlement.js accepts, it identifies nobody, and it exists for a
  // quarter of an hour.
  const reference = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hash = await referenceHash(reference);

  const link = await signDownloadUrl(env, {
    origin: new URL(request.url).origin,
    pack: release.pack,
    version: release.version,
    hash,
  });

  // signDownloadUrl answers null when R2_SIGNING_KEY is absent or too short.
  // Checked BEFORE the entitlement is written, so a Worker that cannot sign
  // leaves no grant lying in KV.
  if (!link) {
    return fail(
      503,
      'not_configured',
      'Review links are not open yet: R2_SIGNING_KEY is not set on this Worker. Nothing was granted.',
    );
  }

  await writeEntitlement(env, hash, {
    tier: REVIEW_TIER,
    status: 'active',
    expires_at: new Date(Date.now() + REVIEW_ENTITLEMENT_TTL_SECONDS * 1000).toISOString(),
    processor: 'founder-review',
  });

  console.warn('release_review_link_minted', release.pack, release.version);

  return json({
    ok: true,
    pack: release.pack,
    version: release.version,
    sha256: release.sha256,
    min_tier: release.min_tier,
    released_at: release.released_at,
    ...link,
    grant_expires_in: REVIEW_ENTITLEMENT_TTL_SECONDS,
    note: 'This is the customer path, not a shortcut around it. The link is signed, it expires, and the download rechecks the entitlement it was minted against.',
  });
}
