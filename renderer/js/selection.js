// =====================================================================
// Shine Browser — selection action bar
// The little floating pill that appears when you highlight text, in the
// same glass style as the Shine UI: Ask Shine, Google, site search,
// copy, translate, define, print, more.
// =====================================================================
(function () {
  const bar = () => document.getElementById('selectionBar');
  let currentText = '';
  let currentTab = null;

  function show(rect, text, tab) {
    currentText = text || '';
    currentTab = tab || SB.activeTab();
    const el = bar();
    el.classList.remove('hidden');

    const w = el.offsetWidth;
    const h = el.offsetHeight;

    let x, y;
    if (rect && typeof rect.y === 'number') {
      x = rect.x + (rect.w || 0) / 2 - w / 2;
      y = rect.y - h - 12;
      // flip below if it would clip the top
      if (y < 8) y = rect.y + (rect.h || 0) + 12;
    } else {
      x = window.innerWidth / 2 - w / 2;
      y = window.innerHeight / 2;
    }
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - h - 8, y));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function hide() {
    bar().classList.add('hidden');
  }

  function act(name) {
    const tab = currentTab || SB.activeTab();
    const text = currentText;
    if (!text || !tab) return;

    switch (name) {
      case 'ask':
        SB.ipc.shine.ask(text, 'selection');
        SB.toast('Asking Shine about your selection…');
        hide();
        break;
      case 'google':
        SB.loadTab(tab, 'https://www.google.com/search?q=' + encodeURIComponent(text));
        hide();
        break;
      case 'site': {
        try {
          const u = new URL(tab.url);
          SB.loadTab(tab, `https://www.google.com/search?q=${encodeURIComponent(text)}+site:${u.hostname}`);
        } catch (e) {
          SB.loadTab(tab, 'https://www.google.com/search?q=' + encodeURIComponent(text));
        }
        hide();
        break;
      }
      case 'copy':
        navigator.clipboard.writeText(text).then(() => SB.toast('Copied to clipboard'));
        hide();
        break;
      case 'translate':
        SB.ipc.shine.ask(text, 'translate');
        SB.toast('Asking Shine to translate…');
        hide();
        break;
      case 'define':
        SB.ipc.shine.ask(text, 'explain');
        SB.toast('Asking Shine to define it…');
        hide();
        break;
      case 'print':
        SB.ipc.tab.op(tab.id, 'print');
        hide();
        break;
      case 'more':
        openMore();
        break;
      default:
        break;
    }
  }

  function openMore() {
    const cm = document.getElementById('contextMenu');
    const items = [
      { act: 'summarize', label: 'Summarize with Shine' },
      { act: 'rewrite', label: 'Rewrite more professionally' },
      { act: 'improve', label: 'Improve this writing' },
      { act: 'reading', label: 'Enter reading mode' },
      { act: 'search-wiki', label: 'Search Wikipedia' },
      { act: 'search-x', label: 'Search X / Twitter' },
      { act: 'search-yt', label: 'Search YouTube' },
      { act: 'save-note', label: 'Save as note in Shine' },
    ];
    cm.innerHTML = items.map((it) => `<button data-act="${it.act}"><span>${it.label}</span></button>`).join('');
    cm.classList.remove('hidden');
    const r = bar().getBoundingClientRect();
    const w = cm.offsetWidth;
    cm.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    cm.style.top = Math.max(8, r.top - cm.offsetHeight - 8) + 'px';

    cm.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        cm.classList.add('hidden');
        const tab = currentTab || SB.activeTab();
        const text = currentText;
        switch (b.dataset.act) {
          case 'summarize': SB.ipc.shine.ask(text, 'summarize'); SB.toast('Summarizing with Shine…'); break;
          case 'rewrite': SB.ipc.shine.ask(text, 'rewrite'); break;
          case 'improve': SB.ipc.shine.ask(text, 'improve'); break;
          case 'reading': SB.ipc.tab.op(tab.id, 'reading-mode'); SB.toast('Reading mode on'); break;
          case 'search-wiki': SB.loadTab(tab, 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(text)); break;
          case 'search-x': SB.loadTab(tab, 'https://x.com/search?q=' + encodeURIComponent(text)); break;
          case 'search-yt': SB.loadTab(tab, 'https://www.youtube.com/results?search_query=' + encodeURIComponent(text)); break;
          case 'save-note': SB.ipc.shine.ask(`Save this as a note in my Shine notebook:\n\n${text}`, 'selection'); break;
          default: break;
        }
        hide();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bar().querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => act(b.dataset.act));
    });

    // dismiss when clicking anywhere else
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#selectionBar')) hide();
    });

    // the "Ask Shine" button in the panel head uses the last selection
    const askSel = document.getElementById('shineAskSel');
    if (askSel) {
      askSel.addEventListener('click', async () => {
        const tab = SB.activeTab();
        let text = currentText;
        if (!text && tab) text = await SB.ipc.tab.selection(tab.id);
        if (!text) {
          SB.toast('Select some text on the page first');
          return;
        }
        SB.ipc.shine.ask(text, 'selection');
        SB.toast('Asking Shine about your selection…');
      });
    }
  });

  SB.selectionBar = { show, hide, act };
})();
