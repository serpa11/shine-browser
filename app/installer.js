// =====================================================================
// Shine Browser — installer / setup window backend
// Creates the Desktop shortcut, Start Menu shortcut, pins the taskbar
// tile and records setup state. Used by the in-app setup window and by
// scripts/install.ps1 for a standalone install.
// =====================================================================
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const store = require('./store');

const isWin = process.platform === 'win32';

function runPs(script, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() })
    );
  });
}

function targetExe() {
  // In a packaged build the exe is the app itself; in dev it is the electron binary.
  if (app.isPackaged) return process.execPath;
  const electronBin = path.join(
    __dirname, '..', 'node_modules', '.bin',
    isWin ? 'electron.cmd' : 'electron'
  );
  return electronBin;
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// Windows 10/11 no longer expose "Pin to taskbar" through Shell verbs, and
// SendKeys/UI automation is unreliable. The TaskBar folder under the Quick
// Launch profile IS the canonical pin store — copying the .lnk there pins the
// app. Refresh the icon cache afterwards so Explorer picks it up immediately.
async function pinViaTaskbarFolder(shortcutName) {
  const taskBarDir = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'
  );
  const source = path.join(app.getPath('desktop'), `${shortcutName}.lnk`);
  const dest = path.join(taskBarDir, `${shortcutName}.lnk`);

  try {
    if (!fs.existsSync(taskBarDir)) {
      fs.mkdirSync(taskBarDir, { recursive: true });
    }
    if (!fs.existsSync(source)) return 'FAILED';
    fs.copyFileSync(source, dest);
    await runPs('ie4uinit.exe -show', 10000);
    return fs.existsSync(dest) ? 'PINNED' : 'FAILED';
  } catch (e) {
    return 'FAILED';
  }
}

function makeShortcutPs({ lnkPath, target, args, workingDir, icon, description }) {
  return `
$ErrorActionPreference='Stop'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut(${psQuote(lnkPath)})
$lnk.TargetPath = ${psQuote(target)}
if (${psQuote(args)}) { $lnk.Arguments = ${psQuote(args)} }
if (${psQuote(workingDir)}) { $lnk.WorkingDirectory = ${psQuote(workingDir)} }
if (${psQuote(icon)}) { $lnk.IconLocation = ${psQuote(icon)} }
if (${psQuote(description)}) { $lnk.Description = ${psQuote(description)} }
$lnk.Save()
Write-Output 'OK'
`;
}

async function ensureShortcuts(opts = {}) {
  if (!isWin) return { ok: false, error: 'Shortcuts are Windows-only' };
  const exe = targetExe();
  const exeDir = path.dirname(exe);
  const icon = app.isPackaged ? `${exe},0` : path.join(__dirname, '..', 'build', 'icon.ico');

  const desktop = path.join(app.getPath('desktop'), 'Shine Browser.lnk');
  const startMenu = path.join(
    app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Shine Browser.lnk'
  );
  const startMenuFolder = path.join(
    app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Shine Browser'
  );

  const desc = 'Shine Browser — browse with Shine AI side by side';

  const results = {};

  // Desktop + Start Menu shortcuts -----------------------------------------
  results.desktop = await runPs(makeShortcutPs({
    lnkPath: desktop, target: exe, args: '', workingDir: exeDir, icon, description: desc,
  }));

  try { fs.mkdirSync(startMenuFolder, { recursive: true }); } catch (e) { /* ignore */ }
  results.startMenu = await runPs(makeShortcutPs({
    lnkPath: path.join(startMenuFolder, 'Shine Browser.lnk'),
    target: exe, args: '', workingDir: exeDir, icon, description: desc,
  }));
  // Also place a flat shortcut directly in Programs for the Start menu search.
  results.startMenuFlat = await runPs(makeShortcutPs({
    lnkPath: startMenu, target: exe, args: '', workingDir: exeDir, icon, description: desc,
  }));

  // Pin to taskbar + Start (Windows 10/11) ---------------------------------
  if (opts.pinTaskbar !== false) {
    results.pinned = { stdout: await pinViaTaskbarFolder('Shine Browser') };
  }

  if (opts.pinStart !== false) {
    results.pinnedStart = await runPs(`
$ErrorActionPreference='SilentlyContinue'
$sh = New-Object -ComObject Shell.Application
$folder = $sh.Namespace('${startMenuFolder.replace(/'/g, "''")}')
$item = $folder.ParseName('Shine Browser.lnk')
if ($item) {
  $verb = $item.Verbs() | Where-Object { $_.Name -match 'Pin to Start|Start' } | Select-Object -First 1
  if ($verb) { $verb.DoIt() ; Write-Output 'PINNED_START' } else { Write-Output 'NO_VERB' }
} else { Write-Output 'NO_ITEM' }
`);
  }

  const ok = results.desktop.ok && results.startMenu.ok;
  const s = store.read('settings');
  s.setupDone = true;
  s.firstRun = false;
  store.write('settings', s);

  return {
    ok,
    desktop: { path: desktop, ok: results.desktop.ok },
    startMenu: { path: startMenuFolder, ok: results.startMenu.ok },
    pinned: results.pinned ? results.pinned.stdout : '',
    pinnedStart: results.pinnedStart ? results.pinnedStart.stdout : '',
    exe,
  };
}

function status() {
  const s = store.read('settings');
  const exe = targetExe();
  const desktop = path.join(app.getPath('desktop'), 'Shine Browser.lnk');
  const startMenuFolder = path.join(
    app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Shine Browser'
  );
  return {
    setupDone: !!s.setupDone,
    firstRun: !!s.firstRun,
    exe,
    installed: app.isPackaged,
    desktopShortcut: isWin && fs.existsSync(desktop),
    startMenuShortcut: isWin && fs.existsSync(startMenuFolder),
    version: app.getVersion(),
    userData: app.getPath('userData'),
    platform: process.platform,
  };
}

async function run(opts) {
  const steps = [];
  const r1 = await ensureShortcuts(opts);
  steps.push({ key: 'desktop', label: 'Desktop shortcut', ok: r1.ok, detail: r1.desktop && r1.desktop.path });
  steps.push({ key: 'start', label: 'Start menu shortcut', ok: r1.ok, detail: r1.startMenu && r1.startMenu.path });
  steps.push({
    key: 'taskbar',
    label: 'Taskbar pin',
    ok: /PINNED/.test(r1.pinned || ''),
    detail: /PINNED/.test(r1.pinned || '')
      ? 'Pinned to taskbar'
      : 'Pin attempted — right-click the Desktop shortcut → Pin to taskbar if it is missing',
  });
  return { ok: r1.ok, steps, info: status() };
}

module.exports = { ensureShortcuts, status, run, targetExe };
