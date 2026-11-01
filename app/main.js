// =====================================================================
// Shine Browser — main process
// Window, WebContentsView tabs, sessions, IPC, Shine split-screen panel.
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
let shineView = null;          // WebContentsView hosting shineai-9mr.pages.dev
let shineWidthRatio = 0.42;
let chromeHeight = 96;          // renderer communicates actual height
const views = new Map();        // tabId -> WebContentsView
const downloadsList = [];

const USER_DATA = () => app.getPath('userData');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

function sessionOf(incognito) {
  return incognito
    ? session.fromPartition('persist:shine-incognito')
    : session.fromPartition('persist:shine-browser');
}

function browserSession() {
  return session.fromPartition('persist:shine-browser');
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
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

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

  mainWindow.on('resize', () => layoutViews());
  mainWindow.on('maximize', () => layoutViews());
  mainWindow.on('unmaximize', () => layoutViews());
  mainWindow.on('enter-full-screen', () => layoutViews());
  mainWindow.on('leave-full-screen', () => layoutViews());

  createShinePanel();
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
  shineView.webContents.loadURL(SHINE_URL);

  shineView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Shine site -> browser commands (preload sends on 'shine-command')
  shineView.webContents.ipc.on('shine-command', (event, payload) => {
    handleShineCommand(payload);
  });

  shineView.webContents.on('did-finish-load', () => {
    shineView.webContents.executeJavaScript(
      `window.__shineBrowserAttached = true;` +
      `(function(){try{window.dispatchEvent(new CustomEvent('shine-browser-ready'))}catch(e){}})();`
    ).catch(() => {});
  });

  layoutViews();
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getContentSize();
  const chrome = chromeHeight;

  // Main web content area (left of the Shine panel when open).
  const settings = store.read('settings');
  const panelOpen = !!settings.panelOpen;
  const panelW = panelOpen ? Math.round(Math.min(Math.max(w * shineWidthRatio, 320), w - 380)) : 0;

  for (const [, view] of views) {
    view.setBounds({ x: 0, y: chrome, width: Math.max(0, w - panelW), height: Math.max(0, h - chrome) });
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
// Tab creation
// ---------------------------------------------------------------------------
function attachView(view, tabId, incognito) {
  view.webContents.__shineTabId = tabId;
  view.webContents.__shineIncognito = !!incognito;
  views.set(tabId, view);

  view.webContents.on('did-start-loading', () => {
    sendToRenderer('tab:loading', { tabId, loading: true });
  });
  view.webContents.on('did-stop-loading', () => {
    sendToRenderer('tab:loading', { tabId, loading: false });
  });
  view.webContents.on('page-title-updated', (e, title) => {
    sendToRenderer('tab:title', { tabId, title });
  });
  view.webContents.on('page-favicon-updated', (e, favicons) => {
    sendToRenderer('tab:favicon', { tabId, favicon: (favicons && favicons[0]) || '' });
  });
  view.webContents.on('did-navigate', (e, url) => {
    sendToRenderer('tab:navigate', { tabId, url });
    recordHistory(view, url);
  });
  view.webContents.on('did-navigate-in-page', (e, url, isMainFrame) => {
    if (isMainFrame) {
      sendToRenderer('tab:navigate', { tabId, url });
      recordHistory(view, url);
    }
  });
  view.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) sendToRenderer('tab:fail', { tabId, code, desc, url });
  });
  view.webContents.on('context-menu', (e, params) => {
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
  view.webContents.on('zoom-changed', (e, direction) => {
    const f = view.webContents.getZoomFactor();
    const next = Math.min(3, Math.max(0.25, f + (direction === 'in' ? 0.1 : -0.1)));
    view.webContents.setZoomFactor(next);
    sendToRenderer('tab:zoom', { tabId, zoomFactor: next });
  });

  view.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window' || disposition === 'foreground-tab') {
      sendToRenderer('tab:open-external-tab', { url, incognito: !!view.webContents.__shineIncognito });
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (e, url) => {
    if (!/^https?:|^file:|^about:|^data:|^blob:/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  view.webContents.on('render-process-gone', () => {
    sendToRenderer('tab:crashed', { tabId });
  });
}

function createTabView(tabId, incognito) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'webview-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      partition: incognito ? 'persist:shine-incognito' : 'persist:shine-browser',
      webviewTag: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  attachView(view, tabId, incognito);
  layoutViews();
  return view;
}

function getView(tabId) {
  return views.get(Number(tabId)) || views.get(tabId) || null;
}

// ---------------------------------------------------------------------------
// History recording
// ---------------------------------------------------------------------------
function recordHistory(view, url) {
  if (!url || !/^https?:/i.test(url)) return;
  const history = store.read('history');
  const last = history[0];
  const title = view.webContents.getTitle() || url;
  if (last && last.url === url && Date.now() - (last.time || 0) < 60000) {
    last.title = title;
    last.time = Date.now();
    store.write('history', history);
    return;
  }
  store.add('history', { url, title, time: Date.now(), favicon: '' }, 8000);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// Shine command bridge
// ---------------------------------------------------------------------------
async function handleShineCommand(raw) {
  let cmd = raw;
  try {
    if (typeof raw === 'string') cmd = JSON.parse(raw);
  } catch (e) { return; }
  if (!cmd || typeof cmd !== 'object') return;

  const reply = (data) => {
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents
        .executeJavaScript(`window.__shineBridgeReceive && window.__shineBridgeReceive(${JSON.stringify(data)});`)
        .catch(() => {});
    }
  };

  try {
    switch (cmd.cmd) {
      case 'navigate':
      case 'open-url': {
        sendToRenderer('shine:open-url', { url: normalizeUrl(cmd.url) });
        reply({ ok: true, action: 'open-url', url: cmd.url });
        break;
      }
      case 'search': {
        sendToRenderer('shine:search', { query: cmd.query || '' });
        reply({ ok: true, action: 'search', query: cmd.query });
        break;
      }
      case 'new-tab': {
        sendToRenderer('shine:new-tab', { url: cmd.url ? normalizeUrl(cmd.url) : '' });
        reply({ ok: true, action: 'new-tab' });
        break;
      }
      case 'close-tab': {
        sendToRenderer('shine:close-tab', {});
        reply({ ok: true, action: 'close-tab' });
        break;
      }
      case 'toggle-panel': {
        const s = store.read('settings');
        s.panelOpen = cmd.open === undefined ? !s.panelOpen : !!cmd.open;
        store.write('settings', s);
        layoutViews();
        reply({ ok: true, action: 'toggle-panel', open: s.panelOpen });
        break;
      }
      case 'reload': {
        sendToRenderer('shine:reload', {});
        reply({ ok: true, action: 'reload' });
        break;
      }
      case 'back': { sendToRenderer('shine:history-back', {}); reply({ ok: true }); break; }
      case 'forward': { sendToRenderer('shine:history-forward', {}); reply({ ok: true }); break; }
      case 'bookmark': { sendToRenderer('shine:bookmark-current', {}); reply({ ok: true }); break; }
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
      case 'sys-info': {
        const info = await sysinfo.sysInfo();
        reply({ ok: true, action: 'sys-info', info });
        break;
      }
      case 'processes': {
        const procs = await sysinfo.processes();
        reply({ ok: true, action: 'processes', processes: procs });
        break;
      }
      case 'reveal': {
        const r = await sysinfo.revealPath(cmd.path || '');
        reply(Object.assign({ action: 'reveal' }, r));
        break;
      }
      case 'list-bookmarks': {
        reply({ ok: true, action: 'list-bookmarks', bookmarks: store.read('bookmarks') });
        break;
      }
      case 'list-history': {
        reply({ ok: true, action: 'list-history', history: store.read('history').slice(0, 200) });
        break;
      }
      case 'list-downloads': {
        reply({ ok: true, action: 'list-downloads', downloads: downloadsList.slice(0, 50) });
        break;
      }
      case 'list-extensions': {
        reply({ ok: true, action: 'list-extensions', extensions: store.read('extensions') });
        break;
      }
      case 'open-chrome-web-store': {
        sendToRenderer('shine:open-url', { url: 'https://chromewebstore.google.com/' });
        reply({ ok: true, action: 'open-chrome-web-store' });
        break;
      }
      default:
        reply({ ok: false, error: 'Unknown command: ' + cmd.cmd });
    }
  } catch (e) {
    reply({ ok: false, error: String(e.message || e) });
  }
}

function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return 'https://' + s;
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
  const base = engines[s.searchEngine] || engines.google;
  return base + encodeURIComponent(query);
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

  // --- tabs ---
  ipcMain.on('tab:create', (e, { tabId, incognito }) => {
    const id = Number(tabId);
    if (views.has(id)) return;
    createTabView(id, incognito);
  });
  ipcMain.on('tab:destroy', (e, { tabId }) => {
    const view = getView(tabId);
    if (!view) return;
    views.delete(Number(tabId));
    try { view.webContents.close(); } catch (err) { /* ignore */ }
    layoutViews();
  });
  ipcMain.on('tab:layout', () => layoutViews());
  ipcMain.on('tab:show', (e, { tabId }) => {
    const view = getView(tabId);
    if (view) layoutViews();
  });
  ipcMain.on('tab:load', (e, { tabId, url }) => {
    const view = getView(tabId);
    if (!view) return;
    const target = normalizeUrl(url);
    view.webContents.loadURL(target);
  });
  ipcMain.on('tab:op', (e, { tabId, op, arg }) => {
    const view = getView(tabId);
    if (!view || view.webContents.isDestroyed()) return;
    const wc = view.webContents;
    try {
      switch (op) {
        case 'back': wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack(); break;
        case 'forward': wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward(); break;
        case 'reload': wc.reload(); break;
        case 'stop': wc.stop(); break;
        case 'reload-hard': wc.reloadIgnoringCache(); break;
        case 'zoom-in': wc.setZoomFactor(Math.min(3, wc.getZoomFactor() + 0.1)); sendToRenderer('tab:zoom', { tabId, zoomFactor: wc.getZoomFactor() }); break;
        case 'zoom-out': wc.setZoomFactor(Math.max(0.25, wc.getZoomFactor() - 0.1)); sendToRenderer('tab:zoom', { tabId, zoomFactor: wc.getZoomFactor() }); break;
        case 'zoom-reset': wc.setZoomFactor(1); sendToRenderer('tab:zoom', { tabId, zoomFactor: 1 }); break;
        case 'find': if (arg) wc.showFindInPage(arg); break;
        case 'find-stop': wc.stopFindInPage('clearSelection'); break;
        case 'devtools': wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' }); break;
        case 'print': wc.print({ silent: false, printBackground: true }, () => {}); break;
        case 'save-page': {
          const win = BrowserWindow.fromWebContents(e.sender);
          dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), 'page.html') }).then(({ canceled, filePath }) => {
            if (!canceled && filePath) {
              wc.executeJavaScript('document.documentElement.outerHTML').then((html) => fs.writeFileSync(filePath, html));
            }
          });
          break;
        }
        case 'cast': sendToRenderer('shine:toast', { text: 'Cast: no Chromecast devices found on this network.' }); break;
        case 'task-manager': sendToRenderer('shine:open-url', { url: 'about:blank' }); break;
        case 'screenshot': sysinfo.screenshot().then((r) => sendToRenderer('shine:toast', { text: r.ok ? 'Screenshot saved: ' + r.path : 'Screenshot failed' })); break;
        case 'reading-mode': {
          wc.executeJavaScript(`(function(){
            document.querySelectorAll('script,style,nav,footer,aside,.ad,.ads,[id*=ad-],[class*=ad-]').forEach(n=>n.remove());
            const a=document.createElement('style');
            a.textContent='body{background:#000;color:#eee;max-width:760px;margin:40px auto;font-size:18px;line-height:1.7}';
            document.head.appendChild(a);return true;})()`).catch(() => {});
          break;
        }
        default: break;
      }
    } catch (err) { /* ignore */ }
  });
  ipcMain.handle('tab:info', (e, { tabId }) => {
    const view = getView(tabId);
    if (!view || view.webContents.isDestroyed()) return null;
    return {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
      zoomFactor: view.webContents.getZoomFactor(),
      isLoading: view.webContents.isLoading(),
    };
  });
  ipcMain.handle('tab:selection', async (e, { tabId }) => {
    const view = getView(tabId);
    if (!view || view.webContents.isDestroyed()) return '';
    try {
      return await view.webContents.executeJavaScript('String(window.getSelection()||"")');
    } catch (err) { return ''; }
  });
  ipcMain.handle('tab:page-text', async (e, { tabId }) => {
    const view = getView(tabId);
    if (!view || view.webContents.isDestroyed()) return '';
    try {
      return await view.webContents.executeJavaScript(
        `document.body ? (document.body.innerText||'').slice(0, 20000) : ''`
      );
    } catch (err) { return ''; }
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
  ipcMain.on('shine:ask', (e, { text, mode }) => {
    askShine(text, mode || 'selection');
  });
  ipcMain.on('shine:send', (e, { text }) => {
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents.executeJavaScript(
        `window.__shineFillPrompt && window.__shineFillPrompt(${JSON.stringify(String(text || ''))}, true);`
      ).catch(() => {});
    }
  });
  ipcMain.handle('shine:ready', () => {
    createShinePanel();
    return true;
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
    if (p && fs.existsSync(p)) {
      shell.openPath(p);
      return { ok: true };
    }
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
  }));
  ipcMain.handle('app:open-external', (e, url) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return true; }
    return false;
  });
  ipcMain.handle('app:open-downloads', () => { shell.openPath(app.getPath('downloads')); return true; });

  // --- installer / shortcuts ---
  ipcMain.handle('setup:status', () => installer.status());
  ipcMain.handle('setup:run', (e, opts) => installer.run(opts || {}));

  // --- webview selection text fetch ---
  ipcMain.handle('shine:page-selection', async () => {
    if (!shineView || shineView.webContents.isDestroyed()) return '';
    try {
      return await shineView.webContents.executeJavaScript('String(window.getSelection()||"")');
    } catch (e) { return ''; }
  });
}

// Ask Shine about selected text --------------------------------------------
function askShine(text, mode) {
  if (!shineView || shineView.webContents.isDestroyed()) return;
  const s = store.read('settings');
  if (!s.panelOpen) {
    s.panelOpen = true;
    store.write('settings', s);
    createShinePanel();
    layoutViews();
    sendToRenderer('shine:state', { open: true });
  }
  let prompt = '';
  const t = String(text || '').trim();
  if (mode === 'explain') prompt = `Explain this in simple terms:\n\n${t}`;
  else if (mode === 'improve') prompt = `Improve this writing:\n\n${t}`;
  else if (mode === 'translate') prompt = `Translate this to English:\n\n${t}`;
  else if (mode === 'summarize') prompt = `Summarize this:\n\n${t}`;
  else if (mode === 'rewrite') prompt = `Rewrite this more professionally:\n\n${t}`;
  else prompt = `I selected this text while browsing. Ask Shine about it:\n\n"""${t}"""`;

  setTimeout(() => {
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents.executeJavaScript(
        `window.__shineFillPrompt && window.__shineFillPrompt(${JSON.stringify(prompt)}, true);`
      ).catch(() => {});
    }
  }, 600);
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
  if (s.firstRun) {
    // Auto-create shortcuts on first launch (the setup window drives the rest).
    installer.ensureShortcuts().catch(() => {});
  }

  createWindow();

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
