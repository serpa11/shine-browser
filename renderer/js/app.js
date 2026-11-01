// =====================================================================
// Shine Browser — app bootstrap
// Window controls, keyboard shortcuts, event routing, startup.
// =====================================================================
(function () {
  function initWindowControls() {
    document.getElementById('wcMin').addEventListener('click', () => SB.ipc.win.minimize());
    document.getElementById('wcClose').addEventListener('click', () => window.close());
    const maxBtn = document.getElementById('wcMax');
    maxBtn.addEventListener('click', () => SB.ipc.win.maximize());
    SB.ipc.win.isMaximized().then((m) => {
      maxBtn.title = m ? 'Restore' : 'Maximize';
    });
  }

  function initToolbar() {
    document.getElementById('btnBack').addEventListener('click', () => SB.goActive('back'));
    document.getElementById('btnForward').addEventListener('click', () => SB.goActive('forward'));
    document.getElementById('btnReload').addEventListener('click', () => SB.reloadActive());
    document.getElementById('newTabBtn').addEventListener('click', () => SB.createTab());

    document.getElementById('btnSidebar').addEventListener('click', () => {
      SB.panels.toggle('panelFavorites');
    });
    document.getElementById('btnFind').addEventListener('click', () => SB.menu.openFind());
    document.getElementById('btnExtensions').addEventListener('click', () => SB.panels.toggle('panelExtensions'));
    document.getElementById('btnDownloads').addEventListener('click', () => SB.panels.toggle('panelDownloads'));
    document.getElementById('btnHistory').addEventListener('click', () => SB.panels.toggle('panelHistory'));
    document.getElementById('btnFavorites').addEventListener('click', () => SB.panels.toggle('panelFavorites'));
    document.getElementById('btnProfile').addEventListener('click', () => SB.menu.openSettings());
    document.getElementById('btnTabSearch').addEventListener('click', () => {
      const q = prompt('Search tabs');
      if (!q) return;
      const t = SB.tabs.find((x) => (x.title || '').toLowerCase().includes(q.toLowerCase()) ||
        (x.url || '').toLowerCase().includes(q.toLowerCase()));
      if (t) SB.activateTab(t.id);
      else SB.toast('No matching tab');
    });
  }

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const inInput = /input|textarea/i.test(document.activeElement.tagName);

      if (ctrl && e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'n': e.preventDefault(); SB.createTab({ incognito: true }); return;
          case 't': e.preventDefault(); SB.createTab(); return;
          case 's': e.preventDefault(); SB.shine.toggle(); return;
          case 'p': e.preventDefault(); SB.goActive('print'); return;
          case 'd': e.preventDefault(); document.getElementById('btnBookmark').click(); return;
          case 'f': e.preventDefault(); SB.menu.openFind(); return;
          case 'b': e.preventDefault(); SB.panels.toggle('panelFavorites'); return;
          case 'j': e.preventDefault(); SB.panels.toggle('panelDownloads'); return;
          case 'h': e.preventDefault(); SB.panels.toggle('panelHistory'); return;
          case 'l': e.preventDefault(); SB.omnibox.focus(); return;
          case 'o': e.preventDefault(); SB.goActive('devtools'); return;
          case 'r': e.preventDefault(); SB.ipc.tab.op(SB.activeTabId, 'reload-hard'); return;
          case 'tab': {
            e.preventDefault();
            const order = SB.tabs.slice().sort((a, b) => a.id - b.id);
            if (!order.length) return;
            const i = order.findIndex((t) => t.id === SB.activeTabId);
            const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length];
            if (next) SB.activateTab(next.id);
            return;
          }
          default: break;
        }
      }

      if (ctrl && !e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 't': e.preventDefault(); SB.createTab(); return;
          case 'w': e.preventDefault(); SB.closeTab(SB.activeTabId); return;
          case 'n': e.preventDefault(); SB.createTab(); return;
          case 'l': e.preventDefault(); SB.omnibox.focus(); return;
          case 'f': e.preventDefault(); SB.menu.openFind(); return;
          case 'r': e.preventDefault(); SB.reloadActive(); return;
          case 'h': e.preventDefault(); SB.panels.toggle('panelHistory'); return;
          case 'j': e.preventDefault(); SB.panels.toggle('panelDownloads'); return;
          case 'b': e.preventDefault(); SB.panels.toggle('panelFavorites'); return;
          case 'd': e.preventDefault(); document.getElementById('btnBookmark').click(); return;
          case 'p': e.preventDefault(); SB.goActive('print'); return;
          case 'q': e.preventDefault(); window.close(); return;
          case 's': e.preventDefault(); SB.goActive('save-page'); return;
          case '0': e.preventDefault(); SB.goActive('zoom-reset'); return;
          case '=': case '+': e.preventDefault(); SB.goActive('zoom-in'); return;
          case '-': e.preventDefault(); SB.goActive('zoom-out'); return;
          case 'g': e.preventDefault(); SB.goActive('back'); return;
          case 'y': e.preventDefault(); SB.goActive('forward'); return;
          default: break;
        }
        if (/^[1-9]$/.test(e.key)) {
          e.preventDefault();
          const idx = Number(e.key) - 1;
          if (SB.tabs[idx]) SB.activateTab(SB.tabs[idx].id);
          return;
        }
      }

      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); SB.goActive('back'); return; }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); SB.goActive('forward'); return; }
      if (e.altKey && e.key === 'd') { e.preventDefault(); SB.omnibox.focus(); return; }
      if (e.key === 'F12') { e.preventDefault(); SB.goActive('devtools'); return; }
      if (e.key === 'F5') { e.preventDefault(); SB.reloadActive(); return; }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); SB.goActive('devtools'); return; }
      if (e.key === 'Escape') {
        SB.selectionBar.hide();
        SB.menu.close();
        SB.panels.close();
        SB.menu.closeFind();
      }
      if (ctrl && inInput && e.key.toLowerCase() === 'a') {
        // let inputs behave normally
      }
    });
  }

  function initEventStream() {
    SB.ipc.events((channel, data) => {
      switch (channel) {
        case 'shine:toast':
          SB.toast(data.text, 4200);
          break;
        case 'shine:open-url': {
          const tab = SB.activeTab();
          if (tab) SB.loadTab(tab, data.url);
          break;
        }
        case 'shine:search': {
          const tab = SB.activeTab();
          if (tab) SB.loadTab(tab, 'https://www.google.com/search?q=' + encodeURIComponent(data.query || ''));
          break;
        }
        case 'shine:new-tab':
          SB.createTab({ url: data.url || '' });
          break;
        case 'shine:close-tab': {
          const t = SB.activeTab();
          if (t) SB.closeTab(t.id);
          break;
        }
        case 'shine:reload': SB.reloadActive(); break;
        case 'shine:history-back': SB.goActive('back'); break;
        case 'shine:history-forward': SB.goActive('forward'); break;
        case 'shine:bookmark-current': {
          const tab = SB.activeTab();
          if (tab && tab.url) {
            SB.ipc.bookmarks.add({ title: tab.title || tab.url, url: tab.url }).then(() => SB.refreshBookmarks());
          }
          break;
        }
        case 'shine:state':
          SB.panelOpen = !!data.open;
          break;
        case 'tab:open-external-tab':
          SB.createTab({ url: data.url, incognito: !!data.incognito });
          break;
        case 'tab:context-menu': {
          const tab = SB.tabs.find((t) => t.id === data.tabId) || SB.activeTab();
          if (tab) SB.showContextMenu(data, tab);
          break;
        }
        case 'tab:crashed': {
          SB.toast('This tab crashed — reloading.');
          SB.ipc.tab.op(data.tabId, 'reload');
          break;
        }
        case 'downloads:changed':
          SB.refreshDownloads(data);
          break;
        default:
          break;
      }
    });
  }

  // ---- startup -----------------------------------------------------------
  async function boot() {
    initWindowControls();
    initToolbar();
    initKeyboard();
    initEventStream();

    SB.omnibox.init();
    SB.shine.init();

    SB.settings = await SB.ipc.settings.get();
    await Promise.all([
      SB.refreshBookmarks(),
      SB.refreshHistory(),
      SB.refreshDownloads(),
      SB.refreshExtensions(),
    ]);

    if (SB.settings.theme === 'light') document.body.classList.add('light');

    // first tab
    SB.createTab();

    // setup window on first run
    if (SB.settings.firstRun) {
      setTimeout(() => SB.setup.show(), 350);
    }

    // open Shine panel if the user asked for it at startup
    if (SB.settings.panelOpen) {
      setTimeout(() => SB.shine.show(), 500);
    }

    // resize handling
    let raf = null;
    window.addEventListener('resize', () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => SB.ipc.tab.layout());
    });

    // prevent the browser's own context menu on chrome UI
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('webview')) e.preventDefault();
    });

    // block drag-drop of files onto chrome (opens them in a tab instead)
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.path) {
        const tab = SB.activeTab();
        if (tab) SB.loadTab(tab, 'file:///' + file.path.replace(/\\/g, '/'));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
