// =====================================================================
// Shine Browser — preload for the floating overlay view
// The overlay is a transparent WebContentsView stacked ABOVE every tab,
// sized to exactly the widget it is showing. That is why the selection
// pill, menus and toasts are never painted over by the page: they no
// longer live in the chrome renderer (which is the bottom layer).
// =====================================================================
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);
const on = (channel, cb) => {
  const handler = (e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('shineOverlay', {
  // ---- view protocol ------------------------------------------------
  onRender: (cb) => on('overlay:render', cb),
  onPlace: (cb) => on('overlay:place', cb),
  measured: (seq, w, h) => send('overlay:measured', { seq, w, h }),
  action: (payload) => send('overlay:action', payload),
  dismiss: () => send('overlay:dismiss'),

  // ---- window chrome (settings panel lives here) --------------------
  win: {
    setChromeHeight: (h) => send('win:set-chrome-height', h),
  },

  // ---- data the settings panel needs --------------------------------
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  app: {
    info: () => invoke('app:info'),
  },
  setup: {
    status: () => invoke('setup:status'),
    open: () => send('setup:open'),
  },
  pc: {
    screenshot: () => invoke('pc:screenshot'),
    control: (prompt) => invoke('pc:control', { prompt }),
  },
  browser: {
    control: (prompt) => invoke('browser:control', { prompt }),
  },
  vision: {
    captureAndAsk: (prompt) => invoke('vision:capture-and-ask', { prompt }),
  },
  virus: {
    scanUrl: (url) => invoke('virus:scan-url', url),
  },
  time: {
    get: () => invoke('time:get'),
  },

  // generic event stream from the main process
  events: (cb) => {
    const channels = ['layout:views', 'shine:toast'];
    const offs = channels.map((ch) => on(ch, (data) => cb(ch, data)));
    return () => offs.forEach((o) => o());
  },
});
