// PUBLISHING AND SENDING LIVE HERE, AND NOWHERE ELSE. This file is the only
// place in the repository where a Security Watch brief becomes live, and the
// only place that can mail the member list. A test sweeps the whole worker tree
// to keep that true rather than trusting this paragraph.
//
// WHAT CHANGED, AND ON WHOSE AUTHORITY. Founder ruling 9 Aug 2026, verbatim:
// "Monthly is okay, and that should be automated workflow without any human
// intervention, as a Founder, i need to get an aknowledgement about the updated
// kits only." That REVERSES his own 5 Aug standing gate, under which publishing
// the brief and sending it to the member list were founder-only actions. He was
// shown that gate and ruled anyway, so it is a knowing override.
//
// So the scheduled cycle in worker/watch-cycle.js now reaches publishBrief and
// sendBrief. THE TOKEN GATED ROUTE BELOW SURVIVES AS THE MANUAL OVERRIDE rather
// than as the only door.
//
// THE INVARIANT THAT REPLACED THE GATE, and it is enforced structurally rather
// than by discipline: NOTHING PUBLISHES WITHOUT PASSING THE CIRCUIT BREAKER,
// because the breaker runs INSIDE publishBrief, which is the only function that
// can write status = 'live'. A caller cannot forget to run it; a caller can
// only ask, explicitly and on the record, to override it.
//
// AND NOTHING SENDS WITHOUT A LIVE, NON EMPTY BRIEF AND A NAMED SEGMENT.
// Publishing and sending are two stages with two sets of checks, and they fail
// independently: a brief that publishes but cannot send HOLDS that fact in
// `send_status` and reports it, because "published but not sent" must be a
// visible state rather than an invisible one.
//
// THE ORDER OF OPERATIONS on the manual route, because it is the design:
//
//   1. Refuse if WATCH_ADMIN_TOKEN is not installed. An absent token means the
//      manual override is impossible, never that it is unguarded.
//   2. Compare the presented token in constant time, against digests, so a
//      wrong length cannot be measured from the outside.
//   3. Run the breaker and refuse a held brief, quoting every failure. `force`
//      publishes anyway and is RECORDED as manual-force, because an override
//      that leaves no trace is indistinguishable from a check that never ran.
//   4. Flip draft to live with a conditional UPDATE and read `changes`. Two
//      simultaneous clicks cannot both win, so they cannot both send.
//   5. Only then, send, through its own checks. A send that fails leaves the
//      brief published and says so: the site is the product, the email is a
//      notification.
//   6. Record the outcome on the brief. `sent_at` is what makes "publishing
//      twice does not send twice" a check against a fact.

import { json, fail, readJsonBody } from './http.js';
import { beehiivSendBrief, memberSendReadiness } from './integrations.js';
import { escapeHtml } from './changelog.js';
import { runWatch, watchStatus, lastRunSummary, patchCyclePeriod } from './watch.js';
import { parseSnapshot } from './watch-pages.js';
import { evaluateBreaker, watchConfig } from './watch-breaker.js';
import { enabledSources } from './watch-sources.js';
import { authoriseAdmin, throttleAdmin } from './admin-auth.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

const NOT_CONFIGURED =
  'Publishing is not open on this Worker: WATCH_ADMIN_TOKEN is not set. No brief was changed and nothing was sent.';

// Authorisation for every route in this file. Returns a Response on refusal so
// no caller can forget to act on the verdict.
//
// The compare itself lives in worker/admin-auth.js, shared with the release
// pipeline, which is behind the same token. It was extracted from here rather
// than copied there: one implementation of a constant time compare is one
// implementation to fix.
const GATE = { what: NOT_CONFIGURED, tag: 'watch_publish' };

const authorise = (request, env) => authoriseAdmin(request, env, GATE);
const throttle = (request, env) => throttleAdmin(request, env, GATE);

/* ------------------------------------------------- publish, stage one of two */

// THE ONLY FUNCTION IN THIS REPOSITORY THAT SETS A BRIEF LIVE, and therefore the
// only place the breaker has to be wired for the invariant to hold everywhere.
//
// `summary` is this cycle's source results when the scheduled run supplies them,
// which is the truthful reading for the automated path. When it is absent, the
// LAST RECORDED RUN of each source is read from D1 instead: that is the right
// answer for the manual override, where there is no run in flight, and it is
// worth stating that on that path the evidence may be older than the request.
//
// `force` is the founder's knowing override. It publishes over a held brief and
// stamps published_by = 'manual-force'.
export async function publishBrief(env, { slug, actor = 'manual', force = false, summary = null, now = new Date() }) {
  const brief = await env.DB.prepare(
    `SELECT id, slug, title, body_md, sources_json, status, period, item_count, published_at, sent_at, send_status
       FROM watch_brief
      WHERE slug = ?1`,
  )
    .bind(slug)
    .first();

  if (!brief) return { ok: false, code: 'no_such_brief', brief: null, breaker: null };
  if (brief.status === 'live') return { ok: false, code: 'already_published', brief, breaker: null };
  if (brief.status !== 'draft') return { ok: false, code: 'not_a_draft', brief, breaker: null };

  const config = watchConfig(env);
  const snapshot = parseSnapshot(brief.sources_json);
  const runs = summary ?? (await lastRunSummary(env));

  // "Have we already put a brief out for this Oracle patch cycle" is what tells
  // an empty draft that is parse rot from an empty draft that is simply the day
  // after publication. It is read here rather than passed in, so both callers
  // get the same answer from the same query.
  //
  // THE PERIOD ASKED ABOUT IS NOW'S, NEVER THE DRAFT'S, and getting that wrong
  // masks the exact failure the tripwire exists to catch. A draft carries the
  // month it was OPENED in, and a draft opened in August by a manual run and
  // still open in September would ask "did we publish anything for August",
  // find the August brief, and read September's parse rot as a quiet month.
  // checkStaleness names patchCyclePeriod(now) in the sentence it writes, so
  // asking about anything else would also make the query disagree with the
  // reason it produces.
  const live = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM watch_brief WHERE status = 'live' AND period = ?1",
  )
    .bind(patchCyclePeriod(now))
    .first();

  const breaker = evaluateBreaker({
    summary: runs,
    brief,
    snapshot,
    now,
    config,
    expectedIds: enabledSources().map((s) => s.id),
    publishedThisPeriod: (live?.n ?? 0) > 0,
  });

  if (!breaker.ok && !force) {
    console.warn('watch_publish_held', brief.slug, breaker.verdict, breaker.reasons ?? '');
    return { ok: false, code: breaker.verdict === 'quiet' ? 'breaker_quiet' : 'breaker_held', brief, breaker };
  }

  const stamp = breaker.ok ? actor : `${actor}-force`;
  const flip = await env.DB.prepare(
    `UPDATE watch_brief
        SET status = 'live', published_at = datetime('now'), published_by = ?2
      WHERE id = ?1 AND status = 'draft'`,
  )
    .bind(brief.id, stamp)
    .run();

  // Zero changes means somebody else published it between the read and the
  // write. They own the send; this caller does not repeat it.
  if ((flip?.meta?.changes ?? 0) === 0) {
    return { ok: false, code: 'already_published', brief, breaker };
  }

  if (!breaker.ok) console.warn('watch_publish_forced', brief.slug, breaker.reasons ?? '');
  return { ok: true, code: 'published', brief: { ...brief, status: 'live', published_by: stamp }, breaker };
}

/* ---------------------------------------------------- send, stage two of two */

// THE MEMBER SEND, AND IT IS A SEPARATE STAGE WITH ITS OWN CHECKS. The founder's
// ruling covers publishing AND sending, but the two must not be one step: the
// website is the product and the email is a notification, so a send that cannot
// happen must leave the brief published and say why rather than half firing or
// unpublishing something a reader may already have opened.
//
// EVERY REFUSAL BELOW WRITES `send_status`, so "published but not sent" is a
// state with a name in the database rather than an absence somebody has to
// notice. `sent_at` is written only on a real send.
export async function sendBrief(env, brief, { origin }) {
  // A brief that already carries a send timestamp is never sent again, whatever
  // the caller believed.
  if (brief.sent_at) {
    console.warn('watch_send_skipped_already_sent', brief.slug);
    return { sent: false, status: brief.send_status ?? 'already_sent', detail: null, recorded: false };
  }

  // THE BRIEF MUST BE LIVE. The email points at a page; mailing a link to a
  // draft would send every member to a 404.
  if (brief.status !== 'live') {
    console.warn('watch_send_refused_not_live', brief.slug, String(brief.status).slice(0, 20));
    return record(env, brief, { sent: false, status: 'not_live', detail: null });
  }

  // AND NON EMPTY. A brief citing nothing is not news, and the old design could
  // have mailed one.
  if (!(Number(brief.item_count ?? 0) >= 1)) {
    console.warn('watch_send_refused_empty', brief.slug);
    return record(env, brief, { sent: false, status: 'empty_brief', detail: null });
  }

  // AND THE LIST MUST BE REACHABLE, WITH A NAMED SEGMENT. Checked here, in the
  // stage that owns the decision, as well as inside beehiivSendBrief: with no
  // segment, beehiiv's default audience is everybody, and the free kit list is
  // not the member list. Sending a members-only brief to every address we ever
  // collected is a mistake that cannot be taken back, so the absence of that
  // value stops the send instead of widening it.
  const ready = memberSendReadiness(env);
  if (!ready.ready) {
    console.warn('watch_send_refused', brief.slug, ready.status);
    return record(env, brief, { sent: false, status: ready.status, detail: ready.detail });
  }

  const url = `${String(origin).replace(/\/+$/, '')}/watch/${brief.slug}/`;
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

  if (!send.sent) console.warn('watch_send_not_sent', brief.slug, send.status, send.detail ?? '');
  return record(env, brief, send);
}

async function record(env, brief, send) {
  try {
    await env.DB.prepare(
      `UPDATE watch_brief
          SET sent_at = CASE WHEN ?1 = 1 THEN datetime('now') ELSE sent_at END,
              send_status = ?2
        WHERE id = ?3`,
    )
      .bind(send.sent ? 1 : 0, String(send.status).slice(0, 40), brief.id)
      .run();
    return { ...send, recorded: true };
  } catch (err) {
    // The brief is published and, if it went, the mail is away. A lost
    // bookkeeping write is recorded and must not turn a successful publish into
    // an error.
    console.error('watch_send_unrecorded', brief.slug, String(err?.message ?? err));
    return { ...send, recorded: false };
  }
}

/* ------------------------------------------------------- the manual override */

export async function postPublish(request, env) {
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;

  const parsed = await readJsonBody(request);
  if (parsed.error) return fail(400, 'bad_request', parsed.error);

  const slug = typeof parsed.value.slug === 'string' ? parsed.value.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) {
    return fail(400, 'bad_slug', 'Name the brief to publish by its slug, for example watch-2026-08.');
  }
  const force = parsed.value.force === true;

  // THE LINK IN THE EMAIL COMES FROM CONFIG, NEVER FROM THIS REQUEST. It used
  // to be derived from request.url, which was safe while a person on the real
  // site was the only caller. It is not safe now that the same code path is
  // shared with a schedule: a manual publish issued against a preview host
  // would mail real members a preview link, and a mail cannot be taken back.
  // SITE_ORIGIN is declared per environment in wrangler.toml.
  const origin = watchConfig(env).siteOrigin;
  const result = await publishBrief(env, { slug, actor: 'manual', force });

  if (result.code === 'no_such_brief') return fail(404, 'no_such_brief', 'There is no brief with that slug.');
  if (result.code === 'not_a_draft') {
    return fail(409, 'not_a_draft', `That brief is ${String(result.brief.status).slice(0, 20)}, so it was not published.`);
  }

  // THE BREAKER REFUSED, and the founder is shown exactly what it refused on
  // rather than a word. He can re-run the pipeline, fix the source, or publish
  // over it with force, but he does it knowing what the check saw.
  if (result.code === 'breaker_held' || result.code === 'breaker_quiet') {
    return fail(
      409,
      result.code,
      `The circuit breaker held this brief, so nothing was published and nothing was sent. ${
        result.breaker.reasons ?? 'The draft cites nothing, so there is nothing to publish.'
      } Publish it anyway with {"slug":"${slug}","force":true}.`,
    );
  }

  // ALREADY PUBLISHED. This is not simply a cheerful no-op any more: a brief
  // that published and failed to send would otherwise be a dead end, because the
  // only route that can send is the one that refuses to look at a live brief.
  // The send is retried; `sent_at` still makes a second successful send
  // impossible, so a double click cannot mail the list twice.
  if (result.code === 'already_published') {
    const brief = result.brief;
    const retry = await sendBrief(env, { ...brief, status: 'live' }, { origin });
    return json({
      ok: true,
      slug: brief.slug,
      published: true,
      already_published: true,
      item_count: brief.item_count ?? 0,
      sent: retry.sent,
      send_status: retry.status,
      send_detail: retry.detail ?? null,
    });
  }

  const send = await sendBrief(env, result.brief, { origin });

  return json({
    ok: true,
    slug: result.brief.slug,
    published: true,
    already_published: false,
    forced: !result.breaker.ok,
    breaker: { verdict: result.breaker.verdict, reasons: result.breaker.reasons },
    item_count: result.brief.item_count ?? 0,
    sent: send.sent,
    send_status: send.status,
    send_detail: send.detail ?? null,
  });
}

/* ------------------------------------------------------- founder read side */

// What the founder needs in order to see what the automation did: the drafts,
// the registry INCLUDING the sources nobody is watching, the last run of each
// watched source with its failure reason, and the cycle ledger with every
// verdict and every hold reason. Behind the same token as publish, because a
// draft is unpublished work and a source failure is our operational state,
// neither of which is public.
export async function getWatchStatus(request, env) {
  // Throttled like its two siblings, so all three token gated routes behave the
  // same way. Uniformity is the point: an endpoint that is the odd one out is
  // the one a later edit forgets about.
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;
  const config = watchConfig(env);
  return json({
    ok: true,
    ...(await watchStatus(env)),
    config: {
      max_items: config.maxItems,
      notify_empty_cycles: config.notifyEmptyCycles,
      notify_webhook_configured: config.notifyWebhook !== null,
      site_origin: config.siteOrigin,
    },
  });
}

// A manual run of the DRAFTING job, and only the drafting job. It exists so the
// pipeline can be verified WITHOUT arming a Cron Trigger anywhere, and it stops
// at the draft deliberately: the full cycle, breaker and publish and send, is
// what the schedule runs, and POST /api/watch/publish is the lever for putting a
// verified draft out by hand.
export async function postWatchRun(request, env) {
  const refusal = (await authorise(request, env)) ?? (await throttle(request, env));
  if (refusal) return refusal;
  const summary = await runWatch(env);
  return json({ ok: true, ...summary });
}
