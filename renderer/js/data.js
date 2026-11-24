// =====================================================================
// Shine Browser — shared state + helpers
// =====================================================================
window.SB = {
  tabs: [],
  activeTabId: null,
  nextTabId: 1,
  bookmarks: [],
  history: [],
  downloads: [],
  extensions: [],
  settings: {},
  panelOpen: false,
  selection: { text: '', rect: null },
  incognitoCounter: 0,
};

SB.ipc = window.shine;

// ---- helpers ---------------------------------------------------------------
SB.$ = (sel, root) => (root || document).querySelector(sel);
SB.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

// Toasts float over the page, so they are drawn by the overlay view.
// This keeps the public API identical (SB.toast) for every caller.
SB.toast = function (text, ms) {
  if (!SB.ipc.overlay) return;
  SB.ipc.overlay.show('toast', { mode: 'bottom-center', inset: 30 }, { text: String(text || '') });
  clearTimeout(SB.__toastTimer);
  SB.__toastTimer = setTimeout(() => SB.ipc.overlay.hide('toast'), ms || 3200);
};

SB.show = function (sel) { const e = SB.$(sel); if (e) e.classList.remove('hidden'); };
SB.hide = function (sel) { const e = SB.$(sel); if (e) e.classList.add('hidden'); };

SB.escapeHtml = function (s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
};

SB.faviconFor = function (url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch (e) {
    return '';
  }
};

SB.timeAgo = function (t) {
  const d = Date.now() - t;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
};

SB.formatBytes = function (n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v > 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

SB.isUrl = function (s) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ||
    /^localhost(:\d+)?(\/|$)/i.test(s) ||
    /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s);
};

// ---- data refresh ----------------------------------------------------------
SB.refreshBookmarks = async function () {
  SB.bookmarks = await SB.ipc.bookmarks.list();
  if (SB.panels) SB.panels.renderFavorites();
  SB.updateBookmarkStar();
};

SB.refreshHistory = async function () {
  SB.history = await SB.ipc.history.list();
  if (SB.panels) SB.panels.renderHistory();
};

SB.refreshDownloads = async function (list) {
  SB.downloads = list || (await SB.ipc.downloads.list());
  if (SB.panels) SB.panels.renderDownloads();
  const busy = SB.downloads.some((d) => d.state === 'progressing');
  SB.$('#btnDownloads').classList.toggle('busy', busy);
};

SB.refreshExtensions = async function () {
  SB.extensions = await SB.ipc.extensions.list();
  if (SB.panels) SB.panels.renderExtensions();
  SB.$('#btnExtensions').classList.toggle('has-ext', SB.extensions.length > 0);
};

SB.updateBookmarkStar = function () {
  const tab = SB.activeTab();
  const star = SB.$('#btnBookmark');
  if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
    star.classList.remove('on');
    return;
  }
  star.classList.toggle('on', SB.bookmarks.some((b) => b.url === tab.url));
};

// ---- AI gating ------------------------------------------------------------
// When the user disables Shine AI in settings, every AI feature is hidden
// and disabled so the browser is a plain, non-AI browser.
SB.aiEnabled = true;
SB.updateAIUI = function () {
  const enabled = SB.aiEnabled !== false;
  const el = (id) => document.getElementById(id);

  // Top-center Open Shine button
  const shineBtn = el('btnShine');
  if (shineBtn) shineBtn.style.display = enabled ? '' : 'none';

  // Shine panel toggle via menu is handled by the menu itself; hide the
  // split-screen panel if it is open.
  if (!enabled) {
    el('shinePanel')?.classList.add('hidden');
    SB.panelOpen = false;
  }

  // Selection bar "Open Shine" button is rebuilt from SB.selectionActions;
  // it reads SB.aiEnabled, so just re-show if there is a selection.
  if (enabled && SB.selection.text) {
    // re-render will pick up the flag
  }
};

// ---- Color customization --------------------------------------------------
SB.themeColor = SB.settings.themeColor || '#000000';
SB.accentColor = SB.settings.accentColor || '#ffffff';

SB.applyTheme = function () {
  const root = document.documentElement;
  root.style.setProperty('--bg', SB.themeColor || '#000000');
  root.style.setProperty('--accent', SB.accentColor || '#ffffff');
  // Also set the title bar color via JS since CSS vars don't affect native title bar
  if (SB.ipc && SB.ipc.win) {
    // Title bar color is set via preload/win.setChromeColor
    SB.ipc.win.setChromeColor(SB.themeColor || '#000000').catch(() => {});
  }
};

// ---- Ad blocker -----------------------------------------------------------
SB.adBlockList = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adsystem.com',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'adroll.com',
  'facebook.com/tr',
  'analytics.facebook.com',
];

SB.isAdBlocked = function (url) {
  try {
    const u = new URL(url);
    return SB.adBlockList.some(d => u.hostname.includes(d) || u.hostname === d);
  } catch (e) { return false; }
};

// ---- Download checker -----------------------------------------------------
SB.downloads = SB.downloads || [];
SB.downloadProgress = {};

SB.setDownloadProgress = function (id, percent, filename, state) {
  SB.downloadProgress[id] = { percent, filename, state, time: Date.now() };
  SB.ipc.overlay.show('download-checker', { mode: 'bottom-center', inset: 80 }, {
    id, percent, filename, state
  });
  clearTimeout(SB.__dlTimer);
  SB.__dlTimer = setTimeout(() => {
    SB.ipc.overlay.hide('download-checker');
  }, 5000);
};

SB.clearDownloadProgress = function (id) {
  delete SB.downloadProgress[id];
  SB.ipc.overlay.hide('download-checker');
};

// ---- Virus blocker --------------------------------------------------------
SB.virusBlockList = [
  'malware.com',
  'virus.com',
  'trojan.com',
];

SB.isBlocked = function (url) {
  try {
    const u = new URL(url);
    return SB.virusBlockList.some(d => u.hostname.includes(d) || u.hostname === d);
  } catch (e) { return false; }
};

// ---- Time checker ---------------------------------------------------------
SB.getTime = function () {
  const now = new Date();
  return {
    now: now.getTime(),
    iso: now.toISOString(),
    locale: now.toLocaleString(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  };
};

// ---- Mouse cursor customizer ----------------------------------------------
SB.cursorStyle = SB.settings.cursorStyle || 'auto';
SB.applyCursor = function () {
  document.body.style.cursor = SB.cursorStyle || 'auto';
};
