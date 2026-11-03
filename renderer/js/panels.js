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
    'panelExtensions', 'panelPC', 'panelBrowser'];

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

  // ---- Extensions --------------------------------------------------------
  function renderExtensions() {
    const host = document.getElementById('extensionsList');
    if (!SB.extensions.length) {
      host.innerHTML = `<div class="empty-state">
        No extensions installed yet.<br><br>
        <strong>Load unpacked</strong> installs a folder from your PC.<br>
        Browse the <strong>Chrome Web Store</strong> — Shine Browser installs it automatically.
      </div>`;
      return;
    }
    host.innerHTML = SB.extensions.map((x) => `
      <div class="list-item" data-id="${SB.escapeHtml(x.id)}">
        <span class="favicon" style="display:grid;place-items:center">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="M10 3.5a2.5 2.5 0 0 1 5 0V6h3a1 1 0 0 1 1 1v3h2.5a2.5 2.5 0 0 1 0 5H19v3a1 1 0 0 1-1 1h-3v-2.5a2.5 2.5 0 0 0-5 0V19H7a1 1 0 0 1-1-1v-3H3.5a2.5 2.5 0 0 1 0-5H6V7a1 1 0 0 1 1-1h3V3.5Z"/></svg>
        </span>
        <div class="li-main">
          <div class="li-title">${SB.escapeHtml(x.name)}</div>
          <div class="li-sub">v${SB.escapeHtml(x.version || '?')} · ${x.loaded ? 'active' : 'disabled'}</div>
        </div>
        <input type="checkbox" ${x.loaded ? 'checked' : ''} data-toggle="${SB.escapeHtml(x.id)}" title="Enable" />
        <button class="icon-btn sm li-action" data-removeext="${SB.escapeHtml(x.id)}" title="Remove">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>`).join('');

    host.querySelectorAll('[data-removeext]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await SB.ipc.extensions.remove(btn.dataset.removeext);
        await SB.refreshExtensions();
        SB.toast('Extension removed');
      });
    });
    host.querySelectorAll('[data-toggle]').forEach((cb) => {
      cb.addEventListener('click', async (e) => {
        e.stopPropagation();
        await SB.ipc.extensions.toggle(cb.dataset.toggle);
        await SB.refreshExtensions();
      });
    });
  }

  // ---- PC Control --------------------------------------------------------
  const pc = {
    tab: 'apps',
    apps: [],
    async load(which) {
      pc.tab = which || pc.tab;
      document.querySelectorAll('#pcTabs button').forEach((b) => {
        b.classList.toggle('active', b.dataset.pc === pc.tab);
      });
      const host = document.getElementById('pcBody');
      host.innerHTML = '<div class="empty-state">Loading…</div>';

      if (pc.tab === 'apps') {
        pc.apps = await SB.ipc.pc.apps();
        pc.renderApps();
      } else if (pc.tab === 'system') {
        const info = await SB.ipc.pc.info();
        host.innerHTML = `
          <div style="padding:6px 10px">
            <div class="settings-group" style="margin-bottom:10px">
              <h3>Operating system</h3>
              <div class="about"><strong>${SB.escapeHtml(info.os)}</strong><br>
              ${info.arch} · hostname <strong>${SB.escapeHtml(info.hostname)}</strong> · user <strong>${SB.escapeHtml(info.user)}</strong><br>
              Uptime ${SB.escapeHtml(info.uptimeHuman)}</div>
            </div>
            <div class="settings-group" style="margin-bottom:10px">
              <h3>Processor & memory</h3>
              <div class="about"><strong>${SB.escapeHtml(info.cpu.model)}</strong><br>
              ${info.cpu.cores} cores @ ${info.cpu.speedMHz} MHz<br>
              RAM ${info.memory.usedGB} GB of ${info.memory.totalGB} GB used (${info.memory.usagePct}%)</div>
              <div class="progress" style="margin-top:10px"><div style="width:${info.memory.usagePct}%"></div></div>
            </div>
            <div class="settings-group" style="margin-bottom:10px">
              <h3>Storage</h3>
              ${info.disks.map((d) => `
                <div class="about" style="margin-bottom:8px">
                  <strong>${SB.escapeHtml(d.letter)}</strong> — ${d.freeGB} GB free of ${d.sizeGB} GB
                  <div class="progress" style="margin-top:5px"><div style="width:${d.sizeGB ? Math.round(((d.sizeGB - d.freeGB) / d.sizeGB) * 100) : 0}%"></div></div>
                </div>`).join('')}
            </div>
            <div class="settings-group">
              <h3>Browser</h3>
              <div class="about">Shine Browser <strong>${SB.escapeHtml(info.electron)}</strong><br>
              Chromium <strong>${SB.escapeHtml(info.chrome)}</strong> · Node ${SB.escapeHtml(info.node)}<br>
              Engine updated for 2026 — every modern site works.</div>
            </div>
          </div>`;
      } else if (pc.tab === 'processes') {
        const procs = await SB.ipc.pc.processes();
        host.innerHTML = procs.map((p) => `
          <div class="list-item">
            <span class="favicon" style="display:grid;place-items:center">
              <svg class="svg-icon" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="12" rx="2"/><path d="M9 21h6"/></svg>
            </span>
            <div class="li-main">
              <div class="li-title">${SB.escapeHtml(p.name)}</div>
              <div class="li-sub">PID ${p.pid}</div>
            </div>
            <div class="li-sub">${p.memMB} MB</div>
          </div>`).join('');
      }
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
    document.getElementById('extLoad').addEventListener('click', async () => {
      const r = await SB.ipc.extensions.load();
      if (r.ok) { SB.toast('Installed ' + (r.name || 'extension')); await SB.refreshExtensions(); }
      else if (!r.canceled) SB.toast(r.error || 'Could not load extension');
    });
    document.getElementById('extStore').addEventListener('click', () => {
      const tab = SB.activeTab();
      if (tab) SB.loadTab(tab, 'https://chromewebstore.google.com/');
    });
    document.getElementById('importBookmarks').addEventListener('click', () => {
      SB.toast("Bookmarks import: use Chrome's export then drop the file in your Shine Browser profile folder.");
    });
    document.querySelectorAll('#pcTabs button').forEach((b) => {
      b.addEventListener('click', () => pc.load(b.dataset.pc));
    });
    document.getElementById('pcSearch').addEventListener('input', () => pc.renderApps());
    document.getElementById('pcScreenshot').addEventListener('click', async () => {
      const r = await SB.ipc.pc.screenshot();
      if (r.ok) SB.toast('Screenshot saved: ' + r.path);
      else SB.toast(r.error || 'Screenshot failed');
    });

    document.getElementById('pcAskBtn').addEventListener('click', () => {
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
    const btnNewTab = document.getElementById('bcNewTab') || document.querySelector('[data-bc="new-tab"]');
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
      const q = bcAsk.value.trim();
      if (!q) return;
      closePanels();
      SB.shine.open();
      SB.ipc.shine.ask(q, 'explain');
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

  SB.panels = { open: openPanel, close: closePanels, toggle: togglePanel, renderFavorites, renderHistory, renderDownloads, renderExtensions, pc, browser };
})();
