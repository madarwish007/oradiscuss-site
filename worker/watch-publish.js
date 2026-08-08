// PUBLISHING IS A FOUNDER GATE. This file is the only place in the repository
// where a Security Watch brief becomes live, and the only place that can mail
// the member list. Both happen on one authenticated HTTP call that a person
// makes. There is no schedule, no queue consumer and no fallback path into
// this file, and test/watch.test.js sweeps the whole worker tree to keep it
// that way rather than trusting this paragraph.
//
// THE ORDER OF OPERATIONS, because it is the design:
//
//   1. Refuse if WATCH_ADMIN_TOKEN is not installed. An absent token means
//      publishing is impossible, never that it is unguarded.
//   2. Compare the presented token in constant time, against digests, so a
//      wrong length cannot be measured from the outside.
//   3. Flip draft to live with a conditional UPDATE and read `changes`. Two
//      simultaneous clicks cannot both win, so they cannot both send.
//   4. Only then, send. A send that fails leaves the brief published and says
//      so: the site is the product, the email is a notification.
//   5. Record the outcome on the brief. `sent_at` is what makes "publishing
//      twice does not send twice" a check against a fact.

import { json, fail, clientKey, readJsonBody } from './http.js';
import { sha256Hex, timingSafeEqualHex } from './crypto.js';
import { readSecret, beehiivSendBrief } from './integrations.js';
import { escapeHtml } from './changelog.js';
import { runWatch, watchStatus } from './watch.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

const NOT_CONFIGURED =
  'Publishing is not open on this Worker: WATCH_ADMIN_TOKEN is not set. No brief was changed and nothing was sent.';
const NOT_AUTHORISED = 'That request is not authorised.';

// Authorisation for every route in this file. Returns a Response on refusal so
// no caller can forget to act on the verdict.
async function authorise(request, env) {
  const secret = readSecret(env, 'WATCH_ADMIN_TOKEN');
  if (!secret.set) {
    console.error('watch_publish_not_configured');
    return fail(503, 'not_configured', NOT_CONFIGURED);
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
    console.warn('watch_publish_bad_token');
    return fail(401, 'bad_token', NOT_AUTHORISED);
  }
  return null;
}

// The tight limiter, shared with the delivery routes. Used when it is bound and
// not fail closed when it is absent, deliberately: the token is the control
// here, and a founder locked out of his own publish button by a missing binding
// is a worse failure than an unthrottled endpoint that still needs the token.
async function throttle(request, env) {
  if (!env.REISSUE_RATE_LIMIT) {
    console.warn('watch_publish_unlimited');
    return null;
  }
  const { success } = await env.REISSUE_RATE_LIMIT.limit({ key: clientKey(request) });
  return success ? null : fail(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.');
}

/* ---------------------------------------------------------------- publish */

export async function postPublish(request, env) {
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;

  const parsed = await readJsonBody(request);
  if (parsed.error) return fail(400, 'bad_request', parsed.error);

  const slug = typeof parsed.value.slug === 'string' ? parsed.value.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) {
    return fail(400, 'bad_slug', 'Name the brief to publish by its slug, for example watch-2026-w33.');
  }

  const brief = await env.DB.prepare(
    `SELECT id, slug, title, status, item_count, sent_at, send_status
       FROM watch_brief
      WHERE slug = ?1`,
  )
    .bind(slug)
    .first();

  if (!brief) return fail(404, 'no_such_brief', 'There is no brief with that slug.');

  // Publishing an already published brief is a no op that answers cheerfully
  // and, above all, DOES NOT SEND AGAIN. A double click on the founder's own
  // button must not mail the list twice.
  if (brief.status === 'live') {
    return json({
      ok: true,
      slug: brief.slug,
      published: true,
      already_published: true,
      sent: false,
      send_status: brief.send_status ?? null,
      sent_at: brief.sent_at ?? null,
    });
  }
  if (brief.status !== 'draft') {
    return fail(409, 'not_a_draft', `That brief is ${String(brief.status).slice(0, 20)}, so it was not published.`);
  }

  const flip = await env.DB.prepare(
    `UPDATE watch_brief
        SET status = 'live', published_at = datetime('now')
      WHERE id = ?1 AND status = 'draft'`,
  )
    .bind(brief.id)
    .run();

  // Zero changes means somebody else published it between the read and the
  // write. They own the send; this caller does not repeat it.
  if ((flip?.meta?.changes ?? 0) === 0) {
    return json({ ok: true, slug: brief.slug, published: true, already_published: true, sent: false });
  }

  const send = await sendToMembers(request, env, brief);

  return json({
    ok: true,
    slug: brief.slug,
    published: true,
    already_published: false,
    item_count: brief.item_count ?? 0,
    sent: send.sent,
    send_status: send.status,
    send_detail: send.detail ?? null,
  });
}

// The member notification. Reached from postPublish and from nowhere else.
async function sendToMembers(request, env, brief) {
  // Belt and braces against a future edit: a brief that already carries a send
  // timestamp is never sent again, whatever the caller believed.
  if (brief.sent_at) {
    console.warn('watch_send_skipped_already_sent', brief.slug);
    return { sent: false, status: brief.send_status ?? 'already_sent', detail: null };
  }

  const origin = new URL(request.url).origin;
  const url = `${origin}/watch/${brief.slug}/`;
  const title = String(brief.title ?? 'Security Watch');

  // The email is a POINTER, not a copy. It carries the headline, the count and
  // a link, so the brief itself has exactly one home and one set of citations.
  const body_html = [
    `<p>${escapeHtml(title)} is published.</p>`,
    `<p>It cites ${Number(brief.item_count ?? 0)} item(s) from Oracle's own advisory pages.</p>`,
    `<p><a href="${escapeHtml(url)}">Read it on oradiscuss.com</a></p>`,
  ].join('');

  let send;
  try {
    send = await beehiivSendBrief(env, { title, subject: title, body_html });
  } catch (err) {
    console.error('watch_send_threw', String(err?.message ?? err));
    send = { sent: false, status: 'failed', detail: null };
  }

  try {
    await env.DB.prepare(
      `UPDATE watch_brief
          SET sent_at = CASE WHEN ?1 = 1 THEN datetime('now') ELSE sent_at END,
              send_status = ?2
        WHERE id = ?3`,
    )
      .bind(send.sent ? 1 : 0, String(send.status).slice(0, 40), brief.id)
      .run();
  } catch (err) {
    // The brief is published and the mail is away. A lost bookkeeping write is
    // recorded and must not turn a successful publish into an error.
    console.error('watch_send_unrecorded', brief.slug, String(err?.message ?? err));
  }

  if (!send.sent) console.warn('watch_send_not_sent', brief.slug, send.status, send.detail ?? '');
  return send;
}

/* ------------------------------------------------------- founder read side */

// What the founder needs in order to decide what to publish: the drafts, the
// registry INCLUDING the sources nobody is watching, and the last run of each
// watched source with its failure reason. Behind the same token as publish,
// because a draft is unpublished work and a source failure is our operational
// state, neither of which is public.
export async function getWatchStatus(request, env) {
  // Throttled like its two siblings, so all three token gated routes behave the
  // same way. Uniformity is the point: an endpoint that is the odd one out is
  // the one a later edit forgets about.
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;
  return json({ ok: true, ...(await watchStatus(env)) });
}

// A manual run of the drafting job. It exists so the pipeline can be verified
// on preview WITHOUT arming a Cron Trigger anywhere, which is a founder gate.
// It takes exactly the same path as the schedule, so what it proves is true of
// the schedule, and like the schedule it cannot publish.
export async function postWatchRun(request, env) {
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;
  const summary = await runWatch(env);
  return json({ ok: true, ...summary });
}
