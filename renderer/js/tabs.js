// =====================================================================
// Shine Browser — tab engine
// Every tab is a WebContentsView owned by the main process; this module
// only keeps the UI state and sends IPC commands. No <webview> tags.
// =====================================================================
(function () {
  SB.createTab = function (opts) {
    opts = opts || {};
    const id = SB.nextTabId++;
    const incognito = !!opts.incognito;

    const tab = {
      id,
      incognito,
      url: '',
      title: incognito ? 'Private' : 'New Tab',
      favicon: '',
      loading: false,
      zoomFactor: 1,
      canGoBack: false,
      canGoForward: false,
    };
    SB.tabs.push(tab);

    SB.ipc.tab.create(id, incognito, opts.url || 'shine://newtab');
    if (opts.url) { tab.url = opts.url; }

    SB.activateTab(id);
    return tab;
  };

  SB.activateTab = function (id) {
    const tab = SB.tabs.find((t) => t.id === id);
    if (!tab) return;
    SB.activeTabId = id;
    SB.ipc.tab.show(id);
    SB.ipc.tab.layout();
    renderTabs();
    SB.omnibox && SB.omnibox.syncFromTab(tab);
    SB.updateBookmarkStar();
    refreshNavState(tab);
  };

  SB.activeTab = function () {
    return SB.tabs.find((t) => t.id === SB.activeTabId) || null;
  };

  SB.closeTab = function (id) {
    const idx = SB.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = SB.tabs[idx];
    SB.ipc.tab.destroy(id);
    SB.tabs.splice(idx, 1);

    if (!SB.tabs.length) {
      SB.createTab({ incognito: tab.incognito });
      return;
    }
    if (SB.activeTabId === id) {
      const next = SB.tabs[Math.max(0, idx - 1)];
      SB.activateTab(next.id);
    } else {
      renderTabs();
    }
  };

  SB.loadTab = function (tab, url) {
    if (!tab) tab = SB.activeTab();
    if (!tab) return;
    SB.ipc.tab.load(tab.id, url);
    tab.loading = true;
    renderTabs();
  };

  SB.reloadActive = function () {
    const t = SB.activeTab();
    if (t) SB.ipc.tab.op(t.id, 'reload');
  };

  SB.goActive = function (op, arg) {
    const t = SB.activeTab();
    if (t) SB.ipc.tab.op(t.id, op, arg);
  };

  function refreshNavState(tab) {
    if (!tab) return;
    SB.ipc.tab.info(tab.id).then((info) => {
      if (!info || tab.id !== SB.activeTabId) return;
      tab.url = info.url || tab.url;
      if (info.title) tab.title = info.title;
      tab.zoomFactor = info.zoomFactor;
      tab.canGoBack = !!info.canGoBack;
      tab.canGoForward = !!info.canGoForward;
      SB.$('#btnBack').disabled = !tab.canGoBack;
      SB.$('#btnForward').disabled = !tab.canGoForward;
      SB.omnibox && SB.omnibox.syncFromTab(tab);
      SB.updateBookmarkStar();
      renderTabs();
    }).catch(() => {});
  }
  SB.refreshNavState = refreshNavState;

  // ---- events pushed from the main process -------------------------------
  SB.onTabEvent = function (channel, data) {
    const tab = SB.tabs.find((t) => t.id === data.tabId);
    switch (channel) {
      case 'tab:loading':
        if (tab) { tab.loading = !!data.loading; renderTabs(); }
        break;
      case 'tab:title':
        if (tab) { tab.title = data.title || tab.title; renderTabs(); }
        break;
      case 'tab:favicon':
        if (tab) { tab.favicon = data.favicon || ''; renderTabs(); }
        break;
      case 'tab:navigate':
        if (tab) {
          tab.url = data.url;
          tab.loading = false;
          if (data.url === 'shine://newtab') tab.title = tab.incognito ? 'Private' : 'New Tab';
          SB.omnibox && SB.omnibox.syncFromTab(tab);
          SB.updateBookmarkStar();
          renderTabs();
          refreshNavState(tab);
        }
        break;
      case 'tab:zoom':
        if (tab) tab.zoomFactor = data.zoomFactor;
        break;
      case 'tab:fail':
        if (tab) {
          tab.loading = false;
          SB.toast(`Couldn't load page (${data.code})`);
          renderTabs();
        }
        break;
      case 'tab:crashed':
        if (tab) {
          SB.toast('This tab crashed — reloading.');
          SB.ipc.tab.op(tab.id, 'reload');
        }
        break;
      case 'tab:open-external-tab':
        SB.createTab({ url: data.url, incognito: !!data.incognito });
        break;
      case 'tab:context-menu': {
        const t = SB.tabs.find((x) => x.id === data.tabId) || SB.activeTab();
        if (t) SB.showContextMenu(data, t);
        break;
      }
      case 'tab:selection':
        onSelection(data.text || '');
        break;
      default:
        break;
    }
  };

  // ---- selection action bar ---------------------------------------------
  function onSelection(text) {
    const t = String(text || '').trim();
    if (!t) {
      SB.selection.text = '';
      SB.selectionBar.hide();
      return;
    }
    SB.selection.text = t;
    const tab = SB.activeTab();
    if (!tab) return;
    // fetch the rectangle so the pill sits under the highlighted text
    SB.ipc.tab.selectionRect(tab.id)
      .then((rect) => SB.selectionBar.show(rect, t, tab))
      .catch(() => SB.selectionBar.show(null, t, tab));
  }

  // ---- tab strip rendering ----------------------------------------------
  function renderTabs() {
    const strip = document.getElementById('tabs');
    if (!strip) return;
    strip.innerHTML = '';
    SB.tabs.forEach((tab) => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === SB.activeTabId ? ' active' : '');
      el.title = tab.title || tab.url;
      el.dataset.tabId = String(tab.id);

      if (tab.loading) {
        const sp = document.createElement('div');
        sp.className = 'tab-spinner';
        el.appendChild(sp);
      } else if (tab.favicon) {
        const img = document.createElement('img');
        img.className = 'tab-fav img';
        img.src = tab.favicon;
        img.referrerPolicy = 'no-referrer';
        img.style.filter = 'grayscale(1)';
        img.onerror = () => { const f = fallback(); if (img.parentNode) img.replaceWith(f); };
        el.appendChild(img);
      } else {
        el.appendChild(fallback());
      }

      function fallback() {
        const f = document.createElement('div');
        f.className = 'tab-fallback';
        return f;
      }

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = tab.title || 'New Tab';
      el.appendChild(title);

      if (SB.tabs.length > 1) {
        const close = document.createElement('button');
        close.className = 'tab-close';
        close.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        close.title = 'Close tab';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          SB.closeTab(tab.id);
        });
        el.appendChild(close);
      }

      el.addEventListener('click', () => SB.activateTab(tab.id));
      el.addEventListener('auxclick', (e) => { if (e.button === 1) SB.closeTab(tab.id); });
      strip.appendChild(el);
    });

    const activeEl = strip.querySelector('.tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    syncChromeHeight();
  }

  function syncChromeHeight() {
    const title = document.getElementById('titleBar');
    const tabsEl = document.getElementById('tabStrip');
    const toolbar = document.getElementById('toolbar');
    if (!title || !tabsEl || !toolbar) return;
    const h = title.offsetHeight + tabsEl.offsetHeight + toolbar.offsetHeight;
    SB.ipc.win.setChromeHeight(h);
    document.documentElement.style.setProperty('--chrome-h', h + 'px');
    SB.ipc.tab.layout();
  }
  SB.syncChromeHeight = syncChromeHeight;
  SB.renderTabs = renderTabs;
})();
