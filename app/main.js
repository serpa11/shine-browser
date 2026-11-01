// =====================================================================
// Shine Browser — main process
// Window, WebContentsView tabs, sessions, IPC, Shine split-screen panel.
// Tabs are managed ENTIRELY here as WebContentsView instances; the
// renderer is only the chrome (no <webview> tags), which avoids the
// element/View sync race that breaks navigation.
// =====================================================================
const { app, BrowserWindow, ipcMain, session, shell, dialog, Menu, WebContentsView } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const sysinfo = require('./sysinfo');
const installer = require('./installer');
const extensions = require('./extensions');
const downloads = require('./downloads');

const SHINE_URL = 'https://shineai-9mr.pages.dev';
const isWin = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let mainWindow = null;
let setupWindow = null;
let shineView = null;
let shineWidthRatio = 0.42;
let chromeHeight = 122;
const views = new Map();        // tabId -> { view, incognito }
const downloadsList = [];
let hiddenForSetup = false;

const USER_DATA = () => app.getPath('userData');
const ICON = path.join(__dirname, '..', 'build', 'icon.ico');
const PNG_ICON = path.join(__dirname, '..', 'build', 'icon.png');

function sessionOf(incognito) {
  return incognito
    ? session.fromPartition('persist:shine-incognito')
    : session.fromPartition('persist:shine-browser');
}

function browserSession() {
  return session.fromPartition('persist:shine-browser');
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    try { mainWindow.webContents.send(channel, payload); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function createWindow() {
  const saved = store.read('settings');
  const bounds = (() => {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(USER_DATA(), 'window-bounds.json'), 'utf8'));
      if (b && b.width > 500 && b.height > 400) return b;
    } catch (e) { /* first run */ }
    return { width: 1440, height: 900 };
  })();

  shineWidthRatio = saved.panelWidth || 0.42;

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 880,
    minHeight: 540,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webviewTag: false,      // tabs are WebContentsViews managed below
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', () => {
    try {
      const b = mainWindow.getBounds();
      fs.writeFileSync(path.join(USER_DATA(), 'window-bounds.json'), JSON.stringify(b));
      const s = store.read('settings');
      s.panelWidth = shineWidthRatio;
      store.write('settings', s);
    } catch (e) { /* ignore */ }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => {
    mainWindow.on(ev, () => layoutViews());
  });

  createShinePanel();
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getContentSize();
  const chrome = chromeHeight;

  const settings = store.read('settings');
  const panelOpen = !!settings.panelOpen;
  const panelW = panelOpen
    ? Math.round(Math.min(Math.max(w * shineWidthRatio, 320), Math.max(380, w - 380)))
    : 0;
  const contentW = Math.max(0, w - panelW);

  for (const [, entry] of views) {
    if (!entry.view || entry.view.webContents.isDestroyed()) continue;
    const active = !!entry.active;
    // Inactive tabs get zero-size bounds so a later-created tab can never
    // paint over the active one (child views stack in creation order).
    if (active) {
      entry.view.setBounds({ x: 0, y: chrome, width: contentW, height: Math.max(0, h - chrome) });
    } else {
      entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    try { entry.view.setVisible(active); } catch (e) { /* API not present */ }
  }

  if (shineView) {
    if (panelOpen) {
      shineView.setBounds({ x: w - panelW, y: chrome, width: panelW, height: Math.max(0, h - chrome) });
      shineView.setVisible(true);
    } else {
      shineView.setVisible(false);
    }
  }
}

// ---------------------------------------------------------------------------
// Every tab's WebContentsView is wired up here
// ---------------------------------------------------------------------------
function hookWebContents(wc, tabId, incognito) {
  wc.__shineTabId = tabId;
  wc.__shineIncognito = !!incognito;

  wc.on('did-start-loading', () => sendToRenderer('tab:loading', { tabId, loading: true }));
  // selection reported by the tab preload (tab-preload.js)
  wc.on('ipc-message', (event, channel, payload) => {
    if (channel === 'shine-selection') {
      sendToRenderer('tab:selection', { tabId, text: String(payload || '').trim() });
    }
  });
  wc.on('did-stop-loading', () => {
    sendToRenderer('tab:loading', { tabId, loading: false });
  });
  wc.on('page-title-updated', (e, title) => {
    const entry = views.get(tabId);
    const isNew = !!(entry && entry.isNewTab);
    sendToRenderer('tab:title', {
      tabId,
      title: isNew ? (entry.incognito ? 'Private' : 'New Tab') : title,
    });
  });
  wc.on('page-favicon-updated', (e, favicons) => {
    sendToRenderer('tab:favicon', { tabId, favicon: (favicons && favicons[0]) || '' });
  });

  const onNav = (url) => {
    const entry = views.get(tabId);
    if (entry && !/^data:text\/html/i.test(url)) entry.isNewTab = false;
    const isNew = !!(entry && entry.isNewTab);
    sendToRenderer('tab:navigate', { tabId, url: isNew ? 'shine://newtab' : url });
    if (!isNew) recordHistory(wc, url);
  };
  wc.on('did-navigate', (e, url) => onNav(url));
  wc.on('did-navigate-in-page', (e, url, isMainFrame) => { if (isMainFrame) onNav(url); });

  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) sendToRenderer('tab:fail', { tabId, code, desc, url });
  });

  wc.on('context-menu', (e, params) => {
    sendToRenderer('tab:context-menu', {
      tabId,
      x: params.x,
      y: params.y,
      selectionText: params.selectionText || '',
      isEditable: params.isEditable,
      linkURL: params.linkURL || '',
      mediaType: params.mediaType || '',
      srcURL: params.srcURL || '',
      misspelledWord: params.misspelledWord || '',
      editFlags: params.editFlags || {},
      pageURL: params.pageURL || '',
    });
  });

  wc.on('zoom-changed', (e, direction) => {
    const f = wc.getZoomFactor();
    const next = Math.min(3, Math.max(0.25, f + (direction === 'in' ? 0.1 : -0.1)));
    wc.setZoomFactor(next);
    sendToRenderer('tab:zoom', { tabId, zoomFactor: next });
  });

  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'foreground-tab' || disposition === 'new-window' || disposition === 'background-tab') {
      sendToRenderer('tab:open-external-tab', { url, incognito: !!incognito });
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    if (!/^https?:|^file:|^about:|^data:|^blob:/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  wc.on('render-process-gone', () => sendToRenderer('tab:crashed', { tabId }));

  // Keyboard accelerators are handled here (not in the chrome renderer)
  // so they keep working while a web page owns the focus. Copy/paste/undo
  // are deliberately left to the page.
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = String(input.key || '');
    const low = k.toLowerCase();
    const ctrl = input.control;
    const shift = input.shift;
    const alt = input.alt;
    let name = null;

    if (k === 'F5') name = 'reload';
    else if (k === 'F12') name = 'devtools';
    else if (alt && !ctrl && !shift) {
      if (k === 'ArrowLeft') name = 'back';
      else if (k === 'ArrowRight') name = 'forward';
      else if (low === 'd') name = 'focus-omnibox';
      else if (low === 'f') name = 'find';
    } else if (ctrl && !alt) {
      if (k === 'Tab') name = shift ? 'prev-tab' : 'next-tab';
      else if (shift && low === 't') name = 'new-tab';
      else if (shift && low === 'n') name = 'new-private';
      else if (shift && low === 's') name = 'toggle-shine';
      else if (shift && low === 'd') name = 'bookmark';
      else if (shift && low === 'f') name = 'find';
      else if (shift && low === 'p') name = 'print';
      else if (shift && low === 'b') name = 'favorites';
      else if (shift && low === 'j') name = 'downloads';
      else if (shift && low === 'h') name = 'history';
      else if (shift && low === 'r') name = 'reload-hard';
      else if (shift && low === 'i') name = 'devtools';
      else if (low === 't' || low === 'n') name = 'new-tab';
      else if (low === 'w') name = 'close-tab';
      else if (low === 'l') name = 'focus-omnibox';
      else if (low === 'r') name = 'reload';
      else if (low === 'f') name = 'find';
      else if (low === 'p') name = 'print';
      else if (low === 'd') name = 'bookmark';
      else if (low === 'h') name = 'history';
      else if (low === 'j') name = 'downloads';
      else if (low === 'b') name = 'favorites';
      else if (low === 's') name = 'save-page';
      else if (low === 'g') name = 'back';
      else if (low === 'y') name = 'forward';
      else if (k === '0') name = 'zoom-reset';
      else if (k === '=' || k === '+') name = 'zoom-in';
      else if (k === '-') name = 'zoom-out';
      else if (/^[1-9]$/.test(k)) name = 'tab-' + k;
    }

    if (name) {
      e.preventDefault();
      sendToRenderer('kb:shortcut', { name });
    }
  });
}

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------
function createTab(tabId, incognito, url) {
  const id = Number(tabId);
  if (views.has(id)) return;

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      partition: incognito ? 'persist:shine-incognito' : 'persist:shine-browser',
    },
  });
  view.setBackgroundColor('#ffffff');

  const entry = { view, incognito: !!incognito, active: false };
  views.set(id, entry);
  hookWebContents(view.webContents, id, incognito);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.addChildView(view);
  }
  layoutViews();

  if (url) loadURL(id, url);
}

function destroyTab(tabId) {
  const entry = views.get(Number(tabId));
  if (!entry) return;
  views.delete(Number(tabId));
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(entry.view);
  } catch (e) { /* ignore */ }
  try { entry.view.webContents.close(); } catch (e) { /* ignore */ }
  layoutViews();
}

function showTab(tabId) {
  const id = Number(tabId);
  for (const [tid, entry] of views) {
    entry.active = tid === id;
  }
  layoutViews();
}

function getView(tabId) {
  const entry = views.get(Number(tabId));
  return entry ? entry.view : null;
}

function getWC(tabId) {
  const entry = views.get(Number(tabId));
  if (!entry || entry.view.webContents.isDestroyed()) return null;
  return entry.view.webContents;
}

function loadURL(tabId, url) {
  const id = Number(tabId);
  const entry = views.get(id);
  const wc = entry ? entry.view.webContents : null;
  if (!wc || wc.isDestroyed()) return;
  const target = normalizeUrl(url);
  if (target.startsWith('shine://newtab')) {
    // Internal new-tab page: remember it so the chrome shows "New Tab"
    // instead of the underlying data: URL.
    entry.isNewTab = true;
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(newTabPageHTML(!!entry.incognito))).catch(() => {});
    return;
  }
  entry.isNewTab = false;
  wc.loadURL(target).catch(() => {});
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
function recordHistory(wc, url) {
  if (!url || !/^https?:/i.test(url)) return;
  const history = store.read('history');
  const last = history[0];
  const title = wc.getTitle() || url;
  if (last && last.url === url && Date.now() - (last.time || 0) < 60000) {
    last.title = title;
    last.time = Date.now();
    store.write('history', history);
    return;
  }
  store.add('history', { url, title, time: Date.now(), favicon: '' }, 8000);
}

// ---------------------------------------------------------------------------
// Shine split-screen panel
// ---------------------------------------------------------------------------
function createShinePanel() {
  if (shineView || !mainWindow) return;
  shineView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'shine-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      partition: 'persist:shine-browser',
    },
  });
  shineView.setBackgroundColor('#000000');
  mainWindow.contentView.addChildView(shineView);
  shineView.webContents.loadURL(SHINE_URL).catch(() => {});

  shineView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  shineView.webContents.ipc.on('shine-command', (event, payload) => {
    handleShineCommand(payload);
  });

  layoutViews();
}

function askShine(text, mode) {
  const s = store.read('settings');
  if (!s.panelOpen) {
    s.panelOpen = true;
    store.write('settings', s);
    createShinePanel();
    layoutViews();
    sendToRenderer('shine:state', { open: true });
  }
  const t = String(text || '').trim();
  if (!t) return;
  let prompt;
  if (mode === 'explain') prompt = `Explain this in simple terms:\n\n${t}`;
  else if (mode === 'improve') prompt = `Improve this writing:\n\n${t}`;
  else if (mode === 'translate') prompt = `Translate this to English:\n\n${t}`;
  else if (mode === 'summarize') prompt = `Summarize this:\n\n${t}`;
  else if (mode === 'rewrite') prompt = `Rewrite this more professionally:\n\n${t}`;
  else prompt = `I selected this text while browsing. Please help me with it:\n\n"""${t}"""`;

  const send = () => {
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents.executeJavaScript(
        `window.__shineFillPrompt && window.__shineFillPrompt(${JSON.stringify(prompt)}, true);`,
        true
      ).catch(() => {});
    }
  };
  if (shineView && shineView.webContents.isLoading()) {
    shineView.webContents.once('did-finish-load', () => setTimeout(send, 800));
  } else {
    setTimeout(send, 500);
  }
}

async function handleShineCommand(raw) {
  let cmd = raw;
  try { if (typeof raw === 'string') cmd = JSON.parse(raw); } catch (e) { return; }
  if (!cmd || typeof cmd !== 'object') return;

  const reply = (data) => {
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents.executeJavaScript(
        `window.__shineBridgeReceive && window.__shineBridgeReceive(${JSON.stringify(data)});`,
        true
      ).catch(() => {});
    }
  };

  try {
    switch (cmd.cmd) {
      case 'navigate':
      case 'open-url':
        sendToRenderer('shine:open-url', { url: normalizeUrl(cmd.url) });
        reply({ ok: true, action: 'open-url', url: cmd.url });
        break;
      case 'search':
        sendToRenderer('shine:search', { query: cmd.query || '' });
        reply({ ok: true, action: 'search' });
        break;
      case 'new-tab':
        sendToRenderer('shine:new-tab', { url: cmd.url ? normalizeUrl(cmd.url) : '' });
        reply({ ok: true, action: 'new-tab' });
        break;
      case 'close-tab':
        sendToRenderer('shine:close-tab', {});
        break;
      case 'toggle-panel': {
        const s = store.read('settings');
        s.panelOpen = cmd.open === undefined ? !s.panelOpen : !!cmd.open;
        store.write('settings', s);
        layoutViews();
        sendToRenderer('shine:state', { open: s.panelOpen });
        reply({ ok: true, action: 'toggle-panel', open: s.panelOpen });
        break;
      }
      case 'reload': sendToRenderer('shine:reload', {}); break;
      case 'back': sendToRenderer('shine:history-back', {}); break;
      case 'forward': sendToRenderer('shine:history-forward', {}); break;
      case 'bookmark': sendToRenderer('shine:bookmark-current', {}); break;
      case 'screenshot': {
        const r = await sysinfo.screenshot();
        reply(Object.assign({ action: 'screenshot' }, r));
        sendToRenderer('shine:toast', { text: r.ok ? 'Screenshot saved to ' + r.path : 'Screenshot failed' });
        break;
      }
      case 'open-app':
      case 'launch-app': {
        const r = await sysinfo.launchApp(cmd.name || cmd.app || '');
        reply(Object.assign({ action: 'open-app' }, r));
        break;
      }
      case 'list-apps': {
        const apps = await sysinfo.listApps(cmd.force);
        reply({ ok: true, action: 'list-apps', apps });
        break;
      }
      case 'sys-info': reply({ ok: true, action: 'sys-info', info: await sysinfo.sysInfo() }); break;
      case 'processes': reply({ ok: true, action: 'processes', processes: await sysinfo.processes() }); break;
      case 'reveal': reply(Object.assign({ action: 'reveal' }, await sysinfo.revealPath(cmd.path || ''))); break;
      case 'list-bookmarks': reply({ ok: true, action: 'list-bookmarks', bookmarks: store.read('bookmarks') }); break;
      case 'list-history': reply({ ok: true, action: 'list-history', history: store.read('history').slice(0, 200) }); break;
      case 'list-downloads': reply({ ok: true, action: 'list-downloads', downloads: downloadsList.slice(0, 50) }); break;
      case 'list-extensions': reply({ ok: true, action: 'list-extensions', extensions: store.read('extensions') }); break;
      case 'open-chrome-web-store':
        sendToRenderer('shine:open-url', { url: 'https://chromewebstore.google.com/' });
        reply({ ok: true });
        break;
      default:
        reply({ ok: false, error: 'Unknown command: ' + cmd.cmd });
    }
  } catch (e) {
    reply({ ok: false, error: String(e.message || e) });
  }
}

// ---------------------------------------------------------------------------
// URL / search
// ---------------------------------------------------------------------------
function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return 'shine://newtab';
  if (s === 'shine://newtab') return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s)) return 'http://' + s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s)) return 'https://' + s;
  return searchUrl(s);
}

function searchUrl(query) {
  const s = store.read('settings');
  const engines = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    brave: 'https://search.brave.com/search?q=',
    ecosia: 'https://www.ecosia.org/search?q=',
    startpage: 'https://www.startpage.com/sp/search?query=',
    youtube: 'https://www.youtube.com/results?search_query=',
  };
  return (engines[s.searchEngine] || engines.google) + encodeURIComponent(query);
}

// ---------------------------------------------------------------------------
// New tab page
// ---------------------------------------------------------------------------
function newTabPageHTML(incognito) {
  const tiles = [
    ['Google', 'https://www.google.com'],
    ['YouTube', 'https://www.youtube.com'],
    ['X', 'https://x.com'],
    ['Reddit', 'https://www.reddit.com'],
    ['GitHub', 'https://github.com'],
    ['Wikipedia', 'https://en.wikipedia.org'],
    ['Netflix', 'https://www.netflix.com'],
    ['Amazon', 'https://www.amazon.com'],
    ['Gmail', 'https://mail.google.com'],
    ['Maps', 'https://maps.google.com'],
    ['Twitch', 'https://www.twitch.tv'],
    ['Shine AI', 'https://shineai-9mr.pages.dev'],
  ];
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#000;color:#fff;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif;
min-height:100vh;display:flex;flex-direction:column;align-items:center;padding-top:13vh}
.logo{width:120px;height:auto;margin-bottom:26px;display:block}
h1{font-size:22px;font-weight:300;letter-spacing:-.02em;margin-bottom:30px;color:#fff;opacity:.85}
.search{width:min(560px,86vw);display:flex;align-items:center;gap:12px;padding:14px 20px;
border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(255,255,255,.04);
transition:border-color .2s}
.search:focus-within{border-color:rgba(255,255,255,.35)}
.search input{flex:1;background:transparent;border:none;outline:none;color:#fff;font:inherit;font-size:15px}
.search input::placeholder{color:rgba(255,255,255,.35)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:12px;
width:min(680px,90vw);margin-top:42px}
.tile{display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 10px;
border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.03);
color:rgba(255,255,255,.7);text-decoration:none;font-size:12px;cursor:pointer;
transition:all .25s cubic-bezier(.16,1,.3,1)}
.tile:hover{color:#fff;background:rgba(255,255,255,.08);transform:translateY(-3px);
border-color:rgba(255,255,255,.2)}
.avatar{width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.14);
display:grid;place-items:center;font-size:14px;font-weight:400;color:#fff}
footer{margin-top:auto;padding:26px;color:rgba(255,255,255,.3);font-size:11.5px}
</style></head><body>
<svg class="logo" viewBox="0 0 240 120"><text x="120" y="66" text-anchor="middle" fill="#fff"
 font-family="Inter,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="52" font-weight="300"
 letter-spacing="-1">Shine</text><text x="176" y="96" text-anchor="middle" fill="#fff"
 font-family="Inter,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="20" font-weight="300">Browser</text></svg>
<h1>${incognito ? 'Private browsing' : 'New Tab'}</h1>
<div class="search"><input id="q" placeholder="Search or enter website" autofocus /></div>
<div class="grid" id="grid"></div>
<footer>${incognito ? 'History is not saved in private tabs.' : 'Shine Browser'}</footer>
<script>
var tiles=${JSON.stringify(tiles)};
document.getElementById('grid').innerHTML=tiles.map(function(t){
  return '<a class="tile" href="'+t[1]+'"><div class="avatar">'+t[0].charAt(0)+'</div>'+t[0]+'</a>';
}).join('');
Array.prototype.forEach.call(document.querySelectorAll('.tile'),function(a){
  a.addEventListener('click',function(e){e.preventDefault();location.href=a.href;});
});
var q=document.getElementById('q');
q.addEventListener('keydown',function(e){
  if(e.key!=='Enter')return;
  var v=q.value.trim();if(!v)return;
  if(/^[a-z]+:\\/\\//i.test(v)||(/^[\\w-]+(\\.[\\w-]+)+(\\/.*)?$/i.test(v)&&v.indexOf(' ')<0))
    location.href=/^[a-z]+:\\/\\//i.test(v)?v:'https://'+v;
  else location.href='https://www.google.com/search?q='+encodeURIComponent(v);
});
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function setupIpc() {
  // --- window controls ---
  ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('win:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('win:close', () => mainWindow && mainWindow.close());
  ipcMain.handle('win:is-maximized', () => (mainWindow ? mainWindow.isMaximized() : false));
  ipcMain.on('win:set-chrome-height', (e, h) => {
    if (typeof h === 'number' && h > 0 && Math.abs(h - chromeHeight) > 1) {
      chromeHeight = h;
      layoutViews();
    }
  });

  // --- tabs (all managed here) ---
  ipcMain.on('tab:create', (e, { tabId, incognito, url }) => createTab(tabId, incognito, url));
  ipcMain.on('tab:destroy', (e, { tabId }) => destroyTab(tabId));
  ipcMain.on('tab:layout', () => layoutViews());
  ipcMain.on('tab:show', (e, { tabId }) => showTab(tabId));
  ipcMain.on('tab:load', (e, { tabId, url }) => loadURL(tabId, url));
  ipcMain.on('tab:op', (e, { tabId, op, arg }) => {
    const wc = getWC(tabId);
    if (!wc) return;
    try {
      switch (op) {
        case 'back': wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack(); break;
        case 'forward': wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward(); break;
        case 'reload': wc.reload(); break;
        case 'reload-hard': wc.reloadIgnoringCache(); break;
        case 'stop': wc.stop(); break;
        case 'zoom-in': wc.setZoomFactor(Math.min(3, wc.getZoomFactor() + 0.1)); break;
        case 'zoom-out': wc.setZoomFactor(Math.max(0.25, wc.getZoomFactor() - 0.1)); break;
        case 'zoom-reset': wc.setZoomFactor(1); break;
        case 'find': if (arg) wc.showFindInPage(arg); break;
        case 'find-stop': wc.stopFindInPage('clearSelection'); break;
        case 'undo': wc.executeJavaScript('document.execCommand("undo")', true).catch(() => {}); break;
        case 'redo': wc.executeJavaScript('document.execCommand("redo")', true).catch(() => {}); break;
        case 'cut': wc.executeJavaScript('document.execCommand("cut")', true).catch(() => {}); break;
        case 'copy': wc.executeJavaScript('document.execCommand("copy")', true).catch(() => {}); break;
        case 'paste': wc.executeJavaScript('document.execCommand("paste")', true).catch(() => {}); break;
        case 'select-all': wc.executeJavaScript('document.execCommand("selectAll")', true).catch(() => {}); break;
        case 'devtools': wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' }); break;
        case 'print': wc.print({ silent: false, printBackground: true }, () => {}); break;
        case 'save-page': {
          const win = BrowserWindow.fromWebContents(e.sender);
          dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), 'page.html') })
            .then(({ canceled, filePath }) => {
              if (!canceled && filePath) {
                wc.executeJavaScript('document.documentElement.outerHTML', true)
                  .then((html) => fs.writeFileSync(filePath, html)).catch(() => {});
              }
            });
          break;
        }
        case 'screenshot':
          sysinfo.screenshot().then((r) => sendToRenderer('shine:toast', { text: r.ok ? 'Screenshot saved: ' + r.path : 'Screenshot failed' }));
          break;
        case 'reading-mode':
          wc.executeJavaScript(`(function(){
            var els=document.querySelectorAll('script,style,nav,footer,aside,.ad,.ads,[id*="ad-"],[class*="ad-"]');
            for(var i=0;i<els.length;i++){els[i].parentNode&&els[i].parentNode.removeChild(els[i]);}
            var a=document.createElement('style');
            a.textContent='body{background:#000;color:#eee;max-width:760px;margin:40px auto;font-size:18px;line-height:1.7}';
            document.head.appendChild(a);return true;})()`, true).catch(() => {});
          break;
        case 'cast': sendToRenderer('shine:toast', { text: 'Cast: no Chromecast devices found on this network.' }); break;
        default: break;
      }
    } catch (err) { /* ignore */ }
  });

  ipcMain.handle('tab:info', (e, { tabId }) => {
    const wc = getWC(tabId);
    if (!wc) return null;
    const entry = views.get(Number(tabId));
    const isNew = !!(entry && entry.isNewTab);
    return {
      url: isNew ? 'shine://newtab' : wc.getURL(),
      title: isNew ? (entry.incognito ? 'Private' : 'New Tab') : wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      zoomFactor: wc.getZoomFactor(),
      isLoading: wc.isLoading(),
    };
  });

  ipcMain.handle('tab:selection', (e, { tabId }) => {
    const wc = getWC(tabId);
    if (!wc) return '';
    return wc.executeJavaScript('String(window.getSelection()||"")', true).catch(() => '');
  });

  // Rectangle of the current selection, in window DIP coordinates, so the
  // renderer can place the action pill right under the highlighted text.
  ipcMain.handle('tab:selectionRect', async (e, { tabId }) => {
    const wc = getWC(tabId);
    if (!wc) return null;
    try {
      const out = await wc.executeJavaScript(`(function(){
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || String(sel).trim() === '') return null;
        var r = sel.getRangeAt(0).getBoundingClientRect();
        if (!r || (r.width === 0 && r.height === 0)) return null;
        return { x: r.left, y: r.top, w: r.width, h: r.height,
                 scrollY: window.scrollY || 0, scrollX: window.scrollX || 0 };
      })()`, true);
      if (!out) return null;
      const zoom = wc.getZoomFactor() || 1;
      return {
        x: out.x / zoom,
        y: out.y / zoom,
        w: out.w / zoom,
        h: out.h / zoom,
      };
    } catch (err) {
      return null;
    }
  });

  ipcMain.handle('tab:page-text', (e, { tabId }) => {
    const wc = getWC(tabId);
    if (!wc) return '';
    return wc.executeJavaScript('document.body ? (document.body.innerText||"").slice(0,20000) : ""', true).catch(() => '');
  });

  // --- Shine panel ---
  ipcMain.on('shine:toggle', () => {
    const s = store.read('settings');
    s.panelOpen = !s.panelOpen;
    store.write('settings', s);
    if (s.panelOpen) createShinePanel();
    layoutViews();
    sendToRenderer('shine:state', { open: s.panelOpen });
  });
  ipcMain.handle('shine:is-open', () => !!store.read('settings').panelOpen);
  ipcMain.on('shine:set-width', (e, ratio) => {
    if (typeof ratio === 'number') {
      shineWidthRatio = Math.min(0.75, Math.max(0.25, ratio));
      const s = store.read('settings');
      s.panelWidth = shineWidthRatio;
      store.write('settings', s);
      layoutViews();
    }
  });
  ipcMain.on('shine:ask', (e, { text, mode }) => askShine(text, mode || 'selection'));
  ipcMain.on('shine:send', (e, { text }) => {
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents.executeJavaScript(
        `window.__shineFillPrompt && window.__shineFillPrompt(${JSON.stringify(String(text || ''))}, true);`,
        true
      ).catch(() => {});
    }
  });

  // --- bookmarks / history / downloads / extensions ---
  ipcMain.handle('bookmarks:list', () => store.read('bookmarks'));
  ipcMain.handle('bookmarks:add', (e, bm) => {
    const list = store.read('bookmarks');
    if (list.some((b) => b.url === bm.url)) return list;
    store.write('bookmarks', [{ id: Date.now(), title: bm.title || bm.url, url: bm.url, time: Date.now() }, ...list]);
    return store.read('bookmarks');
  });
  ipcMain.handle('bookmarks:remove', (e, id) => store.remove('bookmarks', (b) => b.id === id));
  ipcMain.handle('bookmarks:remove-all', () => { store.write('bookmarks', []); return []; });

  ipcMain.handle('history:list', () => store.read('history'));
  ipcMain.handle('history:remove', (e, time) => store.remove('history', (h) => h.time === time));
  ipcMain.handle('history:clear', () => { store.write('history', []); return []; });

  ipcMain.handle('downloads:list', () => downloadsList);
  ipcMain.handle('downloads:reveal', (e, p) => sysinfo.revealPath(p));

  ipcMain.handle('extensions:list', () => extensions.list());
  ipcMain.handle('extensions:load', async () => {
    const r = await extensions.loadUnpacked();
    layoutViews();
    return r;
  });
  ipcMain.handle('extensions:remove', async (e, id) => {
    const r = await extensions.remove(id);
    layoutViews();
    return r;
  });
  ipcMain.handle('extensions:toggle', (e, id) => extensions.toggle(id));

  // --- PC control ---
  ipcMain.handle('pc:apps', (e, force) => sysinfo.listApps(!!force));
  ipcMain.handle('pc:launch', (e, name) => sysinfo.launchApp(name));
  ipcMain.handle('pc:info', () => sysinfo.sysInfo());
  ipcMain.handle('pc:processes', () => sysinfo.processes());
  ipcMain.handle('pc:screenshot', () => sysinfo.screenshot());
  ipcMain.handle('pc:reveal', (e, p) => sysinfo.revealPath(p));
  ipcMain.handle('pc:open-path', (e, p) => {
    if (p && fs.existsSync(p)) { shell.openPath(p); return { ok: true }; }
    return { ok: false, error: 'Not found' };
  });

  // --- settings / app ---
  ipcMain.handle('settings:get', () => store.read('settings'));
  ipcMain.handle('settings:set', (e, patch) => {
    const s = Object.assign({}, store.read('settings'), patch || {});
    store.write('settings', s);
    shineWidthRatio = s.panelWidth || shineWidthRatio;
    layoutViews();
    return s;
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userData: app.getPath('userData'),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
  }));
  ipcMain.handle('app:open-external', (e, url) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return true; }
    return false;
  });
  ipcMain.handle('app:open-downloads', () => { shell.openPath(app.getPath('downloads')); return true; });

  // --- installer / setup ---
  ipcMain.handle('setup:status', () => installer.status());
  ipcMain.handle('setup:run', (e, opts) => installer.run(opts || {}));
  ipcMain.on('setup:open', () => openSetupWindow(true));
  ipcMain.on('setup:finish', () => finishSetup());
  ipcMain.on('app:quit', () => app.quit());
}

// ---------------------------------------------------------------------------
// Setup window (interactive installer)
// ---------------------------------------------------------------------------
function openSetupWindow(force) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 620,
    height: 620,
    minWidth: 520,
    minHeight: 520,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: '#000000',
    icon: ICON,
    show: false,
    parent: force ? null : null,
    webPreferences: {
      preload: path.join(__dirname, 'setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'setup.html'));
  setupWindow.once('ready-to-show', () => setupWindow.show());
  setupWindow.on('closed', () => { setupWindow = null; });
}

function finishSetup() {
  const s = store.read('settings');
  s.setupDone = true;
  s.firstRun = false;
  store.write('settings', s);
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  setupWindow = null;
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    layoutViews();
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setupIpc();
  extensions.init(browserSession());
  downloads.init(browserSession(), downloadsList, () => sendToRenderer('downloads:changed', downloadsList));

  const s = store.read('settings');
  createWindow();

  if (!s.setupDone) {
    hiddenForSetup = true;
    openSetupWindow(false);
  } else {
    mainWindow.show();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    const b = mainWindow && mainWindow.getBounds();
    if (b) fs.writeFileSync(path.join(USER_DATA(), 'window-bounds.json'), JSON.stringify(b));
  } catch (e) { /* ignore */ }
});
