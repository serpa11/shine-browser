// =====================================================================
// Shine Browser — PC Control: installed apps, system info, launching,
// screenshots and process listing. Powering the "PC Control" section
// inside the Shine split-screen panel.
// =====================================================================
const { execFile, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, desktopCapturer } = require('electron');

const POWERSHELL = 'powershell.exe';

// execFile passes the script as a single argument with NO shell in between,
// so PowerShell receives it verbatim — no quote/backslash escaping games.
function runPs(script, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', String(script)],
      { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : (stdout || '').trim())
    );
  });
}

function shellRun(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, () => resolve());
  });
}

// ---- installed apps --------------------------------------------------------
let appCache = null;

async function listApps(force) {
  if (appCache && !force) return appCache;

  const script = `
$ErrorActionPreference='SilentlyContinue'
$paths = @(
  'HKLM:\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$out = @()
Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and -not $_.SystemComponent } |
  ForEach-Object { $out += [PSCustomObject]@{ n = $_.DisplayName; l = $_.InstallLocation; p = $_.DisplayIcon } }
$out | Sort-Object n -Unique | ConvertTo-Json -Compress
`;

  const apps = [];
  try {
    const out = await runPs(script, 25000);
    if (out) {
      const parsed = JSON.parse(out);
      (Array.isArray(parsed) ? parsed : [parsed]).forEach((a) => {
        if (a && a.n) apps.push({ name: a.n, location: a.l || '', icon: a.p || '' });
      });
    }
  } catch (e) { /* registry parse failure — Start Menu scan below still runs */ }

  // Start Menu scan so every installed app appears even without registry entries.
  try {
    const menus = [
      path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(process.env.ProgramData || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ];
    const seen = new Set(apps.map((a) => a.name.toLowerCase()));
    const walk = (root, depth) => {
      if (depth > 4) return;
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return; }
      for (const ent of entries) {
        const full = path.join(root, ent.name);
        if (ent.isDirectory()) {
          walk(full, depth + 1);
        } else if (ent.name.toLowerCase().endsWith('.lnk')) {
          const name = ent.name.replace(/\.lnk$/i, '');
          if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            apps.push({ name, location: full, shortcut: true });
          }
        }
      }
    };
    menus.forEach((m) => m && walk(m, 0));
  } catch (e) { /* ignore */ }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  appCache = apps;
  return apps;
}

function findApp(name) {
  const q = String(name || '').toLowerCase().trim();
  return appCache ? appCache.find((a) => a.name.toLowerCase() === q) : null;
}

function fuzzyApp(name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q || !appCache) return null;
  return (
    appCache.find((a) => a.name.toLowerCase() === q) ||
    appCache.find((a) => a.name.toLowerCase().startsWith(q)) ||
    appCache.find((a) => a.name.toLowerCase().includes(q)) ||
    null
  );
}

// ---- launching -------------------------------------------------------------
async function launchApp(name) {
  const target = String(name || '').trim();
  if (!target) return { ok: false, error: 'No app name given' };
  if (!appCache) await listApps();

  const exact = findApp(target);
  const app = exact || fuzzyApp(target);

  // 1. .lnk shortcut straight through the shell
  if (app && app.shortcut && app.location) {
    await shellRun(`start "" "${app.location.replace(/"/g, '')}"`);
    return { ok: true, method: 'shortcut', name: app.name };
  }
  // 2. direct executable / console file from the registry
  if (app && app.location && /\.(exe|msc|bat|cmd)$/i.test(app.location)) {
    await shellRun(`start "" "${app.location.replace(/"/g, '')}"`);
    return { ok: true, method: 'install', name: app.name };
  }

  // 3. Start Apps alias (covers Store apps and anything without a registry entry)
  const q = target.replace(/'/g, "''");
  const alias = await runPs(
    `(Get-StartApps | Where-Object { $_.Name -like '*${q}*' } | Select-Object -First 1).AppID`
  );
  if (alias) {
    await runPs(`Start-Process 'shell:AppsFolder\\${alias.replace(/'/g, '')}'`);
    return { ok: true, method: 'alias', name: target };
  }

  // 4. treat it as a plain command / exe on PATH
  await runPs(`Start-Process '${q}'`);
  if (app) return { ok: true, method: 'command', name: app.name };
  return { ok: true, method: 'command', name: target };
}

// ---- system details --------------------------------------------------------
async function sysInfo() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const diskOut = await runPs(
    "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { '{0}|{1}|{2}' -f $_.DeviceID, [math]::Round($_.Size/1GB), [math]::Round($_.FreeSpace/1GB) }"
  );
  const disks = diskOut
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [letter, size, free] = l.split('|');
      return { letter, sizeGB: Number(size) || 0, freeGB: Number(free) || 0 };
    });

  const caption = await runPs('(Get-CimInstance Win32_OperatingSystem).Caption');
  const uptimeSec = os.uptime();

  return {
    os: caption || `${os.type()} ${os.release()}`,
    platform: process.platform,
    arch: os.arch(),
    hostname: os.hostname(),
    user: os.userInfo().username,
    cpu: {
      model: cpus[0] ? cpus[0].model.trim() : 'Unknown',
      cores: os.cpus().length,
      speedMHz: cpus[0] ? cpus[0].speed : 0,
    },
    memory: {
      totalGB: +(totalMem / 1073741824).toFixed(1),
      usedGB: +((totalMem - freeMem) / 1073741824).toFixed(1),
      freeGB: +(freeMem / 1073741824).toFixed(1),
      usagePct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    disks,
    uptime: uptimeSec,
    uptimeHuman: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    now: new Date().toISOString(),
  };
}

async function processes() {
  const out = await runPs(
    "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 40 Name, Id, @{n='memMB';e={[math]::Round($_.WorkingSet64/1MB)}} | ConvertTo-Json -Compress",
    20000
  );
  try {
    const parsed = JSON.parse(out || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((p) => p && p.Name)
      .map((p) => ({ name: p.Name, memMB: p.memMB || 0, pid: p.Id }));
  } catch (e) {
    return [];
  }
}

// ---- screenshot ------------------------------------------------------------
async function screenshot() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    const primary = sources[0];
    if (!primary) return { ok: false, error: 'No screen source found' };
    const dir = path.join(app.getPath('pictures'), 'Shine Screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `shine-${Date.now()}.png`);
    fs.writeFileSync(file, primary.thumbnail.toPNG());
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ---- open in explorer ------------------------------------------------------
async function revealPath(p) {
  if (!p || !fs.existsSync(p)) return { ok: false, error: 'Path not found' };
  await shellRun(`explorer "${p.replace(/"/g, '')}"`);
  return { ok: true };
}

module.exports = { listApps, launchApp, sysInfo, processes, screenshot, revealPath, findApp };
