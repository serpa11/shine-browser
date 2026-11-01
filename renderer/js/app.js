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
    SB.ipc.win.isMaximized().then((m) => { maxBtn.title = m ? 'Restore' : 'Maximize'; }).catch(() => {});
  }

  function initToolbar() {
    document.getElementById('btnBack').addEventListener('click', () => SB.goActive('back'));
    document.getElementById('btnForward').addEventListener('click', () => SB.goActive('forward'));
    document.getElementById('btnReload').addEventListener('click', () => SB.reloadActive());
    document.getElementById('newTabBtn').addEventListener('click', () => SB.createTab());

    document.getElementById('btnSidebar').addEventListener('click', () => SB.panels.toggle('panelFavorites'));
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
          case 'i': e.preventDefault(); SB.goActive('devtools'); return;
          case 'r': e.preventDefault(); SB.goActive('reload-hard'); return;
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
      if (e.altKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); SB.omnibox.focus(); return; }
      if (e.key === 'F12') { e.preventDefault(); SB.goActive('devtools'); return; }
      if (e.key === 'F5') { e.preventDefault(); SB.reloadActive(); return; }
      if (e.key === 'Escape') {
        SB.selectionBar.hide();
        SB.menu.close();
        SB.panels.close();
        SB.menu.closeFind();
      }
    });
  }

  // ---- shortcuts sent from the main process (page had focus) --------------
  function handleShortcut(name) {
    if (!name) return;
    if (/^tab-[1-9]$/.test(name)) {
      const idx = Number(name.slice(4)) - 1;
      if (SB.tabs[idx]) SB.activateTab(SB.tabs[idx].id);
      return;
    }
    switch (name) {
      case 'new-tab': SB.createTab(); break;
      case 'new-private': SB.createTab({ incognito: true }); break;
      case 'close-tab': SB.closeTab(SB.activeTabId); break;
      case 'focus-omnibox': SB.omnibox.focus(); break;
      case 'reload': SB.reloadActive(); break;
      case 'reload-hard': SB.goActive('reload-hard'); break;
      case 'find': SB.menu.openFind(); break;
      case 'print': SB.goActive('print'); break;
      case 'save-page': SB.goActive('save-page'); break;
      case 'devtools': SB.goActive('devtools'); break;
      case 'bookmark': document.getElementById('btnBookmark').click(); break;
      case 'history': SB.panels.toggle('panelHistory'); break;
      case 'downloads': SB.panels.toggle('panelDownloads'); break;
      case 'favorites': SB.panels.toggle('panelFavorites'); break;
      case 'toggle-shine': SB.shine.toggle(); break;
      case 'zoom-in': SB.goActive('zoom-in'); break;
      case 'zoom-out': SB.goActive('zoom-out'); break;
      case 'zoom-reset': SB.goActive('zoom-reset'); break;
      case 'back': SB.goActive('back'); break;
      case 'forward': SB.goActive('forward'); break;
      case 'next-tab':
      case 'prev-tab': {
        const order = SB.tabs.slice().sort((a, b) => a.id - b.id);
        if (!order.length) return;
        const i = order.findIndex((t) => t.id === SB.activeTabId);
        const next = order[(i + (name === 'prev-tab' ? -1 : 1) + order.length) % order.length];
        if (next) SB.activateTab(next.id);
        break;
      }
      default: break;
    }
  }

  function initEventStream() {
    const TAB_EVENTS = [
      'tab:loading', 'tab:title', 'tab:favicon', 'tab:navigate', 'tab:fail',
      'tab:zoom', 'tab:crashed', 'tab:context-menu', 'tab:open-external-tab',
      'tab:selection',
    ];

    SB.ipc.events((channel, data) => {
      if (TAB_EVENTS.indexOf(channel) !== -1) {
        SB.onTabEvent(channel, data);
        return;
      }
      switch (channel) {
        case 'kb:shortcut':
          handleShortcut(data.name);
          break;
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
            SB.toast('Saved to favorites');
          }
          break;
        }
        case 'shine:state':
          SB.panelOpen = !!data.open;
          break;
        case 'downloads:changed':
          SB.refreshDownloads(data);
          break;
        default:
          break;
      }
    });
  }

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

    SB.createTab();

    if (SB.settings.panelOpen) setTimeout(() => SB.shine.show(), 400);

    let raf = null;
    window.addEventListener('resize', () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => SB.ipc.tab.layout());
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        const p = SB.ipc.webPath ? SB.ipc.webPath(file) : (file.path || '');
        if (p) SB.loadTab(SB.activeTab(), 'file:///' + String(p).replace(/\\/g, '/'));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
