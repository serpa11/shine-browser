// =====================================================================
// Shine Browser — Shine split-screen panel
// Loads shineai-9mr.pages.dev natively beside your tabs, lets you drag
// the divider, and wires "Ask Shine about this" into its composer.
// =====================================================================
(function () {
  let view = null;
  let dragging = false;
  let maximized = false;

  function ensureView() {
    if (view) return view;
    const host = document.getElementById('shineHost');
    view = document.createElement('webview');
    view.setAttribute('partition', 'persist:shine-browser');
    view.setAttribute('allowpopups', '');
    view.setAttribute('webpreferences', 'contextIsolation=no');
    view.src = 'https://shineai-9mr.pages.dev';
    view.style.display = 'block';
    host.appendChild(view);

    view.addEventListener('dom-ready', () => {
      SB.ipc.tab.layout();
      // let the Shine page drive the browser
      view.executeJavaScript(BRIDGE_SCRIPT).catch(() => {});
    });

    view.addEventListener('ipc-message', (e) => {
      if (e.channel !== 'shine-command') return;
      const data = (e.args && e.args[0]) || {};
      handleCommand(data);
    });

    view.addEventListener('did-fail-load', (e) => {
      if (e.isMainFrame && e.errorCode !== -3) {
        SB.toast('Shine panel failed to load — check your connection.');
      }
    });
    return view;
  }

  const BRIDGE_SCRIPT = `
    (function(){
      if (window.__shineBridgeInstalled) return;
      window.__shineBridgeInstalled = true;

      // expose a clean API to the Shine page
      const api = {
        navigate: (u) => send('navigate', {url:u}),
        openUrl: (u) => send('open-url', {url:u}),
        search: (q) => send('search', {query:q}),
        newTab: (u) => send('new-tab', {url:u}),
        closeTab: () => send('close-tab'),
        reload: () => send('reload'),
        back: () => send('back'),
        forward: () => send('forward'),
        bookmark: () => send('bookmark'),
        openApp: (n) => send('open-app', {name:n}),
        listApps: () => send('list-apps'),
        sysInfo: () => send('sys-info'),
        processes: () => send('processes'),
        screenshot: () => send('screenshot'),
        listBookmarks: () => send('list-bookmarks'),
        listHistory: () => send('list-history'),
        listDownloads: () => send('list-downloads'),
        listExtensions: () => send('list-extensions'),
        openChromeWebStore: () => send('open-chrome-web-store'),
        togglePanel: (o) => send('toggle-panel', {open:o}),
      };
      function send(cmd, extra){
        try { window.ipcRenderer && window.ipcRenderer.sendToHost('shine-command', Object.assign({cmd}, extra||{})); } catch(e){}
      }
      try { Object.defineProperty(window, 'shineBrowser', {value: api, configurable:false}); } catch(e){ window.shineBrowser = api; }

      // main-process -> page replies
      window.__shineBridgeReceive = function(data){
        try { window.dispatchEvent(new CustomEvent('shine-browser-reply', {detail:data})); } catch(e){}
        if (typeof window.__shineOnBridgeReply === 'function') {
          try { window.__shineOnBridgeReply(data); } catch(e){}
        }
      };

      // main-process -> fill the Shine composer and send
      window.__shineFillPrompt = function(text, sendIt){
        const ta = document.querySelector('#prompt')
          || document.querySelector('textarea[placeholder*="Ask"]')
          || document.querySelector('textarea');
        if (!ta) return false;
        ta.focus();
        const proto = window.HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(ta, String(text));
        else ta.value = String(text);
        ta.dispatchEvent(new Event('input', {bubbles:true}));
        ta.dispatchEvent(new Event('change', {bubbles:true}));
        ta.style.height='auto';
        ta.style.height=Math.min(160, ta.scrollHeight)+'px';
        if (sendIt) setTimeout(()=>{ const b=document.getElementById('actionBtn')||document.querySelector('.controls-right button'); if(b) b.click(); }, 140);
        return true;
      };
    })();
  `;

  function handleCommand(cmd) {
    switch (cmd.cmd) {
      case 'navigate':
      case 'open-url': {
        const tab = SB.activeTab();
        if (tab) SB.loadTab(tab, cmd.url);
        SB.toast('Shine opened: ' + shortUrl(cmd.url));
        break;
      }
      case 'search': {
        const tab = SB.activeTab();
        if (tab) SB.loadTab(tab, 'https://www.google.com/search?q=' + encodeURIComponent(cmd.query || ''));
        break;
      }
      case 'new-tab':
        SB.createTab({ url: cmd.url || '' });
        break;
      case 'close-tab': {
        const t = SB.activeTab();
        if (t) SB.closeTab(t.id);
        break;
      }
      case 'reload': SB.reloadActive(); break;
      case 'back': SB.goActive('back'); break;
      case 'forward': SB.goActive('forward'); break;
      case 'bookmark': {
        const tab = SB.activeTab();
        if (tab && tab.url) {
          SB.ipc.bookmarks.add({ title: tab.title || tab.url, url: tab.url }).then(() => SB.refreshBookmarks());
          SB.toast('Saved to favorites ★');
        }
        break;
      }
      case 'toggle-panel':
        if (cmd.open === false) hide(); else if (cmd.open === true) show();
        break;
      case 'screenshot':
        SB.ipc.pc.screenshot().then((r) => SB.toast(r.ok ? 'Screenshot saved: ' + r.path : 'Screenshot failed'));
        break;
      case 'open-app':
      case 'launch-app':
        SB.ipc.pc.launch(cmd.name || cmd.app || '').then((r) => {
          SB.toast(r.ok ? `Opening ${r.name || cmd.name}…` : (r.error || 'App not found'));
        });
        break;
      case 'list-apps':
        SB.panels.open('panelPC');
        SB.panels.pc.load('apps');
        break;
      case 'sys-info':
        SB.panels.open('panelPC');
        SB.panels.pc.load('system');
        break;
      case 'processes':
        SB.panels.open('panelPC');
        SB.panels.pc.load('processes');
        break;
      case 'reveal':
        if (cmd.path) SB.ipc.pc.reveal(cmd.path);
        break;
      case 'list-bookmarks':
        SB.panels.open('panelFavorites');
        break;
      case 'list-history':
        SB.panels.open('panelHistory');
        break;
      case 'list-downloads':
        SB.panels.open('panelDownloads');
        break;
      case 'list-extensions':
        SB.panels.open('panelExtensions');
        break;
      case 'open-chrome-web-store': {
        const tab = SB.activeTab();
        if (tab) SB.loadTab(tab, 'https://chromewebstore.google.com/');
        break;
      }
      default:
        break;
    }
  }

  function shortUrl(u) {
    try { return new URL(u).hostname.replace('www.', ''); } catch (e) { return u; }
  }

  function show() {
    ensureView();
    const p = document.getElementById('shinePanel');
    p.classList.remove('hidden');
    document.getElementById('btnSplit').classList.add('active');
    document.getElementById('btnShine').classList.add('active');
    SB.panelOpen = true;
    SB.ipc.shine.setWidth(pct());
    SB.ipc.tab.layout();
    SB.ipc.settings.set({ panelOpen: true });
  }

  function hide() {
    document.getElementById('shinePanel').classList.add('hidden');
    document.getElementById('btnSplit').classList.remove('active');
    document.getElementById('btnShine').classList.remove('active');
    SB.panelOpen = false;
    SB.ipc.tab.layout();
    SB.ipc.settings.set({ panelOpen: false });
  }

  function toggle() {
    document.getElementById('shinePanel').classList.contains('hidden') ? show() : hide();
  }

  function pct() {
    const w = document.getElementById('shinePanel').offsetWidth;
    return Math.min(0.75, Math.max(0.25, w / window.innerWidth));
  }

  function initResize() {
    const grip = document.getElementById('shineResize');
    const panel = document.getElementById('shinePanel');

    grip.addEventListener('mousedown', (e) => {
      dragging = true;
      grip.classList.add('active');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = window.innerWidth - e.clientX;
      const min = 320;
      const max = window.innerWidth - 380;
      const width = Math.max(min, Math.min(max, w));
      panel.style.width = width + 'px';
      SB.ipc.tab.layout();
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      grip.classList.remove('active');
      SB.ipc.shine.setWidth(pct());
    });
  }

  function init() {
    initResize();

    document.getElementById('shineClose').addEventListener('click', hide);
    document.getElementById('shineMax').addEventListener('click', () => {
      const panel = document.getElementById('shinePanel');
      maximized = !maximized;
      panel.classList.toggle('max', maximized);
      if (maximized) panel.style.width = '';
      else panel.style.width = Math.round(pct() * 100) + '%';
      SB.ipc.tab.layout();
    });

    document.getElementById('btnSplit').addEventListener('click', toggle);
    document.getElementById('btnShine').addEventListener('click', () => {
      show();
      // focus the Shine composer via the bridge
      setTimeout(() => {
        if (view) {
          view.executeJavaScript(
            `window.__shineFillPrompt && window.__shineFillPrompt('', false);
             const ta=document.querySelector('#prompt'); if(ta) ta.focus();`
          ).catch(() => {});
        }
      }, 900);
    });
    document.getElementById('brandBtn').addEventListener('click', () => {
      const tab = SB.activeTab();
      if (tab) SB.loadTab(tab, 'shine://newtab');
    });
  }

  // react to main-process "shine:state" pushes
  SB.shine = {
    init,
    show,
    hide,
    toggle,
    get view() { return view; },
    isHidden: () => document.getElementById('shinePanel').classList.contains('hidden'),
  };
})();
