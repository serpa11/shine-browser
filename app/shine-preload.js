// =====================================================================
// Shine Browser — preload injected into the Shine panel (shineai-9mr).
//   * Exposes window.shineBrowser.* so the Shine page can drive the
//     browser: navigate, search, tabs, PC Control (apps/sysinfo), etc.
//   * Exposes window.__shineFillPrompt / __shineBridgeReceive which the
//     main process calls via executeJavaScript to push prompts/replies
//     into the live Shine composer.
// =====================================================================
const { contextBridge, ipcRenderer } = require('electron');

const send = (cmd, extra) => {
  ipcRenderer.sendToHost('shine-command', Object.assign({ cmd }, extra || {}));
};

const api = {
  version: '1.0.0',
  ready: true,
  navigate: (url) => send('navigate', { url }),
  openUrl: (url) => send('open-url', { url }),
  search: (q) => send('search', { query: q }),
  newTab: (url) => send('new-tab', { url }),
  closeTab: () => send('close-tab'),
  back: () => send('back'),
  forward: () => send('forward'),
  reload: () => send('reload'),
  bookmark: () => send('bookmark'),
  togglePanel: (open) => send('toggle-panel', { open }),
  screenshot: () => send('screenshot'),
  openApp: (name) => send('open-app', { name }),
  launchApp: (name) => send('launch-app', { name }),
  listApps: (force) => send('list-apps', { force: !!force }),
  sysInfo: () => send('sys-info'),
  processes: () => send('processes'),
  reveal: (p) => send('reveal', { path: p }),
  openPath: (p) => send('reveal', { path: p }),
  listBookmarks: () => send('list-bookmarks'),
  listHistory: () => send('list-history'),
  listDownloads: () => send('list-downloads'),
  listExtensions: () => send('list-extensions'),
  openChromeWebStore: () => send('open-chrome-web-store'),
};

contextBridge.exposeInMainWorld('shineBrowser', api);

// ---- helpers shared by the injected scripts -------------------------------
function dispatch(name, detail) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* ignore */ }
}

function findPrompt() {
  return document.querySelector('#prompt') ||
    document.querySelector('textarea[placeholder*="Ask"]') ||
    document.querySelector('textarea');
}

function findSend() {
  return document.getElementById('actionBtn') ||
    document.querySelector('button[aria-label*="Send"]') ||
    document.querySelector('.controls-right button');
}

// Fill the live Shine composer with a prompt and (optionally) send it.
function fillPrompt(text, sendIt) {
  const ta = findPrompt();
  if (!ta) return false;
  ta.focus();
  const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
  const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(ta, String(text));
  else ta.value = String(text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
  // Grow it so long selections are visible.
  ta.style.height = 'auto';
  ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  if (sendIt) {
    setTimeout(() => {
      const btn = findSend();
      if (btn) btn.click();
    }, 120);
  }
  return true;
}

// Entry points called by the main process (executeJavaScript).
try {
  Object.defineProperty(window, '__shineFillPrompt', {
    value: fillPrompt, writable: false, configurable: false,
  });
  Object.defineProperty(window, '__shineBridgeReceive', {
    value: (data) => {
      dispatch('shine-browser-reply', data);
      if (window.__shineOnBridgeReply && typeof window.__shineOnBridgeReply === 'function') {
        try { window.__shineOnBridgeReply(data); } catch (e) { /* ignore */ }
      }
    },
    writable: false, configurable: false,
  });
} catch (e) { /* ignore */ }

// ---- page -> browser relay ------------------------------------------------
// The Shine page can call window.shineBrowser.* directly. We also relay a
// documented postMessage protocol so a future Shine build can talk to us:
//   parent.postMessage({ __shineBrowser: true, cmd: 'navigate', url }, '*')
try {
  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || d.__shineBrowser !== true) return;
    const { cmd } = d;
    if (cmd && typeof api[cmd] === 'function') {
      api[cmd](d.url || d.query || d.name || d.path || d.open);
    } else if (cmd === 'search') {
      api.search(d.query);
    } else if (cmd === 'open-app' || cmd === 'launch-app') {
      api.openApp(d.name || d.app);
    } else if (cmd === 'sys-info') {
      api.sysInfo();
    }
  });
} catch (e) { /* ignore */ }
