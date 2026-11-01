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

SB.toast = function (text, ms) {
  const el = SB.$('#toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(el.__t);
  el.__t = setTimeout(() => el.classList.add('hidden'), ms || 3200);
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
