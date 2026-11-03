// =====================================================================
// Shine Browser — preload injected into every tab
// Lives in an isolated world (contextIsolation), so pages never see it.
//
//  1. Reports the current selection so the chrome can show the action pill.
//  2. Tells the browser to dismiss floating UI whenever the user interacts
//     with the page (the page is what the user is pointing at).
//
// Uses only `ipcRenderer.send`, which is available in sandboxed preloads.
// =====================================================================
const { ipcRenderer } = require('electron');

function reportSelection() {
  try {
    const text = String(window.getSelection() || '').trim();
    ipcRenderer.send('shine-selection', text);
  } catch (e) { /* ignore */ }
}

function dismissFloating() {
  try { ipcRenderer.send('shine-ui-dismiss'); } catch (e) { /* ignore */ }
}

document.addEventListener('mouseup', () => setTimeout(reportSelection, 12), true);
document.addEventListener('keyup', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) setTimeout(reportSelection, 12);
}, true);

// Any real interaction with the page means floating chrome must get out of
// the way: clicks, wheel and touch all count. Right-clicks are skipped — a
// context menu is about to replace whatever was showing.
document.addEventListener('mousedown', (e) => {
  if (e && e.button === 2) return;
  dismissFloating();
}, true);
document.addEventListener('wheel', dismissFloating, { capture: true, passive: true });
document.addEventListener('touchstart', dismissFloating, { capture: true, passive: true });

// ---- new tab page API (exposed on data: new-tab pages; main validates sender URL)
const { contextBridge } = require('electron');
function isNewTabPage() {
  try {
    return String(location.href || '').indexOf('data:text/html') === 0;
  } catch (e) { return false; }
}
if (isNewTabPage()) {
  try {
    contextBridge.exposeInMainWorld('__shineNT', {
      getWallpaper: () => ipcRenderer.invoke('nt:get-wallpaper'),
      pickWallpaper: () => ipcRenderer.invoke('nt:pick-wallpaper'),
      clearWallpaper: () => ipcRenderer.invoke('nt:clear-wallpaper'),
      reload: () => { location.reload(); },
    });
  } catch (e) {
    try { console.error('[shine] __shineNT expose failed:', String(e && e.message ? e.message : e)); } catch (ee) { /* ignore */ }
  }
}
