// =====================================================================
// Shine Browser — omnibox (Safari-style address + search bar)
// =====================================================================
(function () {
  const input = () => document.getElementById('omnibox');
  const box = () => document.getElementById('omni');
  const sug = () => document.getElementById('omniSuggestions');

  const ENGINES = {
    google: ['Google', 'https://www.google.com/search?q='],
    bing: ['Bing', 'https://www.bing.com/search?q='],
    duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q='],
    brave: ['Brave', 'https://search.brave.com/search?q='],
    ecosia: ['Ecosia', 'https://www.ecosia.org/search?q='],
    startpage: ['Startpage', 'https://www.startpage.com/sp/search?query='],
    youtube: ['YouTube', 'https://www.youtube.com/results?search_query='],
  };

  let sugIndex = -1;
  let sugItems = [];

  function engine() {
    return ENGINES[SB.settings.searchEngine] || ENGINES.google;
  }

  function searchUrl(q) {
    return engine()[1] + encodeURIComponent(q);
  }

  function commit(raw) {
    const v = String(raw || '').trim();
    hideSuggestions();
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

    // 1. current URL
    if (SB.isUrl(q) && !/\s/.test(q)) {
      out.push({ kind: 'url', label: q, sub: 'Open website', url: /^[a-z]+:/i.test(q) ? q : 'https://' + q });
    }

    // 2. bookmarks
    SB.bookmarks
      .filter((b) => !query || b.title.toLowerCase().includes(query) || b.url.toLowerCase().includes(query))
      .slice(0, 4)
      .forEach((b) => out.push({ kind: 'bookmark', label: b.title, sub: b.url, url: b.url }));

    // 3. history
    const seen = new Set(out.map((o) => o.url));
    SB.history
      .filter((h) => !seen.has(h.url))
      .filter((h) => !query || (h.title || '').toLowerCase().includes(query) || h.url.toLowerCase().includes(query))
      .slice(0, 5)
      .forEach((h) => out.push({ kind: 'history', label: h.title || h.url, sub: h.url, url: h.url }));

    // 4. search suggestion
    if (query) {
      out.push({ kind: 'search', label: q, sub: `Search ${engine()[0]} for “${q}”`, url: searchUrl(q) });
    }
    // 5. ask shine
    if (query) {
      out.push({ kind: 'shine', label: `Ask Shine about “${q}”`, sub: 'Shine AI', shine: q });
    }
    return out;
  }

  function renderSuggestions(items) {
    sugItems = items;
    sugIndex = -1;
    const el = sug();
    if (!items.length) { hideSuggestions(); return; }
    el.innerHTML = items.map((it, i) => {
      let icon = '';
      if (it.kind === 'search') {
        icon = '<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/></svg>';
      } else if (it.kind === 'shine') {
        icon = '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 3c.6 4.2 4.8 8.4 9 9-4.2.6-8.4 4.8-9 9-.6-4.2-4.8-8.4-9-9 4.2-.6 8.4-4.8 9-9Z"/></svg>';
      } else if (it.kind === 'bookmark') {
        icon = '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/></svg>';
      } else {
        icon = '<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.4 2.5 13.2 0 16M12 4c-2.5 2.4-2.5 13.2 0 16"/></svg>';
      }
      return `<div class="list-item omni-sug${it.kind === 'shine' ? ' shine-sug' : ''}" data-i="${i}">
        <span class="favicon" style="display:grid;place-items:center">${icon}</span>
        <div class="li-main">
          <div class="li-title">${SB.escapeHtml(it.label)}</div>
          <div class="li-sub">${SB.escapeHtml(it.sub || '')}</div>
        </div>
      </div>`;
    }).join('');
    el.classList.remove('hidden');
    Array.from(el.children).forEach((node) => {
      node.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(Number(node.dataset.i));
      });
    });
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

  function hideSuggestions() {
    sug().classList.add('hidden');
    sugIndex = -1;
  }

  function highlight() {
    Array.from(sug().children).forEach((c, i) => c.classList.toggle('active', i === sugIndex));
    if (sugIndex >= 0 && sug().children[sugIndex]) {
      sug().children[sugIndex].scrollIntoView({ block: 'nearest' });
    }
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
