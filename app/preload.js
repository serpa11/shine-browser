// =====================================================================
// Shine Browser — preload (main chrome window)
// =====================================================================
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);
const on = (channel, cb) => {
  const handler = (e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('shine', {
  // window chrome
  win: {
    minimize: () => send('win:minimize'),
    maximize: () => send('win:maximize'),
    close: () => send('win:close'),
    isMaximized: () => invoke('win:is-maximized'),
    setChromeHeight: (h) => send('win:set-chrome-height', h),
    setSidePanel: (w) => send('win:set-side-panel', w),
  },

  // tabs (web contents managed by the main process)
  tab: {
    create: (tabId, incognito, url) => send('tab:create', { tabId, incognito, url }),
    destroy: (tabId) => send('tab:destroy', { tabId }),
    layout: () => send('tab:layout'),
    show: (tabId) => send('tab:show', { tabId }),
    load: (tabId, url) => send('tab:load', { tabId, url }),
    op: (tabId, op, arg) => send('tab:op', { tabId, op, arg }),
    info: (tabId) => invoke('tab:info', { tabId }),
    selection: (tabId) => invoke('tab:selection', { tabId }),
    selectionRect: (tabId) => invoke('tab:selectionRect', { tabId }),
    pageText: (tabId) => invoke('tab:page-text', { tabId }),
  },

  // shine panel + bridge
  shine: {
    toggle: () => send('shine:toggle'),
    isOpen: () => invoke('shine:is-open'),
    setWidth: (r) => send('shine:set-width', r),
    ask: (text, mode) => send('shine:ask', { text, mode }),
    send: (text) => send('shine:send', { text }),
    on: (channel, cb) => on(channel, cb),
  },

  // data
  bookmarks: {
    list: () => invoke('bookmarks:list'),
    add: (bm) => invoke('bookmarks:add', bm),
    remove: (id) => invoke('bookmarks:remove', id),
    removeAll: () => invoke('bookmarks:remove-all'),
  },
  history: {
    list: () => invoke('history:list'),
    remove: (time) => invoke('history:remove', time),
    clear: () => invoke('history:clear'),
  },
  downloads: {
    list: () => invoke('downloads:list'),
    reveal: (p) => invoke('downloads:reveal', p),
    onChanged: (cb) => on('downloads:changed', cb),
  },
  extensions: {
    list: () => invoke('extensions:list'),
    load: () => invoke('extensions:load'),
    remove: (id) => invoke('extensions:remove', id),
    toggle: (id) => invoke('extensions:toggle', id),
  },

  // PC control
  pc: {
    apps: (force) => invoke('pc:apps', force),
    launch: (name) => invoke('pc:launch', name),
    info: () => invoke('pc:info'),
    processes: () => invoke('pc:processes'),
    screenshot: () => invoke('pc:screenshot'),
    reveal: (p) => invoke('pc:reveal', p),
    openPath: (p) => invoke('pc:open-path', p),
  },

  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },

  // floating overlay (selection pill, menus, toasts, settings)
  overlay: {
    show: (widget, place, data) => send('overlay:show', { widget, place, data }),
    hide: (widget) => send('overlay:hide', widget || null),
  },

  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:open-external', url),
    openDownloads: () => invoke('app:open-downloads'),
  },
  setup: {
    status: () => invoke('setup:status'),
    run: (opts) => invoke('setup:run', opts),
    open: () => send('setup:open'),
  },

  // generic event stream from the main process
  events: (cb) => {
    const channels = [
      'tab:loading', 'tab:title', 'tab:favicon', 'tab:navigate', 'tab:fail',
      'tab:zoom', 'tab:crashed', 'tab:context-menu', 'tab:open-external-tab',
      'tab:selection', 'kb:shortcut',
      'shine:open-url', 'shine:search', 'shine:new-tab', 'shine:close-tab',
      'shine:reload', 'shine:history-back', 'shine:history-forward',
      'shine:bookmark-current', 'shine:toast', 'shine:state',
      'downloads:changed',
      'overlay:action', 'overlay:dismiss', 'layout:views',
    ];
    const offs = channels.map((ch) => on(ch, (data) => cb(ch, data)));
    return () => offs.forEach((o) => o());
  },

  webPath: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },
});
