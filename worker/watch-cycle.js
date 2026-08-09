// THE MONTHLY CYCLE. Draft, then verify, then publish, then send, then tell the
// founder. It is the only thing the Cron Trigger runs, and it is the file that
// joins the three modules that were deliberately kept apart:
//
//   worker/watch.js          fetches and drafts, and can do nothing else
//   worker/watch-breaker.js  decides whether a draft may go out
//   worker/watch-publish.js  the only place that sets a brief live or mails
//
// FOUNDER RULING 9 Aug 2026, verbatim: "Monthly is okay, and that should be
// automated workflow without any human intervention, as a Founder, i need to
// get an aknowledgement about the updated kits only." That reverses his own
// 5 Aug standing gate under which publishing and sending were founder-only. He
// was shown the gate and ruled anyway, so it is a knowing override.
//
// FOUR PROPERTIES THIS FILE EXISTS TO HAVE:
//
//   1. THE BREAKER IS NOT OPTIONAL. This file does not check anything itself
//      and cannot skip a check, because publishBrief runs the breaker inside
//      the only function that can write status = 'live'. What this file does is
//      hand it the summary of the run that just happened, which is the truthful
//      reading of THIS cycle rather than of whatever was last recorded.
//   2. PUBLISH AND SEND ARE TWO STAGES. A brief that publishes and cannot send
//      is a published brief with a send_status, reported as such. It is never
//      unpublished, and never half fired in silence.
//   3. EVERY CYCLE LEAVES A ROW, including a quiet one. Silent to the founder is
//      not the same as unrecorded, and the whole feature's failure mode is a
//      watch that quietly stopped watching.
//   4. THE ACKNOWLEDGEMENT IS ABOUT SOMETHING. He is told when a cycle produced
//      a brief, and when the breaker HELD one, because a hold is a fault he
//      needs to know about. A genuinely quiet, healthy month says nothing,
//      unless NOTIFY_EMPTY_CYCLES is switched on. An acknowledgement of nothing
//      is exactly the recurring chore his automation-first ruling bans.

import { runWatch, patchCyclePeriod } from './watch.js';
import { publishBrief, sendBrief } from './watch-publish.js';
import { watchConfig } from './watch-breaker.js';

// An acknowledgement that hangs is worse than one that fails: the cycle has
// already published by the time it is sent.
const NOTIFY_TIMEOUT_MS = 10000;

/* ------------------------------------------------------------- the ledger */

// Written BEFORE the acknowledgement is attempted, so a cycle whose webhook was
// unreachable is visible as a cycle that happened and did not reach him, rather
// than as no cycle at all.
async function recordCycle(env, row) {
  const res = await env.DB.prepare(
    `INSERT INTO watch_cycle (period, brief_slug, verdict, item_count, items_new, reasons, send_status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      row.period ?? null,
      row.brief_slug ?? null,
      row.verdict,
      row.item_count ?? 0,
      row.items_new ?? 0,
      row.reasons ? String(row.reasons).slice(0, 900) : null,
      row.send_status ?? null,
    )
    .run();
  return res?.meta?.last_row_id ?? null;
}

async function recordNotification(env, id, notify) {
  if (id === null) return;
  await env.DB.prepare('UPDATE watch_cycle SET notified = ?2, notify_status = ?3 WHERE id = ?1')
    .bind(id, notify.notified ? 1 : 0, String(notify.status).slice(0, 40))
    .run();
}

/* ------------------------------------------------- the acknowledgement */

// WHAT HE IS TOLD, and it carries no person: a period, a slug, a verdict, counts
// and machine written reason strings. There is no address, no name and no
// subscriber identifier anywhere in this payload, and there is no column in
// watch_cycle that could hold one either.
function acknowledgement(cycle) {
  return {
    event: 'oradiscuss.watch.cycle',
    ran_at: cycle.ran_at,
    period: cycle.period,
    verdict: cycle.verdict,
    item_count: cycle.item_count,
    items_new: cycle.items_new,
    brief: cycle.brief_slug ? { slug: cycle.brief_slug, title: cycle.title ?? null, url: cycle.url ?? null } : null,
    sent: cycle.sent === true,
    send_status: cycle.send_status ?? null,
    reasons: cycle.reasons ?? null,
  };
}

// TELL HIM WHEN THERE IS SOMETHING TO TELL.
//
//   published  always, that is the acknowledgement he asked for
//   held       always, a hold is a fault and he needs to know the watch is not
//              watching, whatever NOTIFY_EMPTY_CYCLES says
//   quiet      only when NOTIFY_EMPTY_CYCLES is on, and it DEFAULTS TO OFF
//
// The log line goes out whatever the channel does, because Workers observability
// is enabled on this Worker and that line is the record of last resort.
export async function acknowledge(env, config, cycle, fetcher = fetch) {
  if (cycle.verdict === 'quiet' && !config.notifyEmptyCycles) {
    console.log('watch_ack_suppressed_quiet', cycle.period ?? '', 'NOTIFY_EMPTY_CYCLES is off');
    return { notified: false, status: 'suppressed_quiet' };
  }

  const payload = acknowledgement(cycle);
  console.log(
    'watch_ack',
    `verdict=${payload.verdict}`,
    `period=${payload.period ?? 'none'}`,
    `brief=${payload.brief?.slug ?? 'none'}`,
    `items=${payload.item_count}`,
    `send=${payload.send_status ?? 'none'}`,
    `reasons=${payload.reasons ?? 'none'}`,
  );

  if (!config.notifyWebhook) {
    // Honest degradation, the same way every other integration in this codebase
    // degrades: the acknowledgement is recorded and queryable, and it reached
    // no inbox. Saying "delivered" here would be the one failure this layer
    // must not have.
    return { notified: false, status: 'not_configured' };
  }

  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(NOTIFY_TIMEOUT_MS);
  }

  let res;
  try {
    // One POST, no retries. A retry loop inside a scheduled handler that has
    // already published is a way to turn a missed notification into a missed
    // cycle, and the row in watch_cycle is the durable record either way.
    res = await fetcher(config.notifyWebhook, init);
  } catch (err) {
    console.error('watch_ack_unreachable', String(err?.message ?? err).slice(0, 120));
    return { notified: false, status: 'unreachable' };
  }
  if (!res.ok) {
    console.error('watch_ack_failed', `http_${res.status}`);
    return { notified: false, status: `http_${res.status}`.slice(0, 40) };
  }
  return { notified: true, status: 'delivered' };
}

/* --------------------------------------------------------------- the cycle */

// THE WHOLE JOB. Called by the Cron Trigger through worker.js `scheduled`.
//
// `options` exists so the guards can drive it with a stub fetcher and a fixed
// clock. It takes exactly the same path either way, so what a test proves is
// true of the schedule.
export async function runWatchCycle(env, options = {}) {
  const now = options.now ?? new Date();
  const config = watchConfig(env);
  const notifyFetcher = options.notifyFetcher ?? options.fetcher ?? fetch;

  const summary = await runWatch(env, { ...options, now });

  const cycle = {
    ran_at: now.toISOString(),
    period: patchCyclePeriod(now),
    brief_slug: summary.brief?.slug ?? null,
    title: null,
    url: null,
    verdict: 'held',
    item_count: summary.brief?.item_count ?? 0,
    items_new: summary.items_new ?? 0,
    reasons: null,
    send_status: null,
    sent: false,
  };

  if (!summary.brief) {
    // The roll up failed, so there is no draft to judge. That is a fault and it
    // is reported as one rather than read as a quiet month.
    cycle.reasons = `the draft could not be rolled up: ${summary.brief_error ?? 'unknown'}`;
  } else {
    const publish = await publishBrief(env, {
      slug: summary.brief.slug,
      actor: 'auto',
      // THE RUN THAT JUST HAPPENED, not the last one recorded. A source whose
      // failure row could not be written must still fail this cycle.
      summary,
      now,
    });

    cycle.period = publish.brief?.period ?? cycle.period;
    cycle.item_count = publish.brief?.item_count ?? cycle.item_count;
    cycle.title = publish.brief?.title ?? null;

    if (publish.ok) {
      cycle.verdict = 'published';
      cycle.url = `${config.siteOrigin.replace(/\/+$/, '')}/watch/${publish.brief.slug}/`;
      const send = await sendBrief(env, publish.brief, { origin: config.siteOrigin });
      cycle.sent = send.sent === true;
      cycle.send_status = send.status;
    } else if (publish.code === 'breaker_quiet') {
      cycle.verdict = 'quiet';
    } else if (publish.code === 'breaker_held') {
      cycle.verdict = 'held';
      cycle.reasons = publish.breaker.reasons;
    } else {
      cycle.verdict = 'held';
      cycle.reasons = `the draft was not publishable: ${publish.code}`;
    }
  }

  let id = null;
  try {
    id = await recordCycle(env, cycle);
  } catch (err) {
    // The failure of the record. It cannot be swallowed: this table is the only
    // thing that tells a quiet month from a watch that stopped watching.
    console.error('watch_cycle_unrecorded', String(err?.message ?? err).slice(0, 120));
  }

  // AN ACKNOWLEDGEMENT CAN NEVER UNDO A CYCLE. By the time this runs the brief
  // may already be live and the mail already away, so a notification that throws
  // is recorded as a notification that did not land, and nothing else.
  let notify;
  try {
    notify = await acknowledge(env, config, cycle, notifyFetcher);
  } catch (err) {
    console.error('watch_ack_threw', String(err?.message ?? err).slice(0, 120));
    notify = { notified: false, status: 'threw' };
  }

  try {
    await recordNotification(env, id, notify);
  } catch (err) {
    console.error('watch_cycle_notification_unrecorded', String(err?.message ?? err).slice(0, 120));
  }

  return { ...summary, cycle: { ...cycle, notified: notify.notified, notify_status: notify.status } };
}
