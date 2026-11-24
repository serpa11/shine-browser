// =====================================================================
// Shine Browser — main process
// Window, WebContentsView tabs, sessions, IPC, Shine split-screen panel.
// Tabs are managed ENTIRELY here as WebContentsView instances; the
// renderer is only the chrome (no <webview> tags), which avoids the
// element/View sync race that breaks navigation.
// =====================================================================
const { app, BrowserWindow, ipcMain, session, shell, dialog, Menu, WebContentsView, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const sysinfo = require('./sysinfo');
const installer = require('./installer');
const extensions = require('./extensions');
const downloads = require('./downloads');

const SHINE_URL = 'https://shineai-9mr.pages.dev';
const isWin = process.platform === 'win32';

// Internal pages (new tab, wallpaper) are served over shine://
try {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'shine',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
} catch (e) { /* already registered */ }

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
let overlayView = null;           // transparent overlay view — ALWAYS topmost
let shineWidthRatio = 0.42;
let chromeHeight = 122;
let sidePanelWidth = 0;           // width of open side panel
const views = new Map();          // tabId -> { view, incognito, active }
const downloadsList = [];
let hiddenForSetup = false;

// Overlay state (floating UI drawn by overlay.html)
let overlayReady = false;
let overlaySeq = 0;
let overlayCurrent = null;
let overlayLast = null;           // { seq, place, w, h }
let overlayQueue = [];

let wallpaperCache = { path: null, css: null };

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
      webviewTag: false,
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
  createOverlayView();          // overlay created BEFORE any tabs — always topmost
}

// ---------------------------------------------------------------------------
// Layout — tab views shrink to make room for panels
// ---------------------------------------------------------------------------
function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getContentSize();
  const chrome = chromeHeight;

  const settings = store.read('settings');
  const panelOpen = !!settings.panelOpen;
  const panelMax = !!settings.panelMax;
  const sideW = sidePanelWidth;

  let shineW = 0;
  if (panelOpen) {
    const avail = Math.max(0, w - sideW);
    shineW = panelMax
      ? avail
      : Math.round(Math.min(Math.max(w * shineWidthRatio, 320), Math.max(380, w - 380)));
    if (shineW > avail) shineW = avail;
  }
  const contentW = Math.max(0, w - sideW - shineW);

  for (const [, entry] of views) {
    if (!entry.view || entry.view.webContents.isDestroyed()) continue;
    const active = !!entry.active;
    if (active) {
      entry.view.setBounds({ x: 0, y: chrome, width: contentW, height: Math.max(0, h - chrome) });
    } else {
      entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    try { entry.view.setVisible(active); } catch (e) { /* API not present */ }
  }

  if (shineView) {
    if (panelOpen) {
      const headH = 34;
      shineView.setBounds({
        x: contentW,
        y: chrome + headH,
        width: shineW,
        height: Math.max(0, h - chrome - headH),
      });
      try { shineView.setVisible(true); } catch (e) { /* ignore */ }
    } else {
      try { shineView.setVisible(false); } catch (e) { /* ignore */ }
    }
  }

  raiseOverlay();
  positionOverlay(w, h);

  sendToRenderer('layout:views', {
    sideW, shineW, contentW, open: panelOpen, max: panelMax, w, h, chrome,
  });
}

// ---------------------------------------------------------------------------
// Overlay view — transparent, full-window, always on top of tabs
// Hosts: selection pill, menus, toasts, download checker, settings
// ---------------------------------------------------------------------------
function createOverlayView() {
  if (overlayView || !mainWindow || mainWindow.isDestroyed()) return overlayView;
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  try { overlayView.setBackgroundColor('#00000000'); } catch (e) { /* ignore */ }
  mainWindow.contentView.addChildView(overlayView);
  try { overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (e) { /* ignore */ }
  try { overlayView.setVisible(false); } catch (e) { /* ignore */ }

  const ov = overlayView.webContents;
  ov.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html')).catch(() => {});
  ov.on('did-finish-load', () => {
    overlayReady = true;
    const q = overlayQueue;
    overlayQueue = [];
    q.forEach((job) => showOverlay(job.widget, job.place, job.data));
  });
  ov.ipc.on('overlay:measured', (e, m) => onOverlayMeasured(m || {}));
  ov.ipc.on('overlay:action', (e, p) => {
    sendToRenderer('overlay:action', p || {});
    refocusActiveTab();
  });
  ov.ipc.on('overlay:dismiss', () => {
    hideOverlay();
    sendToRenderer('overlay:dismiss', {});
  });
  ov.setWindowOpenHandler(() => ({ action: 'deny' }));
  return overlayView;
}

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
    // Handle Shine AI commands from the panel
    console.log('[shine] command:', payload);
  });

  return shineView;
}

function ensureOverlay() {
  return overlayView;
}

// Child views stack in creation order, so a freshly created tab would cover
// the overlay. Re-adding it moves it back to the top.
function raiseOverlay() {
  if (!overlayView || !mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.contentView.addChildView(overlayView); } catch (e) { /* ignore */ }
}

function refocusActiveTab() {
  for (const [, entry] of views) {
    if (entry.active && entry.view && !entry.view.webContents.isDestroyed()) {
      try { entry.view.webContents.focus(); } catch (e) { /* ignore */ }
      return;
    }
  }
}

function showOverlay(widget, place, data) {
  if (!widget) return;
  if (!overlayReady) {
    overlayQueue.push({ widget, place, data });
    createOverlayView();
    return;
  }
  createOverlayView();
  overlaySeq += 1;
  overlayCurrent = widget;
  overlayLast = { seq: overlaySeq, place: place || {}, w: 0, h: 0 };
  try { overlayView.setVisible(true); } catch (e) { /* ignore */ }
  raiseOverlay();
  // Full-window bounds so the overlay never misses clicks
  const [w, h] = mainWindow.getContentSize();
  try { overlayView.setBounds({ x: 0, y: 0, width: w, height: h }); } catch (e) { /* ignore */ }
  overlayView.webContents.send('overlay:render', {
    seq: overlaySeq, widget, place: place || {}, data: data || {},
  });
}

function onOverlayMeasured(m) {
  if (!overlayLast || m.seq !== overlayLast.seq) return;
  overlayLast.w = Math.max(0, Number(m.w) || 0);
  overlayLast.h = Math.max(0, Number(m.h) || 0);
  positionOverlay();
}

function hideOverlay(widget) {
  if (widget && overlayCurrent !== widget) return;
  overlayCurrent = null;
  overlayLast = null;
  if (!overlayView) return;
  try { overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (e) { /* ignore */ }
  try { overlayView.setVisible(false); } catch (e) { /* ignore */ }
}

const OVERLAY_PAD = 14;

function positionOverlay(winW, winH) {
  if (!overlayView || !overlayLast || !overlayReady) return;
  const size = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getContentSize()
    : [winW || 0, winH || 0];
  const w = size[0];
  const h = size[1];
  const place = overlayLast.place || {};
  const gw = overlayLast.w + OVERLAY_PAD * 2;
  const gh = overlayLast.h + OVERLAY_PAD * 2;

  if ((place.mode || 'xy') === 'cx-above' && place.alt && (place.y - gh) < (chromeHeight + 6)) {
    return positionOverlayAt(place.alt, gw, gh, w, h);
  }
  return positionOverlayAt(place, gw, gh, w, h);
}

function positionOverlayAt(place, gw, gh, winW, winH) {
  const mode = place.mode || 'xy';
  let vx = 0;
  let vy = 0;
  switch (mode) {
    case 'cx': vx = place.cx - gw / 2; vy = place.y; break;
    case 'cx-above': vx = place.cx - gw / 2; vy = place.y - gh; break;
    case 'r': vx = place.r - gw; vy = place.y; break;
    case 'bottom-center': vx = (winW - gw) / 2; vy = winH - gh - (place.inset || 28); break;
    case 'xy':
    default:
      vx = place.x || 0;
      vy = place.y || 0;
      break;
  }
  const minY = (mode === 'cx' || mode === 'cx-above') ? chromeHeight + 6 : 4;
  vx = Math.max(4, Math.min(winW - gw - 4, vx));
  vy = Math.max(minY, Math.min(winH - gh - 4, vy));
  try {
    overlayView.setBounds({ x: Math.round(vx), y: Math.round(vy), width: Math.round(gw), height: Math.round(gh) });
    overlayView.webContents.send('overlay:place', { x: OVERLAY_PAD, y: OVERLAY_PAD });
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Every tab's WebContentsView is wired up here
// ---------------------------------------------------------------------------
function hookWebContents(wc, tabId, incognito) {
  wc.__shineTabId = tabId;
  wc.__shineIncognito = !!incognito;

  wc.on('did-start-loading', () => sendToRenderer('tab:loading', { tabId, loading: true }));
  wc.on('ipc-message', (event, channel, payload) => {
    if (channel === 'shine-selection') {
      sendToRenderer('tab:selection', { tabId, text: String(payload || '').trim() });
    } else if (channel === 'shine-ui-dismiss') {
      hideOverlay();
      sendToRenderer('overlay:dismiss', {});
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
    if (entry && !/^shine:\/\//i.test(url) && !/^data:text\/html/i.test(url)) entry.isNewTab = false;
    const isNew = !!(entry && entry.isNewTab);
    sendToRenderer('tab:navigate', { tabId, url: isNew ? 'shine://newtab' : url });
    if (!isNew) recordHistory(wc, url);
  };

  wc.on('did-navigate', (e, url) => onNav(url));
  wc.on('did-navigate-in-page', (e, url) => onNav(url));
  wc.on('did-fail-load', (e, errorCode, errorDesc, validatedURL) => {
    sendToRenderer('tab:fail', { tabId, code: errorCode, desc: errorDesc, url: validatedURL });
    console.error('[shine] tab ' + tabId + ' failed to load ' + validatedURL + ': ' + errorCode + ' ' + errorDesc);
  });
}

function createTab(tabId, incognito, url) {
  if (views.has(tabId)) return;

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
  views.set(tabId, entry);
  hookWebContents(view.webContents, tabId, incognito);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.contentView.addChildView(view);
  }
  layoutViews();

  if (url) loadURL(tabId, url);
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

function getActiveTabView() {
  for (const [, entry] of views) {
    if (entry.active && entry.view && !entry.view.webContents.isDestroyed()) {
      return entry.view;
    }
  }
  return null;
}

function loadURL(tabId, url) {
  const id = Number(tabId);
  const entry = views.get(id);
  const wc = entry ? entry.view.webContents : null;
  if (!wc || wc.isDestroyed()) return;
  const target = normalizeUrl(url);
  if (target.startsWith('shine://newtab')) {
    entry.isNewTab = true;
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(newTabPageHTML(entry.incognito))).catch(() => {});
    return;
  }
  entry.isNewTab = false;
  wc.loadURL(target).catch(() => {});
}

// ---------------------------------------------------------------------------
// IPC — Window controls
// ---------------------------------------------------------------------------
function setupIpc() {
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
    const wc = views.get(tabId)?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript(`window.__shineTabOp && window.__shineTabOp(${JSON.stringify(op)}, ${JSON.stringify(arg)})`, true).catch(() => {});
  });

  // --- new tab page wallpaper ---
  ipcMain.handle('nt:get-wallpaper', () => wallpaperCss());
  ipcMain.handle('nt:pick-wallpaper', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a wallpaper',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, css: null };
    const src = r.filePaths[0];
    const dest = path.join(USER_DATA(), 'wallpaper' + (path.extname(src).toLowerCase() || '.png'));
    try {
      fs.copyFileSync(src, dest);
    } catch (err) {
      return { ok: false, css: null };
    }
    const s = store.read('settings');
    s.wallpaper = dest;
    store.write('settings', s);
    return { ok: true, css: wallpaperCss() };
  });
  ipcMain.handle('nt:clear-wallpaper', () => {
    const s = store.read('settings');
    if (s.wallpaper) {
      try { if (fs.existsSync(s.wallpaper)) fs.unlinkSync(s.wallpaper); } catch (e) { /* ignore */ }
    }
    delete s.wallpaper;
    store.write('settings', s);
    return { ok: true };
  });

  // --- floating overlay (selection pill, menus, toasts, download checker) ---
  ipcMain.on('overlay:show', (e, spec) => {
    if (!spec) return;
    showOverlay(spec.widget, spec.place, spec.data);
  });
  ipcMain.on('overlay:hide', (e, widget) => hideOverlay(widget));

  // --- side panel width ---
  ipcMain.on('win:set-side-panel', (e, w) => {
    const width = Math.max(0, Math.round(Number(w) || 0));
    if (width === sidePanelWidth) return;
    sidePanelWidth = width;
    layoutViews();
  });

  // --- shine panel ---
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
  ipcMain.on('shine:set-max', (e, max) => {
    const s = store.read('settings');
    s.panelMax = !!max;
    store.write('settings', s);
    layoutViews();
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

  // --- settings ---
  ipcMain.handle('settings:get', () => store.read('settings'));
  ipcMain.handle('settings:set', (e, patch) => {
    const s = Object.assign({}, store.read('settings'), patch || {});
    store.write('settings', s);
    return s;
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

  // --- PC Control ---
  ipcMain.handle('pc:screenshot', async () => sysinfo.screenshot());
  ipcMain.handle('pc:apps', async () => sysinfo.apps());
  ipcMain.handle('pc:info', async () => sysinfo.info());
  ipcMain.handle('pc:processes', async () => sysinfo.processes());
  ipcMain.handle('pc:launch', async (e, appName) => sysinfo.launch(appName));
  ipcMain.handle('pc:open-path', async (e, p) => sysinfo.openPath(p));

  // --- PC Control via Open Shine (AI-driven) ---
  ipcMain.handle('pc:control', async (e, { prompt }) => {
    // Open Shine panel and send the prompt to Shine AI
    const s = store.read('settings');
    s.panelOpen = true;
    store.write('settings', s);
    createShinePanel();
    layoutViews();
    // Send prompt to Shine AI panel
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents.executeJavaScript(
        `window.__shineFillPrompt && window.__shineFillPrompt(${JSON.stringify(prompt || '')}, true);`,
        true
      ).catch(() => {});
    }
    return { ok: true };
  });

  // --- Browser Control via Open Shine (AI-driven) ---
  ipcMain.handle('browser:control', async (e, { prompt }) => {
    // Open Shine panel and send the prompt to Shine AI
    const s = store.read('settings');
    s.panelOpen = true;
    store.write('settings', s);
    createShinePanel();
    layoutViews();
    // Send prompt to Shine AI panel
    if (shineView && !shineView.webContents.isDestroyed()) {
      shineView.webContents.executeJavaScript(
        `window.__shineFillPrompt && window.__shineFillPrompt(${JSON.stringify(prompt || '')}, true);`,
        true
      ).catch(() => {});
    }
    return { ok: true };
  });

  // --- Vision: capture screen and send to Shine AI ---
  ipcMain.handle('vision:capture-and-ask', async (e, { prompt }) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: 1920 });
      const source = sources[0];
      if (!source) return { ok: false, error: 'No screen source available' };
      const image = source.thumbnail.toDataURL();
      const s = store.read('settings');
      s.panelOpen = true;
      store.write('settings', s);
      createShinePanel();
      layoutViews();
      if (shineView && !shineView.webContents.isDestroyed()) {
        shineView.webContents.executeJavaScript(
          `window.__shineVision && window.__shineVision(${JSON.stringify(image)}, ${JSON.stringify(prompt || 'Analyze this screen and help me.')});`,
          true
        ).catch(() => {});
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // --- new tab page (wallpaper + navigation) ---
  ipcMain.handle('nt:get-state', (e) => {
    const wc = e.sender;
    const incognito = wc.__shineIncognito === true;
    return { wallpaper: incognito ? null : wallpaperCss(), incognito };
  });
  ipcMain.on('nt:navigate', (e, raw) => {
    const wc = e.sender;
    const tabId = wc.__shineTabId;
    const v = String(raw || '').trim();
    if (!v || tabId === undefined) return;
    loadURL(tabId, normalizeUrl(v));
  });

  // --- virus blocker ---
  ipcMain.handle('virus:scan-url', async (e, url) => {
    // Basic heuristic: block known malicious patterns
    const suspicious = ['.exe', '.bat', '.scr', '.vbs', '.ps1'];
    const isSuspicious = suspicious.some(ext => url.toLowerCase().endsWith(ext));
    return { ok: true, blocked: isSuspicious, url };
  });

  // --- time checker ---
  ipcMain.handle('time:get', () => ({
    now: Date.now(),
    iso: new Date().toISOString(),
    locale: new Date().toLocaleString(),
  }));
}

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
  return (s.searchEngine || 'google') === 'google' ? 'https://www.google.com/search?q=' + encodeURIComponent(query)
    : s.searchEngine === 'bing' ? 'https://www.bing.com/search?q=' + encodeURIComponent(query)
      : s.searchEngine === 'duckduckgo' ? 'https://duckduckgo.com/?q=' + encodeURIComponent(query)
        : s.searchEngine === 'brave' ? 'https://search.brave.com/search?q=' + encodeURIComponent(query)
          : s.searchEngine === 'ecosia' ? 'https://www.ecosia.org/search?q=' + encodeURIComponent(query)
            : s.searchEngine === 'startpage' ? 'https://www.startpage.com/sp/search?query=' + encodeURIComponent(query)
              : s.searchEngine === 'youtube' ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
                : 'https://www.google.com/search?q=' + encodeURIComponent(query);
}

function wallpaperFile() {
  const p = store.read('settings').wallpaper;
  if (!p || !fs.existsSync(p)) return null;
  return p;
}

function wallpaperCss() {
  const p = wallpaperFile();
  if (!p) return null;
  try {
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif'
          : ext === '.bmp' ? 'image/bmp'
            : 'image/jpeg';
    const b64 = fs.readFileSync(p).toString('base64');
    return 'data:' + mime + ';base64,' + b64;
  } catch (e) { return null; }
}

function recordHistory(wc, url) {
  // placeholder - history is recorded elsewhere
}

function askShine(text, mode) {
  const s = store.read('settings');
  s.panelOpen = true;
  store.write('settings', s);
  createShinePanel();
  layoutViews();
  if (shineView && !shineView.webContents.isDestroyed()) {
    shineView.webContents.executeJavaScript(
      `window.__shineFillPrompt && window.__shineFillPrompt(${JSON.stringify(text || '')}, true);`,
      true
    ).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// New tab page — search bar + Open Shine button, nothing else
// ---------------------------------------------------------------------------
function newTabPageHTML(incognito) {
  const wp = incognito ? null : wallpaperCss();
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https:;">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#000;color:#fff;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif;
 -webkit-font-smoothing:antialiased;display:flex;flex-direction:column;align-items:center;justify-content:center;
 background-position:center;background-size:cover;background-repeat:no-repeat;position:relative;overflow:hidden}
body.wp::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,.42)}
.wrap{position:relative;z-index:1;width:min(600px,88vw);display:flex;flex-direction:column;align-items:center;gap:14px}
.search{display:flex;align-items:center;gap:12px;padding:15px 18px;
 border:1px solid rgba(255,255,255,.15);border-radius:15px;background:rgba(10,10,10,.72);
 backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transition:border-color .2s ease}
.search:focus-within{border-color:rgba(255,255,255,.4)}
.search svg{width:16px;height:16px;flex:none;fill:none;stroke:rgba(255,255,255,.4);
 stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.search input{flex:1;min-width:0;background:transparent;border:none;outline:none;
 color:#fff;font:inherit;font-size:15px}
.search input::placeholder{color:rgba(255,255,255,.42)}
.search .go{border:none;background:transparent;color:rgba(255,255,255,.55);cursor:pointer;
 font:inherit;font-size:12.5px;padding:7px 12px;border-radius:9px;transition:all .15s ease;white-space:nowrap}
.search .go:hover{color:#fff;background:rgba(255,255,255,.1)}
.shine-btn{display:flex;align-items:center;gap:10px;border:1px solid rgba(255,255,255,.12);
 background:rgba(10,10,10,.6);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
 color:#fff;font:inherit;font-size:13px;font-weight:500;padding:10px 16px;border-radius:10px;
 cursor:pointer;transition:all .18s ease;margin-top:8px}
.shine-btn:hover{color:#000;background:#fff;border-color:#fff}
.shine-btn svg{width:14px;height:14px;fill:#000;stroke:none}
</style></head><body${wp ? ' class="wp" style="background-image: url(' + wp + ')' : ''}>
<div class="wrap">
  <div class="search">
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/></svg>
    <input id="q" placeholder="Search or enter website" autofocus autocomplete="off" spellcheck="false" />
    <button class="go" id="go">Search</button>
  </div>
  <button class="shine-btn" id="btnOpenShine">
    <svg viewBox="0 0 24 24"><path d="M4 12h5M15 12h5M12 4v5M12 15v5"/><circle cx="12" cy="12" r="2.6"/></svg>
    <span>Open Shine</span>
  </button>
</div>
<script>
var q = document.getElementById('q');
function go() {
  var v = q.value.trim();
  if (!v) return;
  if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(v)) location.href = v;
  else if (/^[\\w-]+(\\.[\\w-]+)+(:\\d+)?(\\/.*)?$/.test(v) && v.indexOf(' ') < 0) location.href = 'https://' + v;
  else location.href = 'https://www.google.com/search?q=' + encodeURIComponent(v);
}
document.getElementById('go').addEventListener('click', go);
q.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
document.getElementById('btnOpenShine').addEventListener('click', function () {
  window.__shineNT && window.__shineNT.openShine
    ? window.__shineNT.openShine()
    : alert('Open Shine not available');
});
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // Internal pages: shine://newtab/ is the start page, shine://wallpaper is
  // the user's chosen background image. Wallpaper pick/clear happen through
  // shine:// navigations so the new-tab page never needs IPC from a
  // sandboxed preload (contextBridge is unreliable there).
  protocol.handle('shine', async (req) => {
    console.log('[shine] handle request:', req.url);
    const u = new URL(req.url);
    const win = BrowserWindow.fromWebContents(req.webContents) || mainWindow;

    if (u.hostname === 'wallpaper') {
      const file = wallpaperFile();
      if (!file) return new Response('Not set', { status: 404 });
      try {
        const stat = fs.statSync(file);
        const ext = path.extname(file).toLowerCase();
        const type = ext === '.png' ? 'image/png'
          : ext === '.webp' ? 'image/webp'
            : ext === '.gif' ? 'image/gif'
              : ext === '.bmp' ? 'image/bmp'
                : 'image/jpeg';
        return new Response(fs.readFileSync(file), {
          headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Cache-Control': 'no-cache' },
        });
      } catch (e) {
        return new Response('Not available', { status: 404 });
      }
    }

    if (u.pathname === '/pick-wallpaper' || u.hostname === 'pick-wallpaper') {
      try {
        const r = await dialog.showOpenDialog(win, {
          title: 'Choose a wallpaper',
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
        });
        if (!r.canceled && r.filePaths && r.filePaths[0]) {
          const src = r.filePaths[0];
          const dest = path.join(USER_DATA(), 'wallpaper' + (path.extname(src).toLowerCase() || '.png'));
          try { fs.copyFileSync(src, dest); } catch (e) { /* ignore */ }
          const s = store.read('settings');
          s.wallpaper = dest;
          store.write('settings', s);
          wallpaperCache = { path: null, css: null };
        }
      } catch (e) { /* ignore */ }
      return new Response(
        '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=shine://newtab/"></head></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    if (u.pathname === '/wallpaper/clear' || u.hostname === 'wallpaper-clear') {
      const s = store.read('settings');
      if (s.wallpaper) {
        try { if (fs.existsSync(s.wallpaper)) fs.unlinkSync(s.wallpaper); } catch (e) { /* ignore */ }
      }
      delete s.wallpaper;
      store.write('settings', s);
      wallpaperCache = { path: null, css: null };
      return new Response(
        '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=shine://newtab/"></head></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    // everything else under shine:// is the new tab page
    const incognito = u.searchParams.get('incognito') === '1';
    return new Response(newTabPageHTML(incognito), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  });

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