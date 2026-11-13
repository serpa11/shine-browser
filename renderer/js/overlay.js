// =====================================================================
// Shine Browser — floating overlay renderer
// Hosts everything that has to appear ON TOP of the page: the selection
// pill, the context menu, the main menu, omnibox suggestions, toasts and
// the settings window. The main process sizes the overlay view to exactly
// the widget being shown, so the page underneath stays fully clickable.
// =====================================================================
(function () {
  const API = window.shineOverlay;
  let seq = 0;                 // last render we measured
  let current = null;          // widget name currently on screen

  const $ = (id) => document.getElementById(id);

  // ---- icons -----------------------------------------------------------
  const ICONS = {
    spark: '',
    search: '<circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/>',
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.4 2.5 13.2 0 16M12 4c-2.5 2.4-2.5 13.2 0 16"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    translate: '<path d="M4 6h9M8.5 4v2c0 4-2 7-4.5 8.5"/><path d="M6 10c1.5 2.5 3.5 4 6 5"/><path d="M13 20l3.5-9 3.5 9M14.5 17h5"/>',
    book: '<path d="M5 5h6a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5H5Z"/><path d="M19 5h-2.5A2.5 2.5 0 0 0 14 7.5V19a2.5 2.5 0 0 1 2.5-2.5H19Z"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>',
    dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v4h4"/>',
    down: '<path d="M12 4v11"/><path d="M8 11.5 12 15.5l4-4"/><path d="M5 19h14"/>',
    puzzle: '<path d="M10 3.5a2.5 2.5 0 0 1 5 0V6h3a1 1 0 0 1 1 1v3h2.5a2.5 2.5 0 0 1 0 5H19v3a1 1 0 0 1-1 1h-3v-2.5a2.5 2.5 0 0 0-5 0V19H7a1 1 0 0 1-1-1v-3H3.5a2.5 2.5 0 0 1 0-5H6V7a1 1 0 0 1 1-1h3V3.5Z"/>',
    store: '<path d="M4 8h16l-1.2 11.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8L4 8Z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/>',
    desktop: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    star: '<path d="M12 4.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.8l5-.7L12 4.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-3 7.5-7 9-4-1.5-7-4.8-7-9V6l7-3Z"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
    power: '<path d="M12 4v8"/><path d="M7.5 7.5a6.5 6.5 0 1 0 9 0"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  function svg(name) {
    const p = ICONS[name];
    if (!p) return '';
    return '<svg class="svg-icon" viewBox="0 0 24 24" style="flex:none">' + p + '</svg>';
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // ---- renderers -------------------------------------------------------
  function renderSelectionBar(data) {
    const btns = (data && data.buttons) || [];
    return btns.map((b) => `
      <button data-act="${esc(b.act)}"${b.primary ? ' class="primary"' : ''}>
        ${b.icon ? svg(b.icon) : ''}<span>${esc(b.label)}</span>
      </button>`).join('');
  }

  function renderMenu(items) {
    return (items || []).map((it) => {
      if (it.sep || it.act === 'sep') return '<div class="menu-sep"></div>';
      const kbd = it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : '';
      const dis = it.disabled ? ' disabled style="opacity:.35;pointer-events:none"' : '';
      const lead = it.icon
        ? `<span style="display:flex;align-items:center;gap:9px">${svg(it.icon)}${esc(it.label)}</span>`
        : `<span>${esc(it.label)}</span>`;
      return `<button data-act="${esc(it.act)}"${dis}>${lead}${kbd}</button>`;
    }).join('');
  }

  function renderSuggestions(data) {
    const items = (data && data.items) || [];
    const index = (data && typeof data.index === 'number') ? data.index : -1;
    return items.map((it, i) => `
      <div class="list-item omni-sug${i === index ? ' active' : ''}${it.kind === 'shine' ? ' shine-sug' : ''}" data-i="${i}">
        <span class="favicon sug-icon">${svg(it.icon || (it.kind === 'bookmark' ? 'bookmark' : it.kind === 'history' || it.kind === 'url' ? 'history' : 'search'))}</span>
        <div class="li-main">
          <div class="li-title">${esc(it.label)}</div>
          <div class="li-sub">${esc(it.sub || '')}</div>
        </div>
      </div>`).join('');
  }

  function renderToast(data) {
    return esc((data && data.text) || '');
  }

  // ---- settings panel (self-contained) ---------------------------------
  let settingsWired = false;

  async function openSettings() {
    const w = $('settingsWindow');
    w.classList.add('on');
    if (!settingsWired) { wireSettings(); settingsWired = true; }
    try {
      const s = await API.settings.get();
      $('setSearchEngine').value = s.searchEngine || 'google';
      $('setStartup').value = s.startup || 'homepage';
      $('setPanelWidth').value = Math.round((s.panelWidth || 0.42) * 100);
      $('setPanelOpen').checked = !!s.panelOpen;
      $('setAIEnabled').checked = s.aiEnabled !== false;
      $('profileName').textContent = s.profileName || 'Person 1';

      const info = await API.app.info();
      const st = await API.setup.status();
      $('aboutBox').innerHTML = `
        <strong>Shine Browser</strong> ${esc(info.version)}<br>
        Chromium engine <strong>${esc(info.chrome)}</strong> — updated for 2026<br>
        Electron ${esc(info.electron)} · Node ${esc(info.node)}<br>
        ${esc(info.platform)} ${esc(info.arch)}<br>
        Profile data: ${esc(info.userData)}<br>
        Shortcuts installed: <strong>${st.desktopShortcut ? 'Desktop ✓' : 'Desktop ✗'}</strong>
        · <strong>${st.startMenuShortcut ? 'Start menu ✓' : 'Start menu ✗'}</strong>`;
    } catch (e) { /* ignore */ }
    report();
  }

  function closeSettings() {
    $('settingsWindow').classList.remove('on');
    API.dismiss();
  }

  function wireSettings() {
    $('closeSettings').addEventListener('click', closeSettings);

    $('setSearchEngine').addEventListener('change', async (e) => {
      await API.settings.set({ searchEngine: e.target.value });
      API.action({ widget: 'settings', action: 'toast', data: { text: 'Search engine updated' } });
    });
    $('setStartup').addEventListener('change', async (e) => {
      await API.settings.set({ startup: e.target.value });
    });
    $('setPanelWidth').addEventListener('input', async (e) => {
      const r = Number(e.target.value) / 100;
      await API.settings.set({ panelWidth: r });
      API.action({ widget: 'settings', action: 'panel-width', data: { ratio: r } });
    });
    $('setPanelOpen').addEventListener('change', async (e) => {
      await API.settings.set({ panelOpen: e.target.checked });
      API.action({ widget: 'settings', action: 'panel-open', data: { open: e.target.checked } });
    });
    $('setAIEnabled').addEventListener('change', async (e) => {
      await API.settings.set({ aiEnabled: e.target.checked });
      API.action({ widget: 'settings', action: 'ai-toggle', data: { enabled: e.target.checked } });
    });
    $('changeDl').addEventListener('click', () => {
      API.action({ widget: 'settings', action: 'toast', data: { text: 'Downloads folder is set in Settings → Downloads.' } });
    });
    $('renameProfile').addEventListener('click', async () => {
      const cur = $('profileName').textContent;
      const name = window.prompt('Profile name', cur);
      if (name && name.trim()) {
        $('profileName').textContent = name.trim();
        await API.settings.set({ profileName: name.trim() });
      }
    });
    $('reRunSetup').addEventListener('click', () => {
      closeSettings();
      API.setup.open();
    });
  }

  // ---- measure + protocol ---------------------------------------------
  function report() {
    if (!seq) return;
    let w = 0;
    let h = 0;
    if (current === 'settings') {
      w = window.innerWidth;
      h = window.innerHeight;
    } else {
      const node = document.querySelector('.ov.on');
      if (node) { w = node.offsetWidth; h = node.offsetHeight; }
    }
    API.measured(seq, w, h);
  }

  function hideAll() {
    ['selectionBar', 'contextMenu', 'mainMenu', 'omniSuggestions', 'toast', 'settingsWindow']
      .forEach((id) => $(id).classList.remove('on'));
  }

  API.onRender((spec) => {
    if (!spec) return;
    const widget = spec.widget;
    current = widget;
    seq = spec.seq;

    if (widget === 'settings') {
      hideAll();
      openSettings();
      return;
    }

    hideAll();
    const node = $(widget === 'context-menu' ? 'contextMenu'
      : widget === 'main-menu' ? 'mainMenu'
        : widget === 'omni-suggestions' ? 'omniSuggestions'
          : widget === 'toast' ? 'toast'
            : 'selectionBar');

    if (widget === 'selection-bar') node.innerHTML = renderSelectionBar(spec.data);
    else if (widget === 'context-menu' || widget === 'main-menu') node.innerHTML = renderMenu(spec.data && spec.data.items);
    else if (widget === 'omni-suggestions') node.innerHTML = renderSuggestions(spec.data);
    else if (widget === 'toast') node.innerHTML = renderToast(spec.data);

    node.classList.add('on');

    // Position inside the stage. The main process already moved the whole
    // view so that the widget's top-left lands on stage (14,14) — we just
    // pin it there and let the bounds do the clamping.
    node.style.left = '0px';
    node.style.top = '0px';

    requestAnimationFrame(report);
    requestAnimationFrame(() => requestAnimationFrame(report));
  });

  API.onPlace((p) => {
    if (!p) return;
    const node = document.querySelector('.ov.on');
    if (node) {
      node.style.left = (p.x || 0) + 'px';
      node.style.top = (p.y || 0) + 'px';
    }
  });

  // ---- interactions ----------------------------------------------------
  document.addEventListener('mousedown', (e) => {
    // clicks on the transparent padding around a widget dismiss it
    if (!e.target.closest('.ov') || e.target.classList.contains('ov')) {
      API.dismiss();
    }
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn && btn.dataset.act) {
      API.action({ widget: current, action: btn.dataset.act });
      return;
    }
    const sug = e.target.closest('.omni-sug');
    if (sug && sug.dataset.i !== undefined) {
      API.action({ widget: 'omni-suggestions', action: 'pick', data: { index: Number(sug.dataset.i) } });
      return;
    }
    if (current === 'settings' && e.target.id === 'settingsWindow') closeSettings();
  });

  document.addEventListener('keydown', (e) => {
    API.action({ widget: current, action: 'key', data: { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey } });
  });

  // toast auto-hide is driven by the chrome renderer via a second render;
  // nothing else to do here.
})();
