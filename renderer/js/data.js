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

  // Top-center Ask Shine button
  const shineBtn = el('btnShine');
  if (shineBtn) shineBtn.style.display = enabled ? '' : 'none';

  // Shine panel toggle via menu is handled by the menu itself; hide the
  // split-screen panel if it is open.
  if (!enabled) {
    el('shinePanel')?.classList.add('hidden');
    SB.panelOpen = false;
  }

  // Selection bar "Ask Shine" button is rebuilt from SB.selectionActions;
  // it reads SB.aiEnabled, so just re-show if there is a selection.
  if (enabled && SB.selection.text) {
    // re-render will pick up the flag
  }

  // PC Control / Browser Control "Ask Shine" inputs
  const pcAsk = el('pcAsk');
  const pcAskBtn = el('pcAskBtn');
  if (pcAsk) pcAsk.style.display = enabled ? '' : 'none';
  if (pcAskBtn) pcAskBtn.style.display = enabled ? '' : 'none';
  const bcAsk = el('bcAsk');
  const bcAskBtn = el('bcAskBtn');
  if (bcAsk) bcAsk.style.display = enabled ? '' : 'none';
  if (bcAskBtn) bcAskBtn.style.display = enabled ? '' : 'none';
};
