// =====================================================================
// Shine Browser — preload injected into every browsed page.
// Bridges text selection, link context and page state to the chrome.
// =====================================================================
const { contextBridge, ipcRenderer } = require('electron');

let lastSelection = '';

contextBridge.exposeInMainWorld('shinePage', {
  reportSelection: (payload) => ipcRenderer.send('page:selection', payload),
  askShine: (text, mode) => ipcRenderer.send('page:ask-shine', { text, mode }),
});

// Selection detection at the document level (runs in the page).
window.addEventListener('mouseup', () => {
  setTimeout(() => {
    try {
      const sel = String(window.getSelection() || '');
      lastSelection = sel;
      if (sel && sel.trim().length > 1) {
        ipcRenderer.sendToHost('selection', { text: sel.trim(), len: sel.trim().length });
      } else {
        ipcRenderer.sendToHost('selection', { text: '' });
      }
    } catch (e) { /* cross-origin frames etc. */ }
  }, 10);
});

window.addEventListener('keyup', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key && /^c$/i.test(e.key)) {
    try {
      const sel = String(window.getSelection() || '').trim();
      if (sel) ipcRenderer.sendToHost('copied', { text: sel });
    } catch (err) { /* ignore */ }
  }
});

window.addEventListener('scroll', () => {
  try { ipcRenderer.sendToHost('scroll', { y: window.scrollY }); } catch (e) { /* ignore */ }
});

ipcRenderer.on('ipc-reply', (e, data) => { /* reserved */ });

// Let the chrome read selection on demand.
ipcRenderer.on('get-selection', (e) => {
  e.sender.sendToHost('selection-reply', { text: String(window.getSelection() || '').trim() });
});
