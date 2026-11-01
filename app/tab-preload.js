// =====================================================================
// Shine Browser — preload injected into every tab
// Lives in an isolated world (contextIsolation), so pages never see it.
// Reports the current selection to the main process, which forwards it
// to the chrome renderer to show the action pill.
// =====================================================================
const { ipcRenderer } = require('electron');

function report() {
  try {
    const text = String(window.getSelection() || '').trim();
    ipcRenderer.send('shine-selection', text);
  } catch (e) { /* ignore */ }
}

document.addEventListener('mouseup', () => setTimeout(report, 12), true);
document.addEventListener('keyup', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) setTimeout(report, 12);
}, true);
