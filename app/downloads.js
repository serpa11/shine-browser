// =====================================================================
// Shine Browser — downloads
// =====================================================================
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');

function init(s, list, notify) {
  s.on('will-download', (event, item) => {
    let dir = store.read('settings').downloadsPath;
    if (!dir || !fs.existsSync(dir)) dir = app.getPath('downloads');
    fs.mkdirSync(dir, { recursive: true });

    let filePath = path.join(dir, item.getFilename());
    let n = 1;
    while (fs.existsSync(filePath)) {
      const ext = path.extname(item.getFilename());
      const base = path.basename(item.getFilename(), ext);
      filePath = path.join(dir, `${base} (${n})${ext}`);
      n++;
    }
    item.setSavePath(filePath);

    const entry = {
      filename: item.getFilename(),
      path: filePath,
      url: item.getURL(),
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes() || 0,
      time: Date.now(),
    };
    list.unshift(entry);
    notify();

    item.on('updated', (e, state) => {
      entry.state = state;
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes() || entry.total;
      notify();
    });

    item.once('done', (e, state) => {
      entry.state = state;
      entry.received = item.getReceivedBytes();
      notify();
      store.add('downloads', Object.assign({}, entry), 1000);
    });
  });
}

module.exports = { init };
