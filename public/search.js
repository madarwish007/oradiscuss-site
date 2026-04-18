/*
 * OraDiscuss site search — drop-in client script.
 * Wires the existing #SI input + #SD dropdown to a search over /rss.xml.
 * No build step, no hard-coded article list — the index is the RSS feed,
 * so new articles show up automatically after deploy.
 *
 * Install:
 *   1. Copy this file to your Astro repo at   public/search.js
 *   2. Add this line to your base layout (e.g. src/layouts/BaseLayout.astro),
 *      in the <head> or before </body>:
 *        <script src="/search.js" defer></script>
 *   3. Commit, push, deploy. That's it.
 */
(function () {
  'use strict';

  var CACHE_KEY = 'oradiscuss_search_idx_v1';
  var CACHE_TTL_MS = 60 * 60 * 1000;       // re-fetch RSS every hour

  // Map RSS first-category (lowercase) to the pretty label shown on the chip.
  var CAT_LABEL = {
    dba:        'Advanced DBA',
    oci:        'OCI / Cloud',
    scripts:    'Scripts',
    goldengate: 'GoldenGate',
    community:  'Community',
    asm:        'ASM',
    tools:      'Tools',
    services:   'Services'
  };

  var input = document.getElementById('SI');
  var drop  = document.getElementById('SD');
  if (!input || !drop) return;             // not on a page that has the search UI

  var index = null;
  var loadingPromise = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function parseRSS(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('RSS parse error');
    return [].map.call(doc.querySelectorAll('item'), function (it) {
      var get = function (tag) {
        var el = it.getElementsByTagName(tag)[0];
        return el ? (el.textContent || '').trim() : '';
      };
      var cats = [].map.call(it.getElementsByTagName('category'), function (c) {
        return (c.textContent || '').trim();
      });
      var title = get('title');
      var link = get('link');
      var description = get('description');
      var primary = (cats[0] || '').toLowerCase();
      var label = CAT_LABEL[primary] || (cats[0] || '');
      var haystack = (title + ' ' + description + ' ' + cats.join(' ')).toLowerCase();
      return { title: title, link: link, description: description, cats: cats, label: label, haystack: haystack };
    });
  }

  function loadIndex() {
    // Try sessionStorage cache
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.ts && (Date.now() - obj.ts) < CACHE_TTL_MS && Array.isArray(obj.data)) {
          return Promise.resolve(obj.data);
        }
      }
    } catch (e) { /* ignore */ }

    return fetch('/rss.xml', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('search index fetch failed: ' + r.status);
        return r.text();
      })
      .then(function (xml) {
        var idx = parseRSS(xml);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: idx }));
        } catch (e) { /* quota or disabled — OK */ }
        return idx;
      });
  }

  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function score(item, terms) {
    var s = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (!t) continue;
      var re = new RegExp(escRegex(t), 'g');
      var titleHits = (item.title.toLowerCase().match(re) || []).length;
      var bodyHits = (item.haystack.match(re) || []).length;
      s += titleHits * 5 + bodyHits;
    }
    return s;
  }

  function render(results, q) {
    if (!results.length) {
      drop.innerHTML =
        '<div class="SRI" style="cursor:default">' +
          '<div class="SRT" style="color:var(--ink-4,#8a837c);font-weight:500">No articles match &ldquo;' +
          escapeHtml(q) + '&rdquo;</div>' +
        '</div>';
      drop.classList.add('show');
      return;
    }
    drop.innerHTML = results.slice(0, 6).map(function (r) {
      return '<a class="SRI" href="' + escapeHtml(r.link) + '" ' +
             'style="display:block;text-decoration:none;color:inherit">' +
        '<div class="SRT">' + escapeHtml(r.title) + '</div>' +
        '<div class="SRC">' + escapeHtml(r.label) + '</div>' +
      '</a>';
    }).join('');
    drop.classList.add('show');
  }

  function hide() { drop.classList.remove('show'); }

  function ensureIndex() {
    if (index) return Promise.resolve(index);
    if (!loadingPromise) {
      loadingPromise = loadIndex().then(function (d) { index = d; return d; });
    }
    return loadingPromise;
  }

  function doSearch() {
    var q = input.value.trim();
    if (!q) { hide(); return; }
    ensureIndex().then(function (idx) {
      var terms = q.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
      if (!terms.length) { hide(); return; }
      var scored = idx.map(function (item) {
        return { item: item, s: score(item, terms) };
      }).filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .map(function (x) { return x.item; });
      render(scored, q);
    }).catch(function () {
      drop.innerHTML =
        '<div class="SRI" style="cursor:default">' +
          '<div class="SRT" style="color:var(--ink-4,#8a837c)">Search unavailable right now</div>' +
        '</div>';
      drop.classList.add('show');
    });
  }

  // Debounced input
  var debounceTimer;
  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 80);
  });

  // Enter → first result, Esc → close
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var first = drop.querySelector('.SRI[href]');
      if (first) {
        e.preventDefault();
        window.location.href = first.getAttribute('href');
      }
    } else if (e.key === 'Escape') {
      hide();
      input.blur();
    }
  });

  // Click outside the search wrapper = close
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.SIW')) hide();
  });

  // Prefetch the index as soon as the user focuses the search box
  input.addEventListener('focus', function () { ensureIndex(); }, { once: true });
})();
