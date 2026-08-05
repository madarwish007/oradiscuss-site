import { useEffect, useState } from 'react';

// Prices come from D1 through /api/catalog. No page hardcodes money.
// Styling follows DESIGN.md (system: Instrument).

const RULES = [
  'The regular price is shown beside the launch price from day one. The rise is pre-announced, never a countdown.',
  'Your launch price is locked for life while you stay continuously subscribed.',
  'Annual billing only. No monthly tier.',
];

export default function PlanGrid() {
  const [state, setState] = useState({ status: 'loading', items: [] });

  useEffect(() => {
    let dead = false;
    fetch('/api/catalog')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => !dead && setState({ status: 'ready', items: d.items ?? [] }))
      .catch(() => !dead && setState({ status: 'error', items: [] }));
    return () => {
      dead = true;
    };
  }, []);

  if (state.status === 'loading') {
    return <p className="plans-note">Reading the catalogue...</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="plans-note">
        The catalogue is unavailable right now. Prices live in the database, so nothing is shown
        rather than showing a stale number.
      </p>
    );
  }

  return (
    <>
      <div className="plans">
        {state.items.map((item, i) => {
          const free = item.launch_price === 0;
          const cut = !free && item.launch_price < item.regular_price;
          return (
            <article
              key={item.sku}
              className={`plan${item.tier === 1 ? ' is-pick' : ''}`}
              style={{ '--d': `${i * 90}ms` }}
            >
              <span className="plan-k">
                {free ? 'Free forever' : `Tier ${item.tier} · annual`}
              </span>
              <h3>{item.name}</h3>
              <p className="plan-price">
                {item.launch_display}
                {!free && <small>/yr</small>}
              </p>
              {cut && <p className="plan-then">then {item.regular_display}/yr</p>}
              {cut && <p className="plan-lock">Locked for life while subscribed</p>}
              <p className="plan-blurb">{item.blurb}</p>
              <span className="plan-cta">
                {free ? 'Download the kit' : 'Join at this price'}
              </span>
            </article>
          );
        })}
      </div>
      <ul className="plan-rules">
        {RULES.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </>
  );
}
