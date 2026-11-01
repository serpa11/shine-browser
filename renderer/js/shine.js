// =====================================================================
// Shine Browser — Shine split-screen panel
// The panel itself is a WebContentsView owned by the main process
// (loading shineai-9mr.pages.dev). This module only toggles, resizes
// and talks to it through IPC.
// =====================================================================
(function () {
  let dragging = false;
  let maximized = false;

  function panelEl() { return document.getElementById('shinePanel'); }

  function show() {
    const p = panelEl();
    p.classList.remove('hidden');
    p.classList.toggle('max', maximized);
    document.getElementById('btnSplit').classList.add('active');
    document.getElementById('btnShine').classList.add('active');
    SB.panelOpen = true;
    SB.ipc.shine.setWidth(pct());
    SB.ipc.tab.layout();
    SB.ipc.settings.set({ panelOpen: true });
    if (!maximized) p.style.width = Math.round(pct() * 100) + '%';
  }

  function hide() {
    panelEl().classList.add('hidden');
    document.getElementById('btnSplit').classList.remove('active');
    document.getElementById('btnShine').classList.remove('active');
    SB.panelOpen = false;
    SB.ipc.tab.layout();
    SB.ipc.settings.set({ panelOpen: false });
  }

  function toggle() {
    panelEl().classList.contains('hidden') ? show() : hide();
  }

  function pct() {
    const w = panelEl().offsetWidth;
    if (!w) return 0.42;
    return Math.min(0.75, Math.max(0.25, w / window.innerWidth));
  }

  function initResize() {
    const grip = document.getElementById('shineResize');
    const panel = panelEl();

    grip.addEventListener('mousedown', (e) => {
      dragging = true;
      grip.classList.add('active');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging || maximized) return;
      const w = window.innerWidth - e.clientX;
      const min = 320;
      const max = Math.max(400, window.innerWidth - 380);
      panel.style.width = Math.max(min, Math.min(max, w)) + 'px';
      SB.ipc.tab.layout();
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      grip.classList.remove('active');
      SB.ipc.shine.setWidth(pct());
    });
  }

  function init() {
    initResize();

    document.getElementById('shineClose').addEventListener('click', hide);

    document.getElementById('shineMax').addEventListener('click', () => {
      const panel = panelEl();
      maximized = !maximized;
      panel.classList.toggle('max', maximized);
      if (maximized) panel.style.width = '';
      else panel.style.width = Math.round(pct() * 100) + '%';
      SB.ipc.tab.layout();
    });

    document.getElementById('btnSplit').addEventListener('click', toggle);

    document.getElementById('btnShine').addEventListener('click', () => {
      show();
      setTimeout(() => SB.ipc.shine.send(''), 700);
    });

    document.getElementById('brandBtn').addEventListener('click', () => {
      SB.loadTab(SB.activeTab(), 'shine://newtab');
    });

    document.getElementById('shineAskSel').addEventListener('click', async () => {
      let text = SB.selection.text;
      if (!text) {
        const tab = SB.activeTab();
        if (tab) text = await SB.ipc.tab.selection(tab.id);
      }
      if (!text) {
        SB.toast('Select some text on the page first');
        return;
      }
      SB.ipc.shine.ask(text, 'selection');
      SB.toast('Asking Shine about your selection…');
    });
  }

  SB.shine = { init, show, hide, toggle, isHidden: () => panelEl().classList.contains('hidden') };
})();
