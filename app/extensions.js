// =====================================================================
// Shine Browser — extensions
// Loads real Chrome/MV3 extensions into the browser session and lets
// users install from the Chrome Web Store (.crx) or unpacked folders.
// =====================================================================
const { session, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const EXT_DIR = () => path.join(app.getPath('userData'), 'extensions');
let mainSession = null;

function init(s) {
  mainSession = s;
  fs.mkdirSync(EXT_DIR(), { recursive: true });

  // Any .crx downloaded through the Chrome Web Store gets auto-installed.
  mainSession.on('will-download', (e, item) => {
    const name = item.getFilename();
    if (/\.crx$/i.test(name)) {
      const dest = path.join(EXT_DIR(), name);
      item.setSavePath(dest);
      item.once('done', (ev, state) => {
        if (state === 'completed') installCrx(dest);
      });
    }
  });

  // Restore previously installed extensions on startup.
  const installed = store.read('extensions');
  installed.forEach((ext) => {
    try {
      if (ext.dir && fs.existsSync(path.join(ext.dir, 'manifest.json'))) {
        mainSession.loadExtension(ext.dir, { allowFileAccess: true }).then((loaded) => {
          ext.id = loaded.id;
          ext.name = loaded.name || ext.name;
          ext.version = loaded.version || ext.version;
          store.write('extensions', installed);
        }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  });
}

function liveExtensions(s) {
  try {
    if (s.extensions && typeof s.extensions.getAllExtensions === 'function') {
      return s.extensions.getAllExtensions();
    }
  } catch (e) { /* fall through */ }
  try { return s.getAllExtensions(); } catch (e) { return []; }
}

function list() {
  const installed = store.read('extensions');
  const loaded = liveExtensions(mainSession);
  return installed.map((ext) => {
    const live = loaded.find((l) => l.id === ext.id || path.resolve(l.path) === path.resolve(ext.dir || ''));
    return Object.assign({}, ext, {
      loaded: !!live,
      version: live ? live.version : ext.version,
      name: live ? live.name : ext.name,
      id: live ? live.id : ext.id,
    });
  });
}

async function loadUnpacked() {
  const win = require('electron').BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Load unpacked extension',
    properties: ['openDirectory'],
    buttonLabel: 'Load extension',
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  const dir = filePaths[0];
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    return { ok: false, error: 'That folder has no manifest.json — not a valid extension.' };
  }
  return installDir(dir);
}

function installDir(dir) {
  return new Promise((resolve) => {
    mainSession
      .loadExtension(dir, { allowFileAccess: true })
      .then((ext) => {
        const installed = store.read('extensions');
        if (!installed.some((e) => e.id === ext.id)) {
          installed.unshift({
            id: ext.id,
            name: ext.name || path.basename(dir),
            version: ext.version || '1.0',
            dir,
            enabled: true,
            time: Date.now(),
          });
          store.write('extensions', installed);
        }
        resolve({ ok: true, id: ext.id, name: ext.name });
      })
      .catch((err) => resolve({ ok: false, error: String(err.message || err) }));
  });
}

function installCrx(crxPath) {
  try {
    const AdmZip = require('adm-zip');
    const buf = fs.readFileSync(crxPath);
    // CRX3 header: magic 'Cr24' + version(4) + headerSize(4) then zip data
    let zipStart = 0;
    if (buf.slice(0, 4).toString('latin1') === 'Cr24') {
      const version = buf.readUInt32LE(4);
      const headerSize = buf.readUInt32LE(8);
      zipStart = 12 + (version === 3 ? headerSize : version === 2 ? buf.readUInt32LE(8) : 0);
    }
    const zip = new AdmZip(buf.slice(zipStart));
    const name = path.basename(crxPath, '.crx');
    const dest = path.join(EXT_DIR(), name);
    zip.extractAllTo(dest, true);
    installDir(dest);
  } catch (e) {
    console.error('crx install failed', e);
  }
}

async function remove(id) {
  const installed = store.read('extensions');
  const target = installed.find((e) => e.id === id);
  if (target) {
    try { await mainSession.removeExtension(target.id); } catch (e) { /* ignore */ }
    try { if (target.dir && target.dir.startsWith(EXT_DIR())) fs.rmSync(target.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  const next = installed.filter((e) => e.id !== id);
  store.write('extensions', next);
  return { ok: true, extensions: next };
}

function toggle(id) {
  const installed = store.read('extensions');
  const ext = installed.find((e) => e.id === id);
  if (!ext) return { ok: false };
  ext.enabled = !ext.enabled;
  store.write('extensions', installed);
  return { ok: true, enabled: ext.enabled };
}

// Called whenever a tab view is attached so extension downloads are caught.

module.exports = { init, list, loadUnpacked, remove, toggle, installCrx, EXT_DIR };
