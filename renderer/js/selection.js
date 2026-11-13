// =====================================================================
// Shine Browser — selection action bar
// The pill itself is drawn by the overlay view (a transparent child view
// stacked ABOVE the page). If it lived in this renderer it would be
// painted over by the web page, because the chrome renderer is the bottom
// layer. This module only decides which buttons appear and where.
// =====================================================================
(function () {
  let currentText = '';
  let currentTab = null;

  const ACTIONS = {
    ask: {
      label: 'Ask Shine',
      primary: true,
      run: () => {
        const text = currentText;
        SB.shine.open();
        SB.ipc.shine.ask(text, 'selection');
      },
    },
    google: {
      label: 'Search on Google',
      run: () => SB.loadTab(currentTab, SB.searchUrl(currentText, 'https://www.google.com/search?q=')),
    },
    site: {
      label: 'Search this site',
      run: () => {
        if (!currentTab || !currentTab.url) return;
        try {
          const origin = new URL(currentTab.url).origin;
          SB.loadTab(currentTab, SB.searchUrl(currentText, origin + '/search?q='));
        } catch (e) { SB.toast('This page has no site search.'); }
      },
    },
    copy: {
      label: 'Copy',
      run: () => {
        const text = currentText;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => SB.toast('Copied to clipboard')).catch(() => SB.toast('Copy failed'));
        } else { SB.toast('Copy unavailable'); }
      },
    },
    translate: {
      label: 'Translate',
      run: () => SB.loadTab(currentTab, 'https://translate.google.com/translate?sl=auto&tl=en&u=' + encodeURIComponent(currentTab ? currentTab.url : '')),
    },
    define: {
      label: 'Define',
      run: () => SB.loadTab(currentTab, SB.searchUrl(currentText.split(/\s+/)[0], 'https://www.google.com/search?q=define%20')),
    },
    print: {
      label: 'Print',
      run: () => SB.goActive('print'),
    },
    more: {
      label: 'More',
      run: () => SB.toast('Right-click for the full menu: copy link, save image, translate, and more.'),
    },
  };

  function buttons() {
    const acts = Object.keys(ACTIONS);
    if (SB.aiEnabled === false) {
      // remove the AI "Ask Shine" action
      return acts.filter((a) => a !== 'ask').map((act) => ({
        act,
        label: ACTIONS[act].label,
        primary: !!ACTIONS[act].primary,
      }));
    }
    return acts.map((act) => ({
      act,
      label: ACTIONS[act].label,
      primary: !!ACTIONS[act].primary,
    }));
  }

  function placeFor(rect) {
    const chromeH = SB.chromeH || 122;
    if (!rect || typeof rect.y !== 'number') {
      return { mode: 'bottom-center', inset: Math.max(80, (window.innerHeight * 0.35)) };
    }
    // rect is in tab-view coordinates; the pill must clear the browser chrome
    // so the overlay adds chromeH to the y it is given.
    const cx = rect.x + (rect.w || 0) / 2;
    const top = rect.y + chromeH;
    return {
      mode: 'cx-above',
      cx,
      y: top - 12,
      // if there is no room above the text, flip below it
      alt: { mode: 'cx', cx, y: top + (rect.h || 0) + 12 },
    };
  }

  const bar = {
    show(rect, text, tab) {
      currentText = String(text || '');
      currentTab = tab || SB.activeTab();
      if (!currentText) { bar.hide(); return; }
      SB.selection.rect = rect || null;
      SB.ipc.overlay.show('selection-bar', placeFor(rect), { buttons: buttons() });
    },
    hide() {
      currentText = '';
      SB.ipc.overlay.hide('selection-bar');
    },
    // called when the overlay reports a click on one of our buttons
    act(name) {
      const a = ACTIONS[name];
      if (!a) return;
      if (name === 'ask' && SB.aiEnabled === false) {
        SB.toast('Shine AI is disabled in Settings.');
        return;
      }
      SB.ipc.overlay.hide('selection-bar');
      try { a.run(); } catch (e) { /* ignore */ }
    },
  };

  SB.selectionBar = bar;
  SB.selectionActions = ACTIONS;
})();
