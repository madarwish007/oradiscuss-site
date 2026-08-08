// Fixtures for the Security Watch guards.
//
// The HTML below is the SHAPE of the real page, not an invention: it was built
// from https://www.oracle.com/security-alerts/ as fetched on 8 Aug 2026, down
// to the two cell rows, the `alert-CVE-` spelling that appears beside
// `alert-cve-`, and the <!--StartFragment--> comments Oracle's own markup
// carries inside the revision cell. A fixture that is tidier than the real page
// proves only that the parser handles tidy pages.
//
// Dates are generated RELATIVE TO NOW rather than written as constants, because
// the pipeline drops items older than RECENT_DAYS. Hard coded dates would make
// this suite pass today and fail silently in four months.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function daysAgo(n, now = new Date()) {
  return new Date(now.getTime() - n * 86400000);
}

export function oracleDate(date) {
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function row({ href, title, meta }) {
  return `<tr>\n<td><a href="${href}" target="">${title}</a></td>\n<td>${meta}</td>\n</tr>`;
}

// The default page: one item per enabled source, all recent, plus the two
// things a parser has to survive. A 2021 bulletin that must be dropped for age,
// and a row whose link points somewhere that is not Oracle.
export function oracleIndexHtml(now = new Date()) {
  const rows = [
    row({
      href: '/security-alerts/cpujul2026.html',
      // An em dash, on purpose. Oracle's own titles are ours to render, the
      // house rule forbids em dashes on any built page, and the guard that
      // enforces it reads the RENDERED page. The pipeline normalises it.
      title: 'Critical Patch Update — July 2026',
      meta: 'Rev 5, ' + oracleDate(daysAgo(9, now)),
    }),
    row({
      href: '/security-alerts/cspujun2026.html',
      title: 'Critical Security Patch Update - June 2026',
      // The Word paste comments Oracle leaves in this cell.
      meta: `<!--StartFragment-->Rev 1, ${oracleDate(daysAgo(21, now))}<!--EndFragment-->`,
    }),
    row({
      href: '/security-alerts/alert-CVE-2026-35273.html',
      title: 'Alert for CVE-2026-35273',
      meta: `Rev 1, ${oracleDate(daysAgo(3, now))}`,
    }),
    row({
      href: '/security-alerts/bulletinjul2026.html',
      title: 'Solaris Third Party Bulletin - July 2026 ',
      meta: `Rev 1, ${oracleDate(daysAgo(18, now))}`,
    }),
    row({
      href: '/security-alerts/bulletinjan2021.html',
      title: 'Solaris Third Party Bulletin - January 2021',
      meta: 'Rev 3, 19 January 2021',
    }),
    row({
      href: 'https://not-oracle.example.com/security-alerts/cpujul2026.html',
      title: 'Critical Patch Update - July 2026 mirror',
      meta: `Rev 5, ${oracleDate(daysAgo(9, now))}`,
    }),
  ];

  return `<!DOCTYPE html><html><head><title>Security Alerts</title></head><body>
<table class="otable-tech-basic"><thead><tr><th>Critical Patch Update</th><th>Latest Version/Date</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody></table>
</body></html>`;
}

// The same page with one extra alert, for the "a new item lands in the NEXT
// brief once this one is published" case.
export function oracleIndexWithExtraAlert(now = new Date()) {
  const extra = row({
    href: '/security-alerts/alert-cve-2026-40001.html',
    title: 'Alert for CVE-2026-40001',
    meta: `Rev 1, ${oracleDate(daysAgo(1, now))}`,
  });
  return oracleIndexHtml(now).replace('</tbody>', `${extra}\n</tbody>`);
}

// RSS 2.0 and Atom in one string, because the feed extractor must read either.
export function feedXml(now = new Date()) {
  const pub = daysAgo(2, now).toUTCString();
  const updated = daysAgo(4, now).toISOString();
  return `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Oracle Database 26ai Release Update 26.2 is available</title>
<link>https://blogs.oracle.com/database/post/ru-26-2</link>
<guid>https://blogs.oracle.com/database/post/ru-26-2</guid>
<pubDate>${pub}</pubDate></item>
<entry><title>An Atom shaped entry</title>
<link href="https://blogs.oracle.com/database/post/atom-one" />
<id>tag:blogs.oracle.com,2026:atom-one</id>
<updated>${updated}</updated></entry>
</channel></rss>`;
}

// A fetch stub that answers from a map of url to { status, body }, records
// every call, and can be told to throw for a given url. Every test that touches
// the network uses this: nothing in this suite reaches Oracle or beehiiv.
export function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const href = typeof url === 'string' ? url : url.url;
    calls.push({ url: href, init });
    const route = routes[href] ?? routes.default;
    if (!route) return new Response('not found', { status: 404 });
    if (route.throws) throw new Error(route.throws);
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: { 'Content-Type': route.type ?? 'text/html; charset=utf-8' },
    });
  };
  impl.calls = calls;
  impl.to = (needle) => calls.filter((c) => c.url.includes(needle));
  return impl;
}
