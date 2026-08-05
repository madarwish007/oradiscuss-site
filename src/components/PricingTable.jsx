import { useEffect, useState } from 'react';

// The first interactive island. It exists to prove the system end to end:
// D1 holds the price truth, the Worker serves it at /api/catalog, and this
// component renders it. No price is ever hardcoded in a page.
//
// Design note: this is deliberately plain. The Design seat replaces the visual
// treatment in Phase 2; what must survive that pass is the data path, the
// launch-beside-regular rule, and the loading/error states.

const RULES = [
  'The regular price is shown beside the launch price from day one. The rise is pre-announced, never a countdown.',
  'Your launch price is locked for life while you stay continuously subscribed.',
  'Annual billing only. No monthly tier.',
];

export default function PricingTable() {
  const [state, setState] = useState({ status: 'loading', items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/catalog')
      .then((r) => {
        if (!r.ok) throw new Error(`Catalog unavailable (${r.status})`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', items: data.items ?? [], error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', items: [], error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return <p style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 14 }}>Loading the catalogue...</p>;
  }

  if (state.status === 'error') {
    return (
      <p style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 14 }}>
        {state.error}. The prices live in the database, so nothing is shown rather than showing a stale number.
      </p>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
          minWidth: 0,
        }}
      >
        {state.items.map((item) => {
          const isFree = item.launch_price === 0;
          const discounted = !isFree && item.launch_price < item.regular_price;
          return (
            <div
              key={item.sku}
              style={{
                border: `1px solid ${item.tier === 1 ? 'var(--red)' : 'var(--border)'}`,
                borderRadius: 'var(--r-lg)',
                background: 'var(--surface)',
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minWidth: 0,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  color: item.tier === 1 ? 'var(--red)' : 'var(--ink-4)',
                }}
              >
                {isFree ? 'Free forever' : `Tier ${item.tier} · annual`}
              </span>

              <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{item.name}</h3>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-.02em' }}>
                  {item.launch_display}
                </span>
                {!isFree && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-4)' }}>
                    /{item.billing_period}
                  </span>
                )}
                {discounted && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-4)' }}>
                    then {item.regular_display}/{item.billing_period}
                  </span>
                )}
              </div>

              {discounted && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ok)' }}>
                  Launch price, locked for life while subscribed
                </span>
              )}

              <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6 }}>{item.blurb}</p>
            </div>
          );
        })}
      </div>

      <ul
        style={{
          marginTop: 22,
          paddingLeft: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          fontSize: 13.5,
          color: 'var(--ink-3)',
        }}
      >
        {RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </div>
  );
}
