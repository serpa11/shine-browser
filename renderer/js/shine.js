// =====================================================================
// Shine Browser — Shine split-screen panel
// The panel itself is a WebContentsView owned by the main process
// (loading shineai-9mr.pages.dev). This module only toggles, resizes
// and talks to it through IPC.
//
// Positioning and width now come from the main process via the
// `layout:views` event — the chrome renderer never sizes the view itself,
// which is how the panel pushes the page aside instead of being painted
// over by it.
// =====================================================================
(function () {
  let maximized = false;

  function panelEl() { return document.getElementById('shinePanel'); }

  function show() {
    const p = panelEl();
    p.classList.remove('hidden');
    p.classList.toggle('max', maximized);
    document.getElementById('btnSplit').classList.add('active');
    document.getElementById('btnShine').classList.add('active');
    SB.panelOpen = true;
    SB.ipc.settings.set({ panelOpen: true });
    SB.ipc.tab.layout(); // main sends layout:views which positions the DOM panel
  }

  function hide() {
    panelEl().classList.add('hidden');
    document.getElementById('btnSplit').classList.remove('active');
    document.getElementById('btnShine').classList.remove('active');
    SB.panelOpen = false;
    SB.ipc.settings.set({ panelOpen: false });
    SB.ipc.tab.layout();
  }

  function toggle() {
    panelEl().classList.contains('hidden') ? show() : hide();
  }

  async function init() {
    const s = await SB.ipc.settings.get().catch(() => ({}));
    maximized = !!s.panelMax;

    document.getElementById('shineClose').addEventListener('click', hide);

    document.getElementById('shineMax').addEventListener('click', () => {
      maximized = !maximized;
      SB.ipc.settings.set({ panelMax: maximized });
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
