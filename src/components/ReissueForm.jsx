import { useEffect, useId, useState } from 'react';

/* THE RE-ISSUE COUNTER. A buyer who lost their download email types the
   transaction reference from their receipt and gets fresh links.

   It follows the same law as CaptureForm, for the same reason: THE SHIPPING
   STATE IS THE DISABLED STATE. Astro prerenders this island, so what lands in
   dist/ is a disabled fieldset and a line of prose saying so. Hydration can
   only OPEN it, and only after /api/config confirms the signing key is
   installed. No JavaScript, a failed fetch, a missing secret: every one of
   those leaves a form that cannot take a reference it could not act on.

   It asks for no email and no name, and the server stores nothing from this
   form. The reference is proof of purchase; it is not an identity. */

const ENDPOINT = '/api/reissue';
const DELETE_ENDPOINT = '/api/entitlement/delete';

export default function ReissueForm() {
  const [gate, setGate] = useState({ phase: 'unknown' });
  const [reference, setReference] = useState('');
  const [result, setResult] = useState({ phase: 'idle', message: '', links: [] });
  const [removal, setRemoval] = useState({ phase: 'idle', message: '' });

  const uid = useId();
  const refId = `${uid}-reference`;
  const hintId = `${uid}-hint`;

  useEffect(() => {
    let dead = false;
    fetch('/api/config', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (dead) return;
        setGate({ phase: d.delivery_enabled ? 'open' : 'closed' });
      })
      .catch(() => {
        /* Fail closed. An unanswered question is not a yes. */
        if (!dead) setGate({ phase: 'unreachable' });
      });
    return () => {
      dead = true;
    };
  }, []);

  const open = gate.phase === 'open';
  const sending = result.phase === 'sending';
  const canSubmit = open && !sending && reference.trim().length >= 6;

  async function onSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setResult({ phase: 'sending', message: '', links: [] });
    setRemoval({ phase: 'idle', message: '' });

    let res;
    let data = null;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reference: reference.trim() }),
      });
      data = await res.json().catch(() => null);
    } catch {
      setResult({
        phase: 'error',
        message: 'That did not reach us. Check your connection and try again.',
        links: [],
      });
      return;
    }

    if (res.ok && data?.ok) {
      const links = Array.isArray(data.links) ? data.links : [];
      setResult({
        phase: links.length ? 'done' : 'empty',
        message: links.length
          ? 'Fresh links, valid for five minutes. Start the download before they expire, and come back here for more.'
          : 'That membership is active, and there is nothing released against it yet. Nothing to download today.',
        links,
      });
      return;
    }

    setResult({
      phase: 'error',
      message: data?.error ?? 'Something went wrong. Nothing was changed, so try again in a moment.',
      links: [],
    });
  }

  async function onDelete() {
    if (!open || removal.phase === 'sending') return;
    setRemoval({ phase: 'sending', message: '' });
    let data = null;
    try {
      const res = await fetch(DELETE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ reference: reference.trim(), confirm: true }),
      });
      data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setRemoval({
          phase: 'error',
          message: data?.error ?? 'That did not go through. Nothing was deleted.',
        });
        return;
      }
    } catch {
      setRemoval({ phase: 'error', message: 'That did not reach us. Nothing was deleted.' });
      return;
    }

    setResult({ phase: 'idle', message: '', links: [] });
    setRemoval({
      phase: 'done',
      message: `${data.message} ${data.note}`,
    });
  }

  return (
    <div className="rei">
      <p className={`rei-state rei-state-${open ? 'on' : 'off'}`} aria-live="polite">
        {gateLine(gate)}
      </p>
      <noscript>
        <p className="rei-state rei-state-off">
          This form needs JavaScript. If you would rather not run it, write to the support address
          on the contact page with your transaction reference.
        </p>
      </noscript>

      <form className="rei-form" onSubmit={onSubmit} noValidate>
        <fieldset className="rei-fields" disabled={!open || sending}>
          <div className="rei-row">
            <label className="rei-label" htmlFor={refId}>
              Transaction reference
            </label>
            <input
              className="rei-input"
              id={refId}
              name="reference"
              type="text"
              autoComplete="off"
              spellCheck="false"
              required
              aria-describedby={hintId}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <p className="rei-hint" id={hintId}>
              It is printed on the receipt and the invoice from the Merchant of Record who took your
              payment. It is the only thing we can identify a membership by, because it is the only
              thing about you we keep.
            </p>
          </div>

          <button className="rei-submit" type="submit" disabled={!canSubmit}>
            {sending ? 'Checking...' : 'Send me fresh links'}
          </button>
        </fieldset>
      </form>

      {result.phase !== 'idle' && result.phase !== 'sending' && (
        <p className={`rei-result rei-result-${result.phase}`} role="status">
          {result.message}
        </p>
      )}

      {result.phase === 'done' && (
        <ul className="rei-links">
          {result.links.map((link) => (
            <li className="rei-link" key={`${link.pack}-${link.version}`}>
              <a href={link.url}>
                {link.pack} {link.version}
              </a>
              <span className="rei-sha">{link.sha256}</span>
            </li>
          ))}
        </ul>
      )}

      <details className="rei-erase">
        <summary>Delete what we hold</summary>
        <p>
          We hold one thing against your purchase: a one way hash of the reference above. Deleting
          it is immediate and it ends member downloads. While the subscription is still live at the
          Merchant of Record, its next event recreates the hash, so cancel there first if you want
          it to stay gone.
        </p>
        <button
          className="rei-erase-go"
          type="button"
          onClick={onDelete}
          disabled={!open || reference.trim().length < 6 || removal.phase === 'sending'}
        >
          {removal.phase === 'sending' ? 'Deleting...' : 'Delete the hash for this reference'}
        </button>
        {removal.phase !== 'idle' && removal.phase !== 'sending' && (
          <p className={`rei-result rei-result-${removal.phase}`} role="status">
            {removal.message}
          </p>
        )}
      </details>
    </div>
  );
}

/* One sentence per state, each one true in that state. The default is what a
   visitor sees with no JavaScript and what sits in the built HTML. */
function gateLine(gate) {
  if (gate.phase === 'open') {
    return 'Enter the reference from your receipt. No account, no password, no email needed.';
  }
  if (gate.phase === 'closed') {
    return 'Re-issue is not open yet: the download signing key is not installed on the server. The form stays disabled rather than take a reference it could not act on.';
  }
  if (gate.phase === 'unreachable') {
    return 'We could not confirm that downloads are open, so the form stays disabled. Nothing typed here would reach us.';
  }
  return 'This form is disabled until the download service confirms it is open. Nothing typed here is stored anywhere.';
}
