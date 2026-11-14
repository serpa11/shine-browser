// =====================================================================
// Shine Browser — side panels: Favorites, History, Downloads,
// Extensions, PC Control and Browser Control.
//
// Panels push the page aside: the renderer reports its width to the main
// process, which shrinks the active tab view so nothing is ever painted
// over. Without this the page covers the panel entirely.
// =====================================================================
(function () {
  const PANELS = ['panelHistory', 'panelFavorites', 'panelDownloads',
    'panelPC', 'panelBrowser'];

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
    if (id === 'panelExtensions') SB.refreshExtensions();
    if (id === 'panelPC') pc.load('apps');
    SB.ipc.tab.layout();
    syncWidth();
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
        if (node.dataset.path) SB.ipc.pc.openPath(node.dataset.path);
      });
    });
  }

  // ---- PC Control --------------------------------------------------------
  const pc = {
    apps: [],
    async load() {
      const host = document.getElementById('pcBody');
      host.innerHTML = '<div class="empty-state">Ask Shine above to control your PC, or use the quick actions below.</div>';
      pc.apps = await SB.ipc.pc.apps();
      pc.renderApps();
    },
    renderApps() {
      const host = document.getElementById('pcBody');
      const q = (document.getElementById('pcSearch').value || '').toLowerCase().trim();
      const list = pc.apps.filter((a) => !q || a.name.toLowerCase().includes(q));
      if (!list.length) {
        host.innerHTML = '<div class="empty-state">No apps match that search.</div>';
        return;
      }
      host.innerHTML = list.slice(0, 400).map((a) => `
        <div class="list-item" data-app="${SB.escapeHtml(a.name)}">
          <span class="favicon" style="display:grid;place-items:center">
            <svg class="svg-icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/></svg>
          </span>
          <div class="li-main"><div class="li-title">${SB.escapeHtml(a.name)}</div></div>
          <span class="li-sub">Launch</span>
        </div>`).join('');
      host.querySelectorAll('[data-app]').forEach((node) => {
        node.addEventListener('click', async () => {
          SB.toast('Opening ' + node.dataset.app + '…');
          const r = await SB.ipc.pc.launch(node.dataset.app);
          if (!r.ok) SB.toast(r.error || 'Could not open that app');
        });
      });
    },
  };

  // ---- Browser Control ---------------------------------------------------
  const browser = {
    async load() {
      const host = document.getElementById('bcTabs');
      const tabs = SB.tabs.map((t) => ({
        id: t.id,
        title: t.title || 'New Tab',
        url: t.url,
        active: t.id === SB.activeTabId,
        loading: !!t.loading,
        incognito: !!t.incognito,
      }));
      host.innerHTML = tabs.map((t) => `
        <div class="list-item" data-tabid="${t.id}" style="cursor:pointer">
          <span class="favicon" style="display:grid;place-items:center">${t.loading ? '' : ''}</span>
          <div class="li-main">
            <div class="li-title">${SB.escapeHtml(t.title)}</div>
            <div class="li-sub">${SB.escapeHtml(t.url)}</div>
          </div>
          <button class="icon-btn sm li-action" data-close="${t.id}" title="Close tab" style="margin-left:auto">
            <svg class="svg-icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>`).join('');
      host.querySelectorAll('[data-tabid]').forEach((node) => {
        node.addEventListener('click', (e) => {
          if (e.target.closest('[data-close]')) return;
          const id = Number(node.dataset.tabid);
          closePanels();
          SB.activateTab(id);
        });
      });
      host.querySelectorAll('[data-close]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          SB.closeTab(Number(btn.dataset.close));
          browser.load();
        });
      });
    },
  };

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
    document.getElementById('pcSearch').addEventListener('input', () => pc.renderApps());
    document.getElementById('pcScreenshot').addEventListener('click', async () => {
      // Vision: capture screenshot and send to Shine AI
      const r = await SB.ipc.pc.screenshot();
      if (!r.ok) { SB.toast(r.error || 'Screenshot failed'); return; }
      closePanels();
      SB.shine.open();
      SB.ipc.shine.ask('PC Control vision: analyze this screenshot and tell me what you see. What apps are open, what is the user doing, and what should I do next?', 'pc-control');
      SB.toast('Screenshot captured — asking Shine to analyze…');
    });
    document.getElementById('pcSysInfo').addEventListener('click', async () => {
      const info = await SB.ipc.pc.info();
      if (!info) { SB.toast('Could not read system info'); return; }
      closePanels();
      SB.shine.open();
      SB.ipc.shine.ask('PC Control: Here is my system info — ' + JSON.stringify(info) + '. Tell me about my computer and what I can do with it.', 'pc-control');
      SB.toast('Sending system info to Shine…');
    });

    document.getElementById('pcAskBtn').addEventListener('click', () => {
      if (SB.aiEnabled === false) { SB.toast('Shine AI is disabled in Settings.'); return; }
      const q = document.getElementById('pcAsk').value.trim();
      if (!q) return;
      closePanels();
      SB.shine.open();
      SB.ipc.shine.ask('PC Control: ' + q, 'pc-control');
      SB.toast('Asking Shine to control your PC…');
    });
    document.getElementById('pcAsk').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('pcAskBtn').click();
    });

    // Browser Control
    const btnNewTab = document.querySelector('[data-bc="new-tab"]');
    const btnReload = document.querySelector('[data-bc="reload"]');
    const btnBack = document.querySelector('[data-bc="back"]');
    const btnForward = document.querySelector('[data-bc="forward"]');
    const btnPrivate = document.querySelector('[data-bc="private"]');
    const btnBookmark = document.querySelector('[data-bc="bookmark"]');

    if (btnNewTab) btnNewTab.addEventListener('click', () => { closePanels(); SB.createTab(); });
    if (btnReload) btnReload.addEventListener('click', () => { closePanels(); SB.goActive('reload'); });
    if (btnBack) btnBack.addEventListener('click', () => { closePanels(); SB.goActive('back'); });
    if (btnForward) btnForward.addEventListener('click', () => { closePanels(); SB.goActive('forward'); });
    if (btnPrivate) btnPrivate.addEventListener('click', () => { closePanels(); SB.createTab({ incognito: true }); });
    if (btnBookmark) btnBookmark.addEventListener('click', () => { closePanels(); SB.panels.toggle('panelFavorites'); });

    const bcAsk = document.getElementById('bcAsk');
    const bcAskBtn = document.getElementById('bcAskBtn');
    if (bcAskBtn) bcAskBtn.addEventListener('click', () => {
      if (SB.aiEnabled === false) { SB.toast('Shine AI is disabled in Settings.'); return; }
      const q = bcAsk.value.trim();
      if (!q) return;
      closePanels();
      SB.shine.open();
      SB.ipc.shine.ask('Browser Control: ' + q, 'browser-control');
      SB.toast('Asking Shine to drive the browser…');
    });
    if (bcAsk) bcAsk.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') bcAskBtn && bcAskBtn.click();
    });

    // refresh the tab list whenever tabs change
    const _createTab = SB.createTab;
    SB.createTab = function (opts) {
      const t = _createTab.call(SB, opts);
      const el = document.getElementById('bcTabs');
      if (el && !el.classList.contains('hidden')) browser.load();
      return t;
    };
    const _closeTab = SB.closeTab;
    SB.closeTab = function (id) {
      const el = document.getElementById('bcTabs');
      _closeTab.call(SB, id);
      const el2 = document.getElementById('bcTabs');
      if (el2 && !el2.classList.contains('hidden')) browser.load();
    };
  });

  SB.panels = { open: openPanel, close: closePanels, toggle: togglePanel, renderFavorites, renderHistory, renderDownloads, pc, browser };
})();
