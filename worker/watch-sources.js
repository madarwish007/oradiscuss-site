// THE SECURITY WATCH SOURCE REGISTRY.
//
// What the watcher monitors is DATA, listed here once, rather than URLs buried
// in a fetch function. Adding a source is a row in this file; the pipeline in
// worker/watch.js reads the row and never names a source itself.
//
// BUILD_PLAN integration 07 sets the law this file obeys:
//   - PUBLIC Oracle sources only, cited and linked, never bulk reproduced.
//   - My Oracle Support requires an authenticated session and CANNOT be
//     scraped. Nothing here claims MOS coverage, and nothing here ever will.
//     MOS notes enter a brief only when the founder adds them by hand.
//
// EVERY ROW CARRIES ITS OWN EVIDENCE. `verified` is the date a seat actually
// fetched the URL and parsed rows out of it, and `verified_note` says what came
// back. A row with `verified: null` is a source we WANT and have not confirmed,
// and it ships `enabled: false` so the pipeline does not pretend to watch
// something it has never reached. That distinction is the point of the field:
// an unwatched source must be visible as unwatched, never absent.

// One Oracle page carries four tables: the quarterly Critical Patch Updates,
// the newer monthly Critical Security Patch Updates, the out of cycle Security
// Alerts, and the Solaris third party bulletins. They are four SOURCES because
// they mean different things to a reader, and one URL because that is where
// Oracle publishes them. worker/watch.js fetches a URL once per run however
// many sources point at it.
export const ORACLE_ALERT_INDEX = 'https://www.oracle.com/security-alerts/';

// A resolved item URL must live on one of these hosts or it is dropped. The
// pipeline builds item URLs out of a fetched page, so this is what stops a
// changed or hostile page from planting a link to somewhere else.
const ORACLE_HOSTS = Object.freeze(['www.oracle.com', 'oracle.com']);
const BLOG_HOSTS = Object.freeze(['blogs.oracle.com']);

// Verified 8 Aug 2026 from this machine: GET https://www.oracle.com/security-alerts/
// answered 200 text/html, 49,778 bytes, and the row matcher below parsed 55
// rows out of it: 23 Critical Patch Updates, 2 Critical Security Patch Updates,
// 7 Security Alerts, 23 Solaris bulletins. Two linked pages were spot checked
// and both answered 200 (cpujul2026.html, alert-cve-2025-61882.html).
const ORACLE_INDEX_VERIFIED = '2026-08-08';

export const SOURCES = Object.freeze([
  Object.freeze({
    id: 'oracle-cpu',
    label: 'Oracle Critical Patch Update advisories',
    detail:
      'The quarterly advisory Oracle publishes on the Tuesday closest to the 17th of January, April, July and October. Each release is revised for weeks afterwards, and a revision is news.',
    url: ORACLE_ALERT_INDEX,
    kind: 'oracle-alert-index',
    // Item identity: the advisory path plus its revision string.
    pathPattern: /^\/security-alerts\/cpu[a-z]{3}\d{4}\.html$/i,
    hosts: ORACLE_HOSTS,
    maxItems: 25,
    enabled: true,
    verified: ORACLE_INDEX_VERIFIED,
    verified_note: '23 rows parsed, newest Critical Patch Update July 2026 Rev 5, 30 July 2026',
  }),

  Object.freeze({
    id: 'oracle-cspu',
    label: 'Oracle Critical Security Patch Updates',
    detail:
      'The monthly series Oracle began publishing in 2026 alongside the quarterly Critical Patch Update. Confirmed present on the index, and deliberately kept as its own source because its cadence is different.',
    url: ORACLE_ALERT_INDEX,
    kind: 'oracle-alert-index',
    pathPattern: /^\/security-alerts\/cspu[a-z]{3}\d{4}\.html$/i,
    hosts: ORACLE_HOSTS,
    maxItems: 25,
    enabled: true,
    verified: ORACLE_INDEX_VERIFIED,
    verified_note: '2 rows parsed: May 2026 Rev 1 and June 2026 Rev 1',
  }),

  Object.freeze({
    id: 'oracle-security-alert',
    label: 'Oracle Security Alerts',
    detail:
      'Out of cycle alerts for a single CVE, published when Oracle will not wait for the next quarterly advisory. These are the items the brief exists for.',
    url: ORACLE_ALERT_INDEX,
    kind: 'oracle-alert-index',
    // The index carries both alert-cve- and alert-CVE- spellings, so this is
    // deliberately case insensitive. A case sensitive pattern would silently
    // drop the two most recent alerts on the page.
    pathPattern: /^\/security-alerts\/alert-cve-\d{4}-\d{4,7}\.html$/i,
    hosts: ORACLE_HOSTS,
    maxItems: 25,
    enabled: true,
    verified: ORACLE_INDEX_VERIFIED,
    verified_note: '7 rows parsed, newest Alert for CVE-2026-35273 Rev 1, 10 June 2026',
  }),

  Object.freeze({
    id: 'oracle-solaris-bulletin',
    label: 'Oracle Solaris third party bulletins',
    detail:
      'Third party component fixes for Solaris. Relevant only to an estate running Oracle Database on Solaris or SPARC, which is why it is a separate source the founder can switch off without touching the others.',
    url: ORACLE_ALERT_INDEX,
    kind: 'oracle-alert-index',
    pathPattern: /^\/security-alerts\/bulletin[a-z]{3}\d{4}\.html$/i,
    hosts: ORACLE_HOSTS,
    maxItems: 25,
    enabled: true,
    verified: ORACLE_INDEX_VERIFIED,
    verified_note: '23 rows parsed, newest Solaris Third Party Bulletin July 2026 Rev 1',
  }),

  // NOT WATCHED, and listed so that it is visibly not watched.
  //
  // Every blogs.oracle.com feed probed on 8 Aug 2026 answered 403 from this
  // machine, with an Oracle firewall error page rather than a feed, under both
  // a plain and a browser user agent: /security/rss, /database/rss,
  // /cloud-infrastructure/rss, /database/rss.xml and /feed. The block may be on
  // this network rather than on the feed, and a Cloudflare Worker leaves from a
  // different address, so this may work in production and cannot be claimed
  // from here. The parser for it exists and is tested; only the source is
  // unconfirmed.
  //
  // To turn it on: fetch the URL from the environment that will run the job,
  // confirm a feed comes back, set enabled true and fill in `verified`.
  Object.freeze({
    id: 'oracle-database-blog',
    label: 'Oracle Database product blog',
    detail:
      'Release update announcements and product notes. Would carry the RU news the advisory index does not.',
    url: 'https://blogs.oracle.com/database/rss',
    kind: 'feed',
    hosts: BLOG_HOSTS,
    maxItems: 15,
    enabled: false,
    verified: null,
    verified_note: 'HTTP 403 from this machine on 8 Aug 2026, an Oracle firewall page rather than a feed. Unconfirmed, so not watched.',
  }),
]);

// Every host any registered source may link to. The render path checks a stored
// item URL against this before it becomes an anchor, so the set of places a
// published brief can send a reader is decided HERE, in the registry, and not
// by whatever a fetched page happened to contain.
export function registryHosts() {
  return [...new Set(SOURCES.flatMap((s) => s.hosts))];
}

export function enabledSources() {
  return SOURCES.filter((s) => s.enabled);
}

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id) ?? null;
}

// The registry as it is safe to report: no regular expressions, no internals,
// and the unwatched sources included on purpose.
export function registrySummary() {
  return SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    url: s.url,
    kind: s.kind,
    enabled: s.enabled,
    verified: s.verified,
    verified_note: s.verified_note,
  }));
}
