// =====================================================================
// Shine Browser — main menu, context menu, find bar
// =====================================================================
(function () {
  const ACTIONS = {
    'new-tab': () => SB.createTab(),
    'new-window': () => SB.ipc.app.openExternal('shine://new-window').then(() => SB.createTab()),
    'new-private': () => SB.createTab({ incognito: true }),
    'history': () => SB.panels.toggle('panelHistory'),
    'downloads': () => SB.panels.toggle('panelDownloads'),
    'favorites': () => SB.panels.toggle('panelFavorites'),
    'reading-list': () => SB.toast('Reading list: save pages with Ctrl+D, they appear in Favorites.'),
    'sidebar': () => SB.panels.toggle('panelFavorites'),
    'split': () => SB.shine.toggle(),
    'shine': () => SB.shine.toggle(),
    'zoom-in': () => SB.goActive('zoom-in'),
    'zoom-out': () => SB.goActive('zoom-out'),
    'zoom-reset': () => SB.goActive('zoom-reset'),
    'print': () => SB.goActive('print'),
    'find': () => openFind(),
    'cast': () => SB.goActive('cast'),
    'task-manager': () => SB.goActive('task-manager'),
    'screenshot': () => SB.goActive('screenshot'),
    'devtools': () => SB.goActive('devtools'),
    'settings': () => SB.ipc.overlay.show('settings', { mode: 'xy', x: 0, y: 0 }, {}),
    'about': () => SB.ipc.overlay.show('settings', { mode: 'xy', x: 0, y: 0 }, {}),
    'quit': () => window.close(),
  };

  const MAIN_MENU_ITEMS = [
    { act: 'new-tab', label: 'New tab', kbd: 'Ctrl+T' },
    { act: 'new-window', label: 'New window', kbd: 'Ctrl+N' },
    { act: 'new-private', label: 'New private window', kbd: 'Ctrl+Shift+N' },
    { act: 'sep' },
    { act: 'sidebar', label: 'Sidebar (Favorites)', kbd: 'Ctrl+B' },
    { act: 'split', label: 'Shine split screen', kbd: 'Ctrl+Shift+S' },
    { act: 'find', label: 'Find on page', kbd: 'Ctrl+F' },
    { act: 'sep' },
    { act: 'history', label: 'History', kbd: 'Ctrl+H' },
    { act: 'downloads', label: 'Downloads', kbd: 'Ctrl+J' },
    { act: 'favorites', label: 'Favorites', kbd: 'Ctrl+B' },
    { act: 'reading-list', label: 'Reading list' },
    { act: 'sep' },
    { act: 'shine', label: 'Shine split screen', kbd: 'Ctrl+Shift+S' },
    { act: 'sep' },
    { act: 'zoom-in', label: 'Zoom in', kbd: 'Ctrl++' },
    { act: 'zoom-out', label: 'Zoom out', kbd: 'Ctrl+-' },
    { act: 'zoom-reset', label: 'Reset zoom', kbd: 'Ctrl+0' },
    { act: 'sep' },
    { act: 'print', label: 'Print', kbd: 'Ctrl+P' },
    { act: 'find', label: 'Find on page', kbd: 'Ctrl+F' },
    { act: 'cast', label: 'Cast' },
    { act: 'task-manager', label: 'Task manager' },
    { act: 'screenshot', label: 'Screenshot' },
    { act: 'devtools', label: 'Developer tools', kbd: 'F12' },
    { act: 'sep' },
    { act: 'settings', label: 'Settings' },
    { act: 'about', label: 'About Shine Browser' },
    { act: 'quit', label: 'Quit', kbd: 'Ctrl+Q' },
  ];

  let menuOpen = false;

  function openMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    menuOpen = true;
    SB.ipc.overlay.show('main-menu',
      { mode: 'r', r: r.right, y: r.bottom + 6 },
      { items: MAIN_MENU_ITEMS });
  }

  function closeMenus() {
    if (menuOpen) {
      menuOpen = false;
      SB.ipc.overlay.hide('main-menu');
    }
    SB.ipc.overlay.hide('context-menu');
    SB.ipc.overlay.hide('omni-suggestions');
    SB.ipc.overlay.hide('selection-bar');
  }
  SB.closeMenus = closeMenus;

  // ---- find bar ----------------------------------------------------------
  function openFind() {
    const bar = document.getElementById('findBar');
    if (!bar) return;
    bar.classList.remove('hidden');
    document.body.classList.add('finding');
    const inp = document.getElementById('findInput');
    inp.focus();
    inp.select();
    SB.syncChromeHeight();
  }

  function closeFind() {
    const bar = document.getElementById('findBar');
    if (!bar || bar.classList.contains('hidden')) return;
    bar.classList.add('hidden');
    document.body.classList.remove('finding');
    SB.goActive('find-stop');
    SB.syncChromeHeight();
  }

  function runFind(step) {
    const q = document.getElementById('findInput').value;
    const tab = SB.activeTab();
    if (!tab || !q) return;
    SB.ipc.tab.op(tab.id, 'find', q);
    document.getElementById('findCount').textContent = step === 'prev' ? '↑ prev' : '↓ next';
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnMenu').addEventListener('click', (e) => {
      e.stopPropagation();
      if (menuOpen) { closeMenus(); return; }
      openMenu(e.currentTarget);
    });

    document.getElementById('findClose').addEventListener('click', closeFind);
    document.getElementById('findNext').addEventListener('click', () => runFind('next'));
    document.getElementById('findPrev').addEventListener('click', () => runFind('prev'));
    document.getElementById('findInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runFind(e.shiftKey ? 'prev' : 'next');
      if (e.key === 'Escape') closeFind();
    });

    document.addEventListener('click', (e) => {
      if (menuOpen && !e.target.closest('#btnMenu')) {
        menuOpen = false;
        SB.ipc.overlay.hide('main-menu');
      }
      if (!e.target.closest('#omniWrap')) SB.ipc.overlay.hide('omni-suggestions');
    });
  });

  // ---- context menu ------------------------------------------------------
  let lastCtx = null;

  SB.showContextMenu = function (params, tab) {
    const items = [];
    const sel = (params.selectionText || '').trim();

    if (sel) {
      items.push({ act: 'ask-shine', label: 'Ask Shine about this' });
      items.push({ act: 'google-sel', label: 'Search Google for selection', icon: 'search' });
      items.push({ act: 'site-sel', label: 'Search this site for selection', icon: 'globe' });
      items.push({ act: 'copy', label: 'Copy', icon: 'copy' });
      items.push({ act: 'translate', label: 'Translate selection', icon: 'translate' });
      items.push({ act: 'sep' });
    }
    if (params.isEditable) {
      items.push({ act: 'undo', label: 'Undo', disabled: !params.editFlags.canUndo });
      items.push({ act: 'redo', label: 'Redo', disabled: !params.editFlags.canRedo });
      items.push({ act: 'sep' });
      items.push({ act: 'cut', label: 'Cut', disabled: !params.editFlags.canCut });
      items.push({ act: 'copy', label: 'Copy', disabled: !params.editFlags.canCopy });
      items.push({ act: 'paste', label: 'Paste', disabled: !params.editFlags.canPaste });
      items.push({ act: 'select-all', label: 'Select all', disabled: !params.editFlags.canSelectAll });
      items.push({ act: 'sep' });
    } else if (!sel) {
      items.push({ act: 'back', label: 'Back' });
      items.push({ act: 'forward', label: 'Forward' });
      items.push({ act: 'reload', label: 'Reload' });
      items.push({ act: 'sep' });
      items.push({ act: 'copy-link', label: 'Copy link', disabled: !params.linkURL });
      items.push({ act: 'open-link-new', label: 'Open link in new tab', disabled: !params.linkURL });
      items.push({ act: 'save-link', label: 'Save link as…', disabled: !params.linkURL });
      items.push({ act: 'sep' });
      items.push({ act: 'save-page', label: 'Save page as…' });
      items.push({ act: 'print', label: 'Print…' });
      items.push({ act: 'sep' });
    }
    if (params.mediaType === 'image' || (params.srcURL && !params.isEditable)) {
      items.push({ act: 'open-image', label: 'Open image in new tab', disabled: params.mediaType !== 'image' });
      items.push({ act: 'save-image', label: 'Save image as…', disabled: params.mediaType !== 'image' });
      items.push({ act: 'copy-image', label: 'Copy image', disabled: params.mediaType !== 'image' });
      items.push({ act: 'copy-image-src', label: 'Copy image address', disabled: !params.srcURL });
      items.push({ act: 'sep' });
    }
    if (params.misspelledWord) {
      items.push({ act: 'spell', label: 'Add to dictionary', disabled: true });
      items.push({ act: 'sep' });
    }
    items.push({ act: 'inspect', label: 'Inspect element' });
    items.push({ act: 'sep' });
    items.push({ act: 'new-tab', label: 'New tab' });
    items.push({ act: 'new-private', label: 'New private window' });

    lastCtx = { params, tab, sel };

    const chromeH = SB.chromeH || 122;
    SB.ipc.overlay.show('context-menu',
      { mode: 'xy', x: params.x, y: params.y + chromeH },
      { items });
  };

  function handleContext(act) {
    if (!lastCtx) return;
    const { params, tab } = lastCtx;
    const sel = lastCtx.sel;
    SB.ipc.overlay.hide('context-menu');
    if (act === 'sep') return;

    const q = sel || params.selectionText || '';
    const url = params.linkURL || params.srcURL || (tab && tab.url);
    const engine = (SB.settings.searchEngine || 'google');
    const engines = {
      google: 'https://www.google.com/search?q=',
      bing: 'https://www.bing.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q=',
      brave: 'https://search.brave.com/search?q=',
      ecosia: 'https://www.ecosia.org/search?q=',
      startpage: 'https://www.startpage.com/sp/search?query=',
      youtube: 'https://www.youtube.com/results?search_query=',
    };
    const sq = (engines[engine] || engines.google) + encodeURIComponent(q);

    switch (act) {
      case 'ask-shine': SB.shine.open(); SB.ipc.shine.ask(q, 'selection'); break;
      case 'google-sel': SB.loadTab(tab, sq); break;
      case 'site-sel': {
        try {
          const u = new URL(tab.url);
          SB.loadTab(tab, `https://www.google.com/search?q=${encodeURIComponent(q)}+site:${u.hostname}`);
        } catch (e) { SB.loadTab(tab, sq); }
        break;
      }
      case 'copy': SB.copy(q, 'Copied to clipboard'); break;
      case 'translate': SB.shine.open(); SB.ipc.shine.ask(q, 'translate'); break;
      case 'undo': SB.ipc.tab.op(tab.id, 'undo'); break;
      case 'redo': SB.ipc.tab.op(tab.id, 'redo'); break;
      case 'cut': SB.ipc.tab.op(tab.id, 'cut'); break;
      case 'paste': SB.ipc.tab.op(tab.id, 'paste'); break;
      case 'select-all': SB.ipc.tab.op(tab.id, 'select-all'); break;
      case 'copy-link': SB.copy(params.linkURL, 'Link copied'); break;
      case 'open-link-new': SB.createTab({ url: params.linkURL, incognito: tab.incognito }); break;
      case 'save-link': SB.copy(params.linkURL, 'URL copied — use Ctrl+S in the page to save.'); break;
      case 'open-image': SB.createTab({ url: params.srcURL, incognito: tab.incognito }); break;
      case 'copy-image': SB.copy(params.srcURL, 'Image copied (address)'); break;
      case 'save-image': SB.ipc.tab.op(tab.id, 'save-page'); break;
      case 'copy-image-src': SB.copy(params.srcURL, 'Image address copied'); break;
      case 'save-page': SB.ipc.tab.op(tab.id, 'save-page'); break;
      case 'print': SB.ipc.tab.op(tab.id, 'print'); break;
      case 'inspect': SB.ipc.tab.op(tab.id, 'devtools'); break;
      case 'back': SB.goActive('back'); break;
      case 'forward': SB.goActive('forward'); break;
      case 'reload': SB.goActive('reload'); break;
      case 'new-tab': SB.createTab(); break;
      case 'new-private': SB.createTab({ incognito: true }); break;
      default: break;
    }
  }

  // ---- routing clicks that come back from the overlay --------------------
  SB.onOverlayAction = function (payload) {
    if (!payload) return;
    const { widget, action, data } = payload;

    if (widget === 'main-menu') {
      menuOpen = false;
      SB.ipc.overlay.hide('main-menu');
      const fn = ACTIONS[action];
      if (fn) fn();
      return;
    }

    if (widget === 'context-menu') {
      handleContext(action);
      return;
    }

    if (widget === 'selection-bar') {
      SB.selectionBar.act(action);
      return;
    }

    if (widget === 'omni-suggestions') {
      SB.onOverlaySuggestion(action, data);
      return;
    }

    if (widget === 'settings') {
      if (action === 'toast') SB.toast((data && data.text) || '');
      if (action === 'panel-width') SB.ipc.shine.setWidth(data.ratio);
      if (action === 'panel-open') { if (data.open) SB.shine.show(); else SB.shine.hide(); }
    }
  };

  SB.menu = {
    open: openMenu,
    close: closeMenus,
    openFind,
    closeFind,
    runFind,
    ACTIONS,
  };
})();
