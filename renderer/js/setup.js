// =====================================================================
// Shine Browser — setup window (first-run installer UI)
// Runs the shortcut installer from app/installer.js and shows progress.
// =====================================================================
(function () {
  const win = () => document.getElementById('setupWindow');
  const stepsHost = () => document.getElementById('setupSteps');

  const STEPS = [
    { key: 'files', label: 'Installing Shine Browser files' },
    { key: 'desktop', label: 'Creating Desktop shortcut' },
    { key: 'start', label: 'Adding Start menu shortcut' },
    { key: 'taskbar', label: 'Pinning to taskbar' },
    { key: 'done', label: 'Finishing up' },
  ];

  function render(activeIdx, doneSet) {
    stepsHost().innerHTML = STEPS.map((s, i) => {
      const done = doneSet.has(s.key);
      const active = i === activeIdx && !done;
      return `<div class="setup-step ${done ? 'done' : ''} ${active ? 'active' : ''}">
        <span class="dot"></span><span>${s.label}</span>
      </div>`;
    }).join('');
  }

  async function start() {
    const desktop = document.getElementById('setupDesktop').checked;
    const start = document.getElementById('setupStart').checked;
    const taskbar = document.getElementById('setupTaskbar').checked;

    const btnInstall = document.getElementById('setupInstall');
    const btnSkip = document.getElementById('setupSkip');
    btnInstall.disabled = true;
    btnSkip.disabled = true;
    btnInstall.textContent = 'Installing…';

    const done = new Set();
    render(0, done);

    // step 0 — files
    await sleep(450);
    done.add('files');
    render(1, done);

    let result;
    try {
      result = await SB.ipc.setup.run({ desktop, startMenu: start, pinTaskbar: taskbar });
    } catch (e) {
      result = { ok: false, steps: [], error: String(e.message || e) };
    }

    // animate through the produced steps
    const order = ['desktop', 'start', 'taskbar', 'done'];
    for (let i = 0; i < order.length; i++) {
      await sleep(520);
      done.add(order[i]);
      render(Math.min(STEPS.length - 1, i + 2), done);
    }

    btnInstall.textContent = 'Launch Shine Browser';
    btnInstall.disabled = false;
    btnInstall.onclick = () => finish();

    const info = result && result.info;
    const notes = [];
    if (info) {
      notes.push(`Installed to ${info.installed ? 'Program Files' : 'your user profile'}`);
      notes.push(info.desktopShortcut ? 'Desktop shortcut ✓' : 'Desktop shortcut — created');
      notes.push(info.startMenuShortcut ? 'Start menu ✓' : 'Start menu — created');
    }
    if (result && result.pinned && /PINNED/.test(result.pinned)) notes.push('Pinned to taskbar ✓');
    document.getElementById('setupNote').textContent = notes.join('  ·  ') || 'Setup complete.';

    // persist that setup ran
    await SB.ipc.settings.set({ setupDone: true, firstRun: false });
  }

  function finish() {
    win().classList.add('hidden');
    SB.toast('Shine Browser is ready. Press Ctrl+Shift+S for the Shine split screen.');
  }

  function skip() {
    win().classList.add('hidden');
    SB.ipc.settings.set({ setupDone: true, firstRun: false });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function show() {
    win().classList.remove('hidden');
    render(0, new Set());
    const st = await SB.ipc.setup.status();
    if (st && st.desktopShortcut && st.startMenuShortcut && st.setupDone) {
      document.getElementById('setupNote').textContent =
        `Already installed (${st.installed ? 'stable' : 'dev'} build). Click Install to repair shortcuts.`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('setupInstall').addEventListener('click', start);
    document.getElementById('setupSkip').addEventListener('click', skip);
  });

  SB.setup = { show, hide: () => win().classList.add('hidden'), start };
})();
