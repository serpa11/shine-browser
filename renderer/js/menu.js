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
    'extensions': () => SB.panels.toggle('panelExtensions'),
    'web-store': () => { const t = SB.activeTab(); if (t) SB.loadTab(t, 'https://chromewebstore.google.com/'); },
    'pc-control': () => SB.panels.toggle('panelPC'),
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
    'settings': () => openSettings(),
    'about': () => openSettings(),
    'quit': () => window.close(),
  };

  function openMenu(anchor) {
    const menu = document.getElementById('mainMenu');
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    const w = menu.offsetWidth;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  }

  function closeMenus() {
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('contextMenu').classList.add('hidden');
    document.getElementById('omniSuggestions').classList.add('hidden');
  }

  // ---- find bar ----------------------------------------------------------
  function openFind() {
    const bar = document.getElementById('findBar');
    bar.classList.remove('hidden');
    const inp = document.getElementById('findInput');
    inp.focus();
    inp.select();
  }

  function closeFind() {
    document.getElementById('findBar').classList.add('hidden');
    SB.goActive('find-stop');
  }

  function runFind(step) {
    const q = document.getElementById('findInput').value;
    const tab = SB.activeTab();
    if (!tab || !q) return;
    SB.ipc.tab.op(tab.id, 'find', q);
    document.getElementById('findCount').textContent = step === 'prev' ? '↑ prev' : '↓ next';
  }

  // ---- settings ----------------------------------------------------------
  async function openSettings() {
    const w = document.getElementById('settingsWindow');
    w.classList.remove('hidden');
    const s = await SB.ipc.settings.get();
    SB.settings = s;
    document.getElementById('setSearchEngine').value = s.searchEngine || 'google';
    document.getElementById('setPanelWidth').value = Math.round((s.panelWidth || 0.42) * 100);
    document.getElementById('setPanelOpen').checked = !!s.panelOpen;
    const info = await SB.ipc.app.info();
    const st = await SB.ipc.setup.status();
    document.getElementById('aboutBox').innerHTML = `
      <strong>Shine Browser</strong> ${SB.escapeHtml(info.version)}<br>
      Chromium engine <strong>${SB.escapeHtml(info.chrome)}</strong> — updated for 2026<br>
      Electron ${SB.escapeHtml(info.electron)} · Node ${SB.escapeHtml(info.node)}<br>
      ${info.platform} ${info.arch}<br>
      Profile data: ${SB.escapeHtml(info.userData)}<br>
      Shortcuts installed: <strong>${st.desktopShortcut ? 'Desktop ✓' : 'Desktop ✗'}</strong>
      · <strong>${st.startMenuShortcut ? 'Start menu ✓' : 'Start menu ✗'}</strong>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    // main menu
    document.getElementById('btnMenu').addEventListener('click', (e) => {
      e.stopPropagation();
      const m = document.getElementById('mainMenu');
      if (m.classList.contains('hidden')) openMenu(e.currentTarget);
      else m.classList.add('hidden');
    });
    document.querySelectorAll('#mainMenu button').forEach((b) => {
      b.addEventListener('click', () => {
        closeMenus();
        const fn = ACTIONS[b.dataset.act];
        if (fn) fn();
      });
    });

    // settings window
    document.getElementById('closeSettings').addEventListener('click', () => {
      document.getElementById('settingsWindow').classList.add('hidden');
    });
    document.getElementById('setSearchEngine').addEventListener('change', async (e) => {
      await SB.ipc.settings.set({ searchEngine: e.target.value });
      SB.settings.searchEngine = e.target.value;
      SB.toast('Search engine updated');
    });
    document.getElementById('setPanelWidth').addEventListener('input', (e) => {
      const r = Number(e.target.value) / 100;
      SB.ipc.shine.setWidth(r);
      const p = document.getElementById('shinePanel');
      p.style.width = Math.round(r * 100) + '%';
    });
    document.getElementById('setPanelOpen').addEventListener('change', async (e) => {
      await SB.ipc.settings.set({ panelOpen: e.target.checked });
      if (e.target.checked) SB.shine.show(); else SB.shine.hide();
    });
    document.getElementById('setStartup').addEventListener('change', async (e) => {
      await SB.ipc.settings.set({ startup: e.target.value });
    });
    document.getElementById('changeDl').addEventListener('click', () => {
      SB.toast('Downloads folder is set in Settings → Downloads.');
    });
    document.getElementById('renameProfile').addEventListener('click', async () => {
      const name = prompt('Profile name', document.getElementById('profileName').textContent);
      if (name) {
        document.getElementById('profileName').textContent = name;
        await SB.ipc.settings.set({ profileName: name });
      }
    });
    document.getElementById('reRunSetup').addEventListener('click', () => {
      document.getElementById('settingsWindow').classList.add('hidden');
      if (SB.setup) SB.setup.show();
    });

    // find bar
    document.getElementById('findClose').addEventListener('click', closeFind);
    document.getElementById('findNext').addEventListener('click', () => runFind('next'));
    document.getElementById('findPrev').addEventListener('click', () => runFind('prev'));
    document.getElementById('findInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runFind(e.shiftKey ? 'prev' : 'next');
      if (e.key === 'Escape') closeFind();
    });

    // global click-away
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#mainMenu') && !e.target.closest('#btnMenu')) {
        document.getElementById('mainMenu').classList.add('hidden');
      }
      if (!e.target.closest('#contextMenu')) {
        document.getElementById('contextMenu').classList.add('hidden');
      }
      if (!e.target.closest('#omniWrap')) {
        document.getElementById('omniSuggestions').classList.add('hidden');
      }
      if (!e.target.closest('.side-panel') && !e.target.closest('#toolbar') && !e.target.closest('#titleBar') && !e.target.closest('#tabStrip')) {
        // keep panels open when interacting with them
      }
    });
  });

  // ---- context menu ------------------------------------------------------
  SB.showContextMenu = function (params, tab) {
    const cm = document.getElementById('contextMenu');
    const items = [];
    const sel = (params.selectionText || '').trim();

    if (sel) {
      items.push({ act: 'ask-shine', label: 'Ask Shine about this', icon: 'spark' });
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
      items.push({ act: 'spell', label: `Add to dictionary`, disabled: true });
      items.push({ act: 'sep' });
    }
    items.push({ act: 'inspect', label: 'Inspect element' });
    items.push({ act: 'sep' });
    items.push({ act: 'new-tab', label: 'New tab' });
    items.push({ act: 'new-private', label: 'New private window' });

    cm.innerHTML = items.map((it) => {
      if (it.act === 'sep') return '<div class="menu-sep"></div>';
      const icons = {
        spark: '<path d="M12 3c.6 4.2 4.8 8.4 9 9-4.2.6-8.4 4.8-9 9-.6-4.2-4.8-8.4-9-9 4.2-.6 8.4-4.8 9-9Z"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/>',
        globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
        translate: '<path d="M4 6h9M8.5 4v2c0 4-2 7-4.5 8.5"/><path d="M6 10c1.5 2.5 3.5 4 6 5"/><path d="M13 20l3.5-9 3.5 9"/>',
      };
      const icon = it.icon ? `<svg class="svg-icon" viewBox="0 0 24 24" style="flex:none">${icons[it.icon]}</svg>` : '';
      return `<button data-act="${it.act}" data-sel="${it.act.includes('-sel') || it.act === 'ask-shine' ? '1' : ''}" ${it.disabled ? 'disabled style="opacity:.35;pointer-events:none"' : ''}>
        <span style="display:flex;align-items:center;gap:9px">${icon}${SB.escapeHtml(it.label)}</span>
      </button>`;
    }).join('');

    cm.classList.remove('hidden');
    const w = cm.offsetWidth, h = cm.offsetHeight;
    cm.style.left = Math.min(params.x, window.innerWidth - w - 8) + 'px';
    cm.style.top = Math.min(params.y, window.innerHeight - h - 8) + 'px';

    cm.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => handleContext(b.dataset.act, params, tab, sel));
    });
  };

  function handleContext(act, params, tab, sel) {
    document.getElementById('contextMenu').classList.add('hidden');
    const q = sel || params.selectionText || '';
    const url = params.linkURL || params.srcURL || tab.url;
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
      case 'ask-shine': SB.ipc.shine.ask(q, 'selection'); SB.toast('Asking Shine…'); break;
      case 'google-sel': SB.loadTab(tab, sq); break;
      case 'site-sel': {
        try {
          const u = new URL(tab.url);
          SB.loadTab(tab, `https://www.google.com/search?q=${encodeURIComponent(q)}+site:${u.hostname}`);
        } catch (e) { SB.loadTab(tab, sq); }
        break;
      }
      case 'copy': navigator.clipboard.writeText(q).then(() => SB.toast('Copied to clipboard')); break;
      case 'translate': SB.ipc.shine.ask(q, 'translate'); SB.toast('Asking Shine to translate…'); break;
      case 'undo': SB.ipc.tab.op(tab.id, 'op', 'undo'); break;
      case 'cut': document.execCommand('cut'); break;
      case 'copy-link': navigator.clipboard.writeText(params.linkURL); SB.toast('Link copied'); break;
      case 'open-link-new': SB.createTab({ url: params.linkURL, incognito: tab.incognito }); break;
      case 'save-link': navigator.clipboard.writeText(params.linkURL); SB.toast('URL copied — use Ctrl+S in the page to save.'); break;
      case 'open-image': SB.createTab({ url: params.srcURL, incognito: tab.incognito }); break;
      case 'copy-image': navigator.clipboard.writeText(params.srcURL); SB.toast('Image copied (address)'); break;
      case 'save-image': SB.ipc.tab.op(tab.id, 'save-page'); break;
      case 'copy-image-src': navigator.clipboard.writeText(params.srcURL); SB.toast('Image address copied'); break;
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

  SB.menu = { open: openMenu, close: closeMenus, openFind, openSettings, closeFind };
})();
