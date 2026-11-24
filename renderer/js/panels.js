// =====================================================================
// Shine Browser — side panels: Favorites, History, Downloads
//
// Panels push the page aside: the renderer reports its width to the main
// process, which shrinks the active tab view so nothing is ever painted
// over. Without this the page covers the panel entirely.
// =====================================================================
(function () {
  const PANELS = ['panelHistory', 'panelFavorites', 'panelDownloads', 'panelPC', 'panelBrowser'];

  function syncWidth() {
    // the panel that is currently visible; report its width so main can
    // shrink the tab view to keep it fully visible.
    const open = PANELS.find((id) => {
      const el = document.getElementById(id);
      return !!el && !el.classList.contains('hidden');
    });
    const w = open ? Math.round(document.getElementById(open).offsetWidth) : 0;
    SB.ipc.win.setSidePanel(w);
  }

  function openPanel(id) {
    PANELS.forEach((p) => {
      const el = document.getElementById(p);
      if (!el) return;
      if (p === id) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    if (id === 'panelHistory') SB.refreshHistory();
    if (id === 'panelFavorites') SB.refreshBookmarks();
    if (id === 'panelDownloads') SB.refreshDownloads();
    if (id === 'panelPC') {
      // PC Control: show a toast saying it's on, then close the panel
      // The actual control happens through Open Shine (split screen)
      SB.toast('PC Control is ON — talk to Shine in Open Shine to control your PC');
      setTimeout(() => {
        SB.toast('PC Control active — describe what you want to Shine');
        setTimeout(() => closePanels(), 2000);
      }, 2000);
    }
    if (id === 'panelBrowser') {
      // Browser Control: show a toast saying it's on, then close the panel
      // The actual control happens through Open Shine (split screen)
      SB.toast('Browser Control is ON — talk to Shine in Open Shine to control your browser');
      setTimeout(() => {
        SB.toast('Browser Control active — describe what you want to Shine');
        setTimeout(() => closePanels(), 2000);
      }, 2000);
    }
    // Report panel width BEFORE layout so tab views shrink to make room
    syncWidth();
    SB.ipc.tab.layout();
  }

  function closePanels() {
    PANELS.forEach((p) => {
      const el = document.getElementById(p);
      if (el) el.classList.add('hidden');
    });
    SB.ipc.tab.layout();
    syncWidth();
  }

  function togglePanel(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains('hidden')) openPanel(id);
    else closePanels();
  }

  // ---- Favorites ---------------------------------------------------------
  function renderFavorites() {
    const host = document.getElementById('favoritesList');
    if (!SB.bookmarks.length) {
      host.innerHTML = '<div class="empty-state">No favorites yet.<br>Press <strong>Ctrl+D</strong> while browsing to save a page here.</div>';
      return;
    }
    host.innerHTML = SB.bookmarks.map((b) => `
      <div class="list-item" data-url="${SB.escapeHtml(b.url)}">
        <img class="favicon" src="${SB.faviconFor(b.url)}" referrerpolicy="no-referrer" />
        <div class="li-main">
          <div class="li-title">${SB.escapeHtml(b.title)}</div>
          <div class="li-sub">${SB.escapeHtml(b.url)}</div>
        </div>
        <button class="icon-btn sm li-action" data-remove="${b.id}" title="Remove">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>`).join('');

    host.querySelectorAll('.list-item').forEach((node) => {
      node.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove]')) return;
        const tab = SB.activeTab();
        if (tab) SB.loadTab(tab, node.dataset.url);
      });
    });
    host.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await SB.ipc.bookmarks.remove(Number(btn.dataset.remove));
        await SB.refreshBookmarks();
      });
    });
  }

  // ---- History -----------------------------------------------------------
  function renderHistory(filter) {
    const host = document.getElementById('historyList');
    const q = (filter || document.getElementById('historySearch').value || '').toLowerCase().trim();
    const items = SB.history.filter((h) => !q || (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q));
    if (!items.length) {
      host.innerHTML = '<div class="empty-state">No history yet.<br>Browse the web and your history will appear here.</div>';
      return;
    }
    host.innerHTML = items.slice(0, 500).map((h) => `
      <div class="list-item" data-url="${SB.escapeHtml(h.url)}">
        <img class="favicon" src="${SB.faviconFor(h.url)}" referrerpolicy="no-referrer" />
        <div class="li-main">
          <div class="li-title">${SB.escapeHtml(h.title || h.url)}</div>
          <div class="li-sub">${SB.timeAgo(h.time)} · ${SB.escapeHtml(h.url)}</div>
        </div>
        <button class="icon-btn sm li-action" data-time="${h.time}" title="Delete">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>`).join('');

    host.querySelectorAll('.list-item').forEach((node) => {
      node.addEventListener('click', (e) => {
        if (e.target.closest('[data-time]')) return;
        const tab = SB.activeTab();
        if (tab) SB.loadTab(tab, node.dataset.url);
      });
    });
    host.querySelectorAll('[data-time]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await SB.ipc.history.remove(Number(btn.dataset.time));
        await SB.refreshHistory();
      });
    });
  }

  // ---- Downloads ---------------------------------------------------------
  function renderDownloads() {
    const host = document.getElementById('downloadsList');
    if (!SB.downloads.length) {
      host.innerHTML = '<div class="empty-state">No downloads.<br>Files you download will show up here.</div>';
      return;
    }
    host.innerHTML = SB.downloads.map((d) => {
      const pct = d.total ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0;
      const state = d.state === 'completed' ? 'Done' : d.state === 'interrupted' ? 'Failed' : pct + '%';
      return `
      <div class="list-item" data-path="${SB.escapeHtml(d.path)}">
        <span class="favicon" style="display:grid;place-items:center">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M8 11.5 12 15.5l4-4"/><path d="M5 19h14"/></svg>
        </span>
        <div class="li-main">
          <div class="li-title">${SB.escapeHtml(d.filename)}</div>
          <div class="li-sub">${SB.formatBytes(d.received)}${d.total ? ' / ' + SB.formatBytes(d.total) : ''} · ${state}</div>
          ${d.state === 'progressing' ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
        </div>
        <button class="icon-btn sm li-action" data-reveal="${SB.escapeHtml(d.path)}" title="Show in folder">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
        </button>
      </div>`;
    }).join('');

    host.querySelectorAll('[data-reveal]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        SB.ipc.downloads.reveal(btn.dataset.reveal);
      });
    });
    host.querySelectorAll('.list-item').forEach((node) => {
      node.addEventListener('dblclick', () => {
        if (node.dataset.path) SB.ipc.app.openExternal('file:///' + node.dataset.path);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.panel-close').forEach((b) => {
      b.addEventListener('click', closePanels);
    });
    document.getElementById('historySearch').addEventListener('input', () => renderHistory());
    document.getElementById('clearHistory').addEventListener('click', async () => {
      await SB.ipc.history.clear();
      await SB.refreshHistory();
      SB.toast('History cleared');
    });
    document.getElementById('openDownloadsFolder').addEventListener('click', () => SB.ipc.app.openDownloads());
    document.getElementById('importBookmarks').addEventListener('click', () => {
      SB.toast("Bookmarks import: use Chrome's export then drop the file in your Shine Browser profile folder.");
    });
  });

  SB.panels = { open: openPanel, close: closePanels, toggle: togglePanel, renderFavorites, renderHistory, renderDownloads };
})();
