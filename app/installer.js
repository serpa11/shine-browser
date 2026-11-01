// =====================================================================
// Shine Browser — installer / setup window backend
//
// Installs the packaged build into %LOCALAPPDATA%\Shine Browser and
// creates the Desktop / Start menu shortcuts plus the taskbar pin.
// Shortcuts always point at a real GUI .exe (never electron.cmd), so
// double-clicking them never flashes a console window.
// =====================================================================
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const store = require('./store');

const isWin = process.platform === 'win32';
const APP_NAME = 'Shine Browser';

function runPs(script, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', String(script)],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve({ ok: !err, out: (stdout || '').trim() })
    );
  });
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function localAppData() {
  // app.getPath('localAppData') is not resolvable in every Electron build,
  // so fall back to the environment / derive it from appData.
  try {
    const p = app.getPath('localAppData');
    if (p) return p;
  } catch (e) { /* fall through */ }
  if (process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
  return path.join(app.getPath('appData'), '..', 'Local');
}

function installDir() {
  return path.join(localAppData(), APP_NAME);
}

// Packaged build produced by `npm run pack` / `npm run dist`.
function sourceBuild() {
  const unpacked = path.join(__dirname, '..', 'dist', 'win-unpacked');
  const exe = path.join(unpacked, `${APP_NAME}.exe`);
  if (fs.existsSync(exe)) return { dir: unpacked, exe, packaged: true };
  return null;
}

// Where a shortcut should point. Packaged builds copy files first; the dev
// fallback points at the real Electron GUI binary (not electron.cmd).
function targetExe() {
  const build = sourceBuild();
  if (build) return build.exe;
  if (app.isPackaged) return process.execPath;
  const electronExe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  return fs.existsSync(electronExe) ? electronExe : process.execPath;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true, dereference: true });
}

function makeShortcutPs({ lnkPath, target, workingDir, icon, description }) {
  return `
$ErrorActionPreference='Stop'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut(${psQuote(lnkPath)})
$lnk.TargetPath = ${psQuote(target)}
$lnk.WorkingDirectory = ${psQuote(workingDir)}
$lnk.IconLocation = ${psQuote(icon)}
$lnk.Description = ${psQuote(description)}
$lnk.Save()
Write-Output 'OK'
`;
}

// Windows 10/11 no longer expose "Pin to taskbar" through Shell verbs.
// The TaskBar folder under the Quick Launch profile is the canonical pin
// store — copying the .lnk there pins the app.
async function pinToTaskbar(desktopLnk) {
  const taskBarDir = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'
  );
  const dest = path.join(taskBarDir, `${APP_NAME}.lnk`);
  try {
    fs.mkdirSync(taskBarDir, { recursive: true });
    if (!fs.existsSync(desktopLnk)) return 'FAILED';
    fs.copyFileSync(desktopLnk, dest);
    await runPs('ie4uinit.exe -show', 10000);
    return fs.existsSync(dest) ? 'PINNED' : 'FAILED';
  } catch (e) {
    return 'FAILED';
  }
}

async function ensureShortcuts(opts = {}) {
  const steps = [];
  const results = { desktop: null, startMenu: null, pinned: '' };

  const exe = targetExe();
  const exeDir = path.dirname(exe);
  const icon = `${exe},0`;
  const desc = 'Shine Browser — browse with Shine AI side by side';

  const desktopLnk = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
  const startDir = path.join(
    app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', APP_NAME
  );
  const startLnk = path.join(startDir, `${APP_NAME}.lnk`);
  const startFlat = path.join(
    app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`
  );

  // 1. copy application files -------------------------------------------
  if (opts.copyFiles !== false) {
    const build = sourceBuild();
    const dest = installDir();
    steps.push({ key: 'files', label: 'Copy application files' });
    if (build) {
      try {
        if (path.resolve(build.dir) !== path.resolve(dest)) {
          copyDir(build.dir, dest);
        }
        results.installedTo = dest;
      } catch (e) {
        steps[steps.length - 1].error = String(e.message || e);
      }
    } else if (app.isPackaged) {
      // already running from an installed location
      results.installedTo = exeDir;
    } else {
      steps[steps.length - 1].note = 'using source build (run npm run pack to install a copy)';
      results.installedTo = exeDir;
    }
    // shortcuts must point at the installed exe
    const installedExe = fs.existsSync(path.join(dest, `${APP_NAME}.exe`))
      ? path.join(dest, `${APP_NAME}.exe`)
      : exe;
    results.exe = installedExe;
    results.exeDir = path.dirname(installedExe);
    results.icon = `${installedExe},0`;
  }

  const finalExe = results.exe || exe;
  const finalDir = results.exeDir || exeDir;
  const finalIcon = results.icon || icon;

  // 2. desktop shortcut ---------------------------------------------------
  if (opts.desktop !== false) {
    steps.push({ key: 'desktop', label: 'Desktop shortcut' });
    const r = await runPs(makeShortcutPs({
      lnkPath: desktopLnk, target: finalExe, workingDir: finalDir, icon: finalIcon, description: desc,
    }));
    results.desktop = { path: desktopLnk, ok: r.ok && fs.existsSync(desktopLnk) };
    if (!results.desktop.ok) steps[steps.length - 1].error = 'could not create shortcut';
  }

  // 3. start menu shortcut ------------------------------------------------
  if (opts.startMenu !== false) {
    steps.push({ key: 'start', label: 'Start menu shortcut' });
    try { fs.mkdirSync(startDir, { recursive: true }); } catch (e) { /* ignore */ }
    const r1 = await runPs(makeShortcutPs({
      lnkPath: startLnk, target: finalExe, workingDir: finalDir, icon: finalIcon, description: desc,
    }));
    const r2 = await runPs(makeShortcutPs({
      lnkPath: startFlat, target: finalExe, workingDir: finalDir, icon: finalIcon, description: desc,
    }));
    results.startMenu = {
      path: startDir,
      ok: (r1.ok && fs.existsSync(startLnk)) || (r2.ok && fs.existsSync(startFlat)),
    };
    if (!results.startMenu.ok) steps[steps.length - 1].error = 'could not create shortcut';
  }

  // 4. taskbar pin --------------------------------------------------------
  if (opts.pinTaskbar !== false) {
    steps.push({ key: 'taskbar', label: 'Pin to taskbar' });
    if (fs.existsSync(desktopLnk)) {
      results.pinned = await pinToTaskbar(desktopLnk);
      if (results.pinned !== 'PINNED') {
        steps[steps.length - 1].error = 'pin attempted — right-click the Desktop shortcut → Pin to taskbar';
      }
    } else {
      results.pinned = 'FAILED';
      steps[steps.length - 1].error = 'needs a Desktop shortcut first';
    }
  }

  const ok = results.desktop === null || results.desktop.ok;
  const s = store.read('settings');
  s.setupDone = true;
  s.firstRun = false;
  store.write('settings', s);

  return { ok, steps, installedTo: results.installedTo || finalDir, exe: finalExe, pinned: results.pinned };
}

function status() {
  const s = store.read('settings');
  const build = sourceBuild();
  const desktopLnk = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
  const startDir = path.join(
    app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', APP_NAME
  );
  return {
    setupDone: !!s.setupDone,
    firstRun: !!s.firstRun,
    hasBuild: !!build || app.isPackaged,
    buildPath: build ? build.exe : null,
    installDir: installDir(),
    exe: targetExe(),
    desktopShortcut: isWin && fs.existsSync(desktopLnk),
    startMenuShortcut: isWin && fs.existsSync(startDir),
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
  };
}

async function run(opts) {
  try {
    return await ensureShortcuts(opts || {});
  } catch (e) {
    return { ok: false, steps: [], error: String(e.message || e) };
  }
}

module.exports = { ensureShortcuts, status, run, targetExe, installDir };
