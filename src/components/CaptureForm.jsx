import { useEffect, useId, useRef, useState } from 'react';

/* The capture layer's one form, shared by /kit/ and /roadmap/.
   System: Instrument (DESIGN.md). Styles live in the CAPTURE FORM section of
   src/styles/global.css because two pages share them.

   THE SHIPPING STATE IS THE DISABLED STATE, and that is deliberate.

   Astro prerenders this island, so what lands in dist/ is the CLOSED form: a
   disabled fieldset and a line of prose saying it is disabled. Hydration can
   only ever OPEN it, and only after /api/config confirms that both the bot
   check and the list are actually wired. Every failure mode therefore leaves a
   form that cannot take an address: no JavaScript, a failed fetch, a missing
   secret, a blocked widget. The one outcome this component must never have is
   accepting an address it cannot deliver, or showing a success that did not
   happen. */

const VARIANTS = {
  kit: {
    endpoint: '/api/subscribe',
    label: 'Your email address',
    hint: 'One email when the kit ships, and the Security Watch if you want it. Unsubscribe in one click.',
    cta: 'Send me the kit when it ships',
    working: 'Registering...',
    done: {
      pending: 'Almost there. Check your inbox and confirm, and the kit reaches you the day it ships.',
      active: 'You are on the list. The kit is not built yet, and it reaches you the day it is.',
    },
  },
  roadmap: {
    endpoint: '/api/roadmap/vote',
    label: 'Your email address',
    hint: 'One email when that course ships. Your choice routes the build order, nothing else.',
    cta: 'Tell me when this ships',
    working: 'Registering...',
    done: {
      pending: 'Almost there. Check your inbox and confirm, and your choice is registered.',
      active: 'Registered. You will hear from us when that course ships.',
    },
  },
};

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/* Loaded once per page, and only after the server has said there is a site key
   worth loading it for. A blocked or failed script leaves the form closed. */
let turnstileLoader = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = TURNSTILE_SRC;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('absent')));
    tag.onerror = () => reject(new Error('blocked'));
    document.head.appendChild(tag);
  });
  return turnstileLoader;
}

export default function CaptureForm({ variant = 'kit' }) {
  const copy = VARIANTS[variant] ?? VARIANTS.kit;
  const isRoadmap = variant === 'roadmap';

  /* 'unknown' is what the server renders and what the browser hydrates into,
     so the two agree and nothing flashes. It can become 'open' only on a
     positive answer from /api/config. */
  const [gate, setGate] = useState({ phase: 'unknown', siteKey: null, missing: [] });
  const [courses, setCourses] = useState({ phase: 'unknown', items: [] });
  const [email, setEmail] = useState('');
  const [course, setCourse] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState({ phase: 'idle', message: '' });

  const uid = useId();
  const emailId = `${uid}-email`;
  const hintId = `${uid}-hint`;
  const widgetRef = useRef(null);
  const widgetIdRef = useRef(null);

  /* Is the capture layer wired? Only the server knows, because only the server
     can see the secrets. */
  useEffect(() => {
    let dead = false;
    fetch('/api/config', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (dead) return;
        if (d.capture_enabled && d.turnstile_site_key) {
          setGate({ phase: 'open', siteKey: d.turnstile_site_key, missing: [] });
        } else {
          setGate({ phase: 'closed', siteKey: null, missing: d.missing_secrets ?? [] });
        }
      })
      .catch(() => {
        /* Fail closed. An unanswered question is not a yes. */
        if (!dead) setGate({ phase: 'unreachable', siteKey: null, missing: [] });
      });
    return () => {
      dead = true;
    };
  }, []);

  /* The roadmap reads its courses from D1 through /api/roadmap, so the page
     never carries a hand-written copy of what the database already knows. */
  useEffect(() => {
    if (!isRoadmap) return undefined;
    let dead = false;
    fetch('/api/roadmap', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => !dead && setCourses({ phase: 'ready', items: d.courses ?? [] }))
      .catch(() => !dead && setCourses({ phase: 'error', items: [] }));
    return () => {
      dead = true;
    };
  }, [isRoadmap]);

  /* The widget mounts only once the gate is open, and the submit button stays
     dead until its callback hands over a token, so a visitor can never submit
     into a guaranteed refusal. */
  useEffect(() => {
    if (gate.phase !== 'open' || !gate.siteKey || !widgetRef.current) return undefined;
    let dead = false;
    loadTurnstile()
      .then((turnstile) => {
        if (dead || !widgetRef.current) return;
        widgetIdRef.current = turnstile.render(widgetRef.current, {
          sitekey: gate.siteKey,
          theme: 'light',
          callback: (t) => setToken(t),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        });
      })
      .catch(() => {
        if (!dead) setGate({ phase: 'no-widget', siteKey: null, missing: [] });
      });
    return () => {
      dead = true;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [gate.phase, gate.siteKey]);

  const open = gate.phase === 'open';
  const sending = result.phase === 'sending';
  const finished = result.phase === 'done';
  const canSubmit = open && !sending && !finished && Boolean(token) && email.trim().length > 0 && (!isRoadmap || Boolean(course));

  async function onSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setResult({ phase: 'sending', message: '' });

    const payload = { email: email.trim(), turnstile_token: token };
    if (isRoadmap) payload.course_slug = course;

    let res;
    let data = null;
    try {
      res = await fetch(copy.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      data = await res.json().catch(() => null);
    } catch {
      setResult({ phase: 'error', message: 'That did not reach us. Check your connection and try again.' });
      resetWidget();
      return;
    }

    if (res.ok && data?.ok) {
      /* Only ever the message the SERVER's answer earns: pending means the
         address is not on the list until they confirm, and saying otherwise
         would be the same lie as dropping it. */
      setResult({ phase: 'done', message: copy.done[data.status === 'active' ? 'active' : 'pending'] });
      return;
    }

    setResult({
      phase: 'error',
      message: data?.error ?? 'Something went wrong and nothing was stored. Please try again.',
    });
    resetWidget();
  }

  function resetWidget() {
    setToken('');
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
  }

  function again() {
    setResult({ phase: 'idle', message: '' });
    setCourse('');
    resetWidget();
  }

  return (
    <div className="cap">
      <p className={`cap-state cap-state-${open ? 'on' : 'off'}`} aria-live="polite">
        {gateLine(gate)}
      </p>
      <noscript>
        <p className="cap-state cap-state-off">
          This form needs JavaScript, because the bot check that protects it runs in the browser.
        </p>
      </noscript>

      <form className="cap-form" onSubmit={onSubmit} noValidate>
        {/* The outer fieldset exists to carry one attribute: disabled. It has
            no legend on purpose, because a visually hidden one would be
            content that only assistive technology can reach, and the page
            heading above already names what this form does. */}
        <fieldset className="cap-fields" disabled={!open || sending || finished}>
          {isRoadmap && (
            <fieldset className="cap-courses">
              <legend className="cap-courses-legend">Which course do you want first?</legend>
              {courses.phase === 'unknown' && (
                <p className="cap-note">Reading the roadmap from the database.</p>
              )}
              {courses.phase === 'error' && (
                <p className="cap-note">
                  The roadmap could not be read just now. The courses live in the database, so nothing
                  is shown rather than a stale list.
                </p>
              )}
              {courses.phase === 'ready' &&
                courses.items.map((c) => (
                  <label className="cap-course" key={c.course_slug}>
                    <input
                      type="radio"
                      name={`${uid}-course`}
                      value={c.course_slug}
                      checked={course === c.course_slug}
                      onChange={() => setCourse(c.course_slug)}
                    />
                    <span className="cap-course-body">
                      <span className="cap-course-title">{c.title}</span>
                      <span className="cap-course-summary">{c.summary}</span>
                    </span>
                  </label>
                ))}
            </fieldset>
          )}

          <div className="cap-row">
            <label className="cap-label" htmlFor={emailId}>
              {copy.label}
            </label>
            <input
              className="cap-input"
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              aria-describedby={hintId}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="cap-hint" id={hintId}>
              {copy.hint}
            </p>
          </div>

          {open && <div className="cap-widget" ref={widgetRef} />}

          <button className="cap-submit" type="submit" disabled={!canSubmit}>
            {sending ? copy.working : copy.cta}
          </button>
        </fieldset>
      </form>

      {result.phase !== 'idle' && result.phase !== 'sending' && (
        <p className={`cap-result cap-result-${result.phase}`} role="status">
          {result.message}
        </p>
      )}

      {finished && isRoadmap && (
        <button className="cap-again" type="button" onClick={again}>
          Register another course
        </button>
      )}

      <p className="cap-privacy">
        Your address goes to our newsletter provider and nowhere else. We keep no customer database:
        there is no table here that could hold you.
      </p>
    </div>
  );
}

/* One sentence per state, each one true in that state. The default, which is
   what a visitor sees with no JavaScript and what sits in the built HTML, says
   the form is shut rather than claiming to know why. */
function gateLine(gate) {
  if (gate.phase === 'open') {
    return 'Sign-ups are open. One address, no account, unsubscribe in one click.';
  }
  if (gate.phase === 'closed') {
    /* Name the SERVICE, not the environment variable. A visitor can act on
       "the newsletter service is not connected"; BEEHIIV_PUBLICATION_ID reads
       as a stack trace on a sales page. The variable names are still exact in
       /api/health and in the endpoint's own 503, which is where the founder
       and any developer will look. */
    const services = [];
    if (gate.missing.some((n) => n.startsWith('BEEHIIV'))) services.push('the newsletter service');
    if (gate.missing.some((n) => n.startsWith('TURNSTILE'))) services.push('the bot check');
    const what = services.length ? services.join(' and ') : 'the newsletter service';
    const verb = services.length > 1 ? 'are' : 'is';
    return `Sign-ups are not open yet: ${what} ${verb} not connected on the server. The form stays disabled rather than take an address that could not be delivered.`;
  }
  if (gate.phase === 'no-widget') {
    return 'The bot check could not load, so the form stays disabled. Nothing typed here would reach us.';
  }
  if (gate.phase === 'unreachable') {
    return 'We could not confirm that sign-ups are open, so the form stays disabled. Nothing typed here would reach us.';
  }
  return 'This form is disabled until the connection to the list is confirmed. Nothing typed here is stored anywhere.';
}
