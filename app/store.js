// =====================================================================
// Shine Browser — data store (bookmarks, history, downloads, extensions,
// settings, profile) persisted as JSON inside the Electron userData dir.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dir = app.getPath('userData');
const files = {
  bookmarks: path.join(dir, 'bookmarks.json'),
  history: path.join(dir, 'history.json'),
  downloads: path.join(dir, 'downloads.json'),
  extensions: path.join(dir, 'extensions.json'),
  settings: path.join(dir, 'settings.json'),
  profile: path.join(dir, 'profile.json'),
};

const DEFAULTS = {
  bookmarks: [],
  history: [],
  downloads: [],
  extensions: [],
  settings: {
    searchEngine: 'google',
    homepage: 'https://shineai-9mr.pages.dev',
    theme: 'dark',
    downloadsPath: '',
    zoomFactor: 1,
    panelWidth: 0.42,
    panelOpen: false,
    setupDone: false,
    firstRun: true,
  },
  profile: { name: 'Person 1', avatar: 'S' },
};

function read(key) {
  try {
    if (!fs.existsSync(files[key])) return DEFAULTS[key];
    const raw = JSON.parse(fs.readFileSync(files[key], 'utf8'));
    if (key === 'settings') return Object.assign({}, DEFAULTS.settings, raw);
    return raw;
  } catch (e) {
    return DEFAULTS[key];
  }
}

function write(key, value) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(files[key], JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('store write failed', key, e);
    return false;
  }
}

// generic collection helpers -------------------------------------------------
function list(key) {
  return read(key);
}
function add(key, item, limit = 5000) {
  const arr = read(key);
  arr.unshift(item);
  if (arr.length > limit) arr.length = limit;
  write(key, arr);
  return item;
}
function remove(key, predicate) {
  const arr = read(key).filter((x) => !predicate(x));
  write(key, arr);
  return arr;
}
function update(key, predicate, patch) {
  const arr = read(key).map((x) => (predicate(x) ? Object.assign({}, x, patch) : x));
  write(key, arr);
  return arr;
}

module.exports = { dir, files, read, write, list, add, remove, update, DEFAULTS };
