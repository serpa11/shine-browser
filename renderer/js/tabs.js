// =====================================================================
// Shine Browser — tab engine
// Each tab owns a <webview> that is rendered natively by the main
// process (WebContentsView), so we get full Chromium compatibility.
// =====================================================================
(function () {
  const webArea = () => document.getElementById('webArea');

  SB.createTab = function (opts) {
    opts = opts || {};
    const id = SB.nextTabId++;
    const incognito = !!opts.incognito;

    const view = document.createElement('webview');
    view.setAttribute('partition', incognito ? 'persist:shine-incognito' : 'persist:shine-browser');
    view.setAttribute('allowpopups', '');
    view.setAttribute('webpreferences', 'contextIsolation=no');
    view.setAttribute('webpreferences', 'contextIsolation=yes');
    view.style.display = 'none';
    view.dataset.tabId = String(id);
    webArea().appendChild(view);

    const tab = {
      id,
      view,
      incognito,
      url: '',
      title: incognito ? 'Private' : 'New Tab',
      favicon: '',
      loading: false,
      zoomFactor: 1,
      historyStack: [],
      historyIndex: -1,
    };
    SB.tabs.push(tab);

    // main process learns about the tab -> creates the native WebContentsView
    SB.ipc.tab.create(id, incognito);

    bindView(tab);
    renderTabs();
    SB.activateTab(id);

    if (opts.url) SB.loadTab(tab, opts.url);
    else SB.loadTab(tab, 'shine://newtab');

    return tab;
  };

  function bindView(tab) {
    const v = tab.view;

    v.addEventListener('dom-ready', () => {
      SB.ipc.tab.layout();
      // inject selection detection into the page
      v.executeJavaScript(SELECTION_SCRIPT).catch(() => {});
    });

    v.addEventListener('ipc-message', (e) => {
      const { channel, args } = e;
      const data = (args && args[0]) || {};
      if (channel === 'selection') {
        onSelection(tab, data);
      } else if (channel === 'copied') {
        /* handled natively */
      }
    });

    v.addEventListener('did-start-loading', () => {
      tab.loading = true;
      renderTabs();
    });
    v.addEventListener('did-stop-loading', () => {
      tab.loading = false;
      renderTabs();
      SB.ipc.tab.info(tab.id).then((info) => {
        if (info) {
          tab.url = info.url || tab.url;
          tab.zoomFactor = info.zoomFactor;
          SB.omnibox && SB.omnibox.syncFromTab(tab);
          SB.updateBookmarkStar();
          renderTabs();
        }
      });
    });
    v.addEventListener('did-navigate', (e) => {
      tab.url = e.url;
      pushHistory(tab, e.url);
      SB.omnibox && SB.omnibox.syncFromTab(tab);
      SB.updateBookmarkStar();
      renderTabs();
      v.executeJavaScript(SELECTION_SCRIPT).catch(() => {});
    });
    v.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        tab.url = e.url;
        SB.omnibox && SB.omnibox.syncFromTab(tab);
        SB.updateBookmarkStar();
      }
    });
    v.addEventListener('page-title-updated', (e) => {
      tab.title = e.title || tab.url;
      renderTabs();
    });
    v.addEventListener('page-favicon-updated', (e) => {
      tab.favicon = (e.favicons && e.favicons[0]) || '';
      renderTabs();
    });
    v.addEventListener('new-window', (e) => {
      if (e.disposition === 'foreground-tab' || e.disposition === 'new-window') {
        e.preventDefault();
        SB.createTab({ url: e.url, incognito: tab.incognito });
      }
    });
    v.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3 || !e.isMainFrame) return;
      tab.title = 'Error';
      renderTabs();
      SB.toast(`Couldn't load page (${e.errorCode})`);
    });
    v.addEventListener('enter-html-full-screen', () => {
      document.body.classList.add('fullscreen-video');
    });
    v.addEventListener('leave-html-full-screen', () => {
      document.body.classList.remove('fullscreen-video');
    });
  }

  const SELECTION_SCRIPT = `
    (function(){
      if (window.__shineSelBound) return;
      window.__shineSelBound = true;
      const post = (text) => {
        try { window.ipcRenderer.sendToHost('selection', { text: text }); } catch (e) {}
      };
      document.addEventListener('mouseup', () => {
        setTimeout(() => {
          const s = String(window.getSelection() || '').trim();
          post(s);
        }, 10);
      }, true);
      document.addEventListener('keyup', (e) => {
        if ((e.ctrlKey||e.metaKey) && e.key === 'c') {
          const s = String(window.getSelection() || '').trim();
          if (s) post(s);
        }
      }, true);
    })();
  `;

  function pushHistory(tab, url) {
    if (!/^https?:/i.test(url)) return;
    if (tab.historyStack[tab.historyIndex] === url) return;
    tab.historyStack = tab.historyStack.slice(0, tab.historyIndex + 1);
    tab.historyStack.push(url);
    tab.historyIndex = tab.historyStack.length - 1;
  }

  function onSelection(tab, data) {
    SB.selection.text = data.text || '';
    if (!SB.selection.text) {
      SB.hide('#selectionBar');
      return;
    }
    // position near the caret using a temporary range marker
    const sel = window.getSelection();
    let rect = null;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      rect = { x: r.left, y: r.bottom, w: r.width, h: r.height };
    }
    SB.selection.rect = rect;
    if (SB.selectionBar) SB.selectionBar.show(rect, SB.selection.text, tab);
  }

  SB.activateTab = function (id) {
    const tab = SB.tabs.find((t) => t.id === id);
    if (!tab) return;
    SB.activeTabId = id;
    SB.tabs.forEach((t) => {
      t.view.style.display = t.id === id ? 'block' : 'none';
    });
    SB.ipc.tab.show(id);
    SB.ipc.tab.layout();
    renderTabs();
    SB.omnibox && SB.omnibox.syncFromTab(tab);
    SB.updateBookmarkStar();
  };

  SB.activeTab = function () {
    return SB.tabs.find((t) => t.id === SB.activeTabId) || null;
  };

  SB.closeTab = function (id) {
    const idx = SB.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = SB.tabs[idx];
    try { tab.view.remove(); } catch (e) { /* ignore */ }
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
    if (!tab) return;
    if (url === 'shine://newtab') {
      tab.url = 'shine://newtab';
      tab.title = tab.incognito ? 'Private' : 'New Tab';
      renderTabs();
      SB.omnibox && SB.omnibox.syncFromTab(tab);
      // render the new-tab page inside the webview
      try {
        tab.view.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(newTabPage(tab)));
      } catch (e) { /* ignore */ }
      return;
    }
    tab.view.loadURL(url);
  };

  SB.reloadActive = function () {
    const t = SB.activeTab();
    if (t) SB.ipc.tab.op(t.id, 'reload');
  };

  SB.goActive = function (op) {
    const t = SB.activeTab();
    if (t) SB.ipc.tab.op(t.id, op);
  };

  // ---- tab strip rendering ----------------------------------------------
  function renderTabs() {
    const strip = document.getElementById('tabs');
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
        img.onerror = () => { img.replaceWith(fallback()); };
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
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) SB.closeTab(tab.id);
      });
      strip.appendChild(el);
    });

    // keep active tab in view
    const activeEl = strip.querySelector('.tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    const chromeH = document.getElementById('titleBar').offsetHeight +
      document.getElementById('tabStrip').offsetHeight +
      document.getElementById('toolbar').offsetHeight;
    SB.ipc.win.setChromeHeight(chromeH);
    document.documentElement.style.setProperty('--chrome-h', chromeH + 'px');
    SB.ipc.tab.layout();
  }

  SB.renderTabs = renderTabs;

  // ---- new tab page ------------------------------------------------------
  function newTabPage(tab) {
    const tiles = [
      ['Google', 'https://www.google.com'],
      ['YouTube', 'https://www.youtube.com'],
      ['X', 'https://x.com'],
      ['Reddit', 'https://www.reddit.com'],
      ['GitHub', 'https://github.com'],
      ['Wikipedia', 'https://www.wikipedia.org'],
      ['Netflix', 'https://www.netflix.com'],
      ['Amazon', 'https://www.amazon.com'],
      ['Gmail', 'https://mail.google.com'],
      ['Maps', 'https://maps.google.com'],
      ['Twitch', 'https://www.twitch.tv'],
      ['Shine AI', 'https://shineai-9mr.pages.dev'],
    ];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#000;color:#fff;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif;
min-height:100vh;display:flex;flex-direction:column;align-items:center;padding-top:14vh}
.logo{width:54px;height:54px;fill:#fff;margin-bottom:26px;animation:glow 3s ease-in-out infinite}
@keyframes glow{0%,100%{filter:drop-shadow(0 0 6px rgba(255,255,255,.25))}50%{filter:drop-shadow(0 0 24px rgba(255,255,255,.75))}}
h1{font-size:24px;font-weight:400;letter-spacing:-.02em;margin-bottom:28px;color:#fff}
.search{width:min(560px,86vw);display:flex;align-items:center;gap:10px;padding:13px 18px;
border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.045);
backdrop-filter:blur(18px);transition:border-color .15s}
.search:focus-within{border-color:rgba(255,255,255,.3)}
.search input{flex:1;background:transparent;border:none;outline:none;color:#fff;font:inherit;font-size:15px}
.search input::placeholder{color:rgba(255,255,255,.32)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;
width:min(680px,90vw);margin-top:44px}
.tile{display:flex;flex-direction:column;align-items:center;gap:9px;padding:18px 10px;
border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.03);
color:rgba(255,255,255,.7);text-decoration:none;font-size:12px;cursor:pointer;
transition:all .25s cubic-bezier(.16,1,.3,1)}
.tile:hover{color:#fff;background:rgba(255,255,255,.08);transform:translateY(-3px);
border-color:rgba(255,255,255,.2)}
.avatar{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.1);
display:grid;place-items:center;font-size:14px;font-weight:500;color:#fff}
footer{margin-top:auto;padding:26px;color:rgba(255,255,255,.28);font-size:11.5px}
</style></head><body>
<svg class="logo" viewBox="0 0 24 24"><path d="M12 2c.6 4.6 5.4 9.4 10 10-4.6.6-9.4 5.4-10 10-.6-4.6-5.4-9.4-10-10 4.6-.6 9.4-5.4 10-10Z"/></svg>
<h1>${tab.incognito ? 'Private browsing' : 'New Tab'}</h1>
<div class="search"><input id="q" placeholder="Search or enter website" autofocus /></div>
<div class="grid" id="grid"></div>
<footer>${tab.incognito ? 'History is not saved in private tabs.' : 'Shine Browser — browse with Shine AI side by side.'}</footer>
<script>
const tiles=${JSON.stringify(tiles)};
document.getElementById('grid').innerHTML=tiles.map(t=>
  \`<a class="tile" href="\${t[1]}"><div class="avatar">\${t[0][0]}</div>\${t[0]}</a>\`).join('');
document.querySelectorAll('.tile').forEach(a=>a.addEventListener('click',e=>{
  e.preventDefault();location.href=a.href;}));
const q=document.getElementById('q');
q.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  const v=q.value.trim();if(!v)return;
  if(/^[a-z]+:\\/\\//i.test(v)||/^[\\w-]+(\\.[\\w-]+)+(\\/.*)?$/i.test(v)&&!v.includes(' '))
    location.href=/^[a-z]+:\\/\\//i.test(v)?v:'https://'+v;
  else location.href='https://www.google.com/search?q='+encodeURIComponent(v);
});
</script></body></html>`;
    return html;
  }
})();
