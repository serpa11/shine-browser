// =====================================================================
// Shine Browser — omnibox (Safari-style address + search bar)
// Suggestions are painted by the overlay view because the chrome renderer
// is the bottom layer: anything drawn here would be covered by the page.
// =====================================================================
(function () {
  const input = () => document.getElementById('omnibox');
  const box = () => document.getElementById('omni');

  const ENGINES = {
    google: ['Google', 'https://www.google.com/search?q='],
    bing: ['Bing', 'https://www.bing.com/search?q='],
    duckduckgo: ['DuckDuckGo', 'https://www.duckduckgo.com/?q='],
    brave: ['Brave', 'https://search.brave.com/search?q='],
    ecosia: ['Ecosia', 'https://www.ecosia.org/search?q='],
    startpage: ['Startpage', 'https://www.startpage.com/sp/search?query='],
    youtube: ['YouTube', 'https://www.youtube.com/results?search_query='],
  };

  let sugIndex = -1;
  let sugItems = [];
  let open = false; // are suggestions currently rendered by the overlay?

  function engine() {
    return ENGINES[SB.settings.searchEngine] || ENGINES.google;
  }

  function searchUrl(q) {
    return engine()[1] + encodeURIComponent(q);
  }

  function commit(raw) {
    hideSuggestions();
    const v = String(raw || '').trim();
    if (!v) return;
    let url;
    if (SB.isUrl(v) && !/\s/.test(v)) url = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
    else url = searchUrl(v);
    const tab = SB.activeTab();
    if (tab) SB.loadTab(tab, url);
    input().blur();
  }

  function buildSuggestions(q) {
    const query = q.toLowerCase().trim();
    const out = [];

    if (SB.isUrl(q) && !/\s/.test(q)) {
      out.push({ kind: 'url', label: q, sub: 'Open website', url: /^[a-z]+:/i.test(q) ? q : 'https://' + q });
    }

    SB.bookmarks
      .filter((b) => !query || b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query))
      .slice(0, 4)
      .forEach((b) => out.push({ kind: 'bookmark', label: b.title, sub: b.url, url: b.url }));

    const seen = new Set(out.map((o) => o.url));
    SB.history
      .filter((h) => !seen.has(h.url))
      .filter((h) => !query || (h.title || '').toLowerCase().includes(query) || h.url.toLowerCase().includes(query))
      .slice(0, 5)
      .forEach((h) => out.push({ kind: 'history', label: h.title || h.url, sub: h.url, url: h.url }));

    if (query) {
      out.push({ kind: 'search', label: q, sub: `Search ${engine()[0]} for “${q}”`, url: searchUrl(q) });
    }
    if (query) {
      out.push({ kind: 'shine', label: `Ask Shine about “${q}”`, sub: 'Shine', shine: q });
    }
    return out;
  }

  function renderSuggestions(items) {
    sugItems = items;
    sugIndex = -1;
    const el = input();
    if (!items.length) { hideSuggestions(); return; }
    const rect = el.getBoundingClientRect();
    const chromeH = SB.chromeH || 122;

    SB.ipc.overlay.show('omni-suggestions',
      { mode: 'cx', cx: rect.left + rect.width / 2, y: rect.bottom + chromeH + 6 },
      { items });
    open = true;
    SB.syncChromeHeight();
  }

  function hideSuggestions() {
    if (!open) return;
    open = false;
    SB.ipc.overlay.hide('omni-suggestions');
    sugIndex = -1;
    SB.syncChromeHeight();
  }

  function highlight() {
    SB.ipc.overlay.action({ widget: 'omni-suggestions', action: 'highlight', data: { index: sugIndex } });
  }

  function pick(i) {
    const it = sugItems[i];
    if (!it) return;
    if (it.shine) {
      hideSuggestions();
      input().blur();
      SB.ipc.shine.ask(it.shine, 'explain');
      SB.toast('Asking Shine…');
      return;
    }
    commit(it.url);
  }

  function init() {
    const el = input();

    el.addEventListener('focus', () => {
      el.select();
      renderSuggestions(buildSuggestions(el.value));
    });

    el.addEventListener('input', () => {
      renderSuggestions(buildSuggestions(el.value));
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (sugItems.length) { sugIndex = (sugIndex + 1) % sugItems.length; highlight(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (sugItems.length) { sugIndex = (sugIndex - 1 + sugItems.length) % sugItems.length; highlight(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (sugIndex >= 0) pick(sugIndex);
        else commit(el.value);
      } else if (e.key === 'Escape') {
        hideSuggestions();
        el.blur();
        SB.omnibox.syncFromTab(SB.activeTab());
      }
    });

    el.addEventListener('blur', () => setTimeout(hideSuggestions, 120));

    document.getElementById('btnBookmark').addEventListener('click', toggleBookmark);
  }

  async function toggleBookmark() {
    const tab = SB.activeTab();
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
      SB.toast('Nothing to favorite on this page');
      return;
    }
    const existing = SB.bookmarks.find((b) => b.url === tab.url);
    if (existing) {
      await SB.ipc.bookmarks.remove(existing.id);
      SB.toast('Removed from favorites');
    } else {
      await SB.ipc.bookmarks.add({ title: tab.title || tab.url, url: tab.url });
      SB.toast('Added to favorites ★');
    }
    await SB.refreshBookmarks();
  }

  // ---- called by the overlay when the user picks a suggestion -----------
  SB.onOverlaySuggestion = function (action, data) {
    if (action === 'pick' && data && typeof data.index === 'number') {
      pick(data.index);
    }
  };

  SB.omnibox = {
    init,
    focus: () => { input().focus(); input().select(); },
    commit,
    syncFromTab(tab) {
      const el = input();
      if (document.activeElement === el) return;
      if (!tab) { el.value = ''; return; }
      if (tab.url === 'shine://newtab') { el.value = ''; }
      else el.value = tab.url;
      const o = box();
      o.classList.remove('secure', 'insecure');
      if (/^https:/i.test(tab.url)) o.classList.add('secure');
      else if (/^http:/i.test(tab.url)) o.classList.add('insecure');
    },
  };
})();
