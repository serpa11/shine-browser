// Tiny CDP helper: node scripts/cdp.js "<js expression>"
// Connects to the running app (start with --remote-debugging-port=9222),
// evaluates the expression inside the app's chrome renderer and prints it.
const PORT = process.env.CDP_PORT || 9222;

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

async function main() {
  const args = process.argv.slice(2);
  // Optional: node scripts/cdp.js "<js>" "<url substring>" picks the target.
  const want = args.length > 1 ? args[args.length - 1] : null;
  const expr = want ? args.slice(0, -1).join(' ') : args.join(' ');
  if (!expr) {
    const list = await targets();
    console.log(list.map((t) => `${t.type} | ${t.title.slice(0, 40)} | ${t.url.slice(0, 90)}`).join('\n'));
    return;
  }
  const list = await targets();
  const page =
    (want && list.find((t) => t.type === 'page' && t.url.includes(want))) ||
    // Prefer the chrome window (renderer/index.html) where the SB global lives.
    list.find((t) => t.type === 'page' && /renderer[\\/]index\.html/.test(t.url)) ||
    list.find((t) => t.type === 'page' && t.url.startsWith('file:')) ||
    list.find((t) => t.type === 'page') || list[0];
  if (!page) throw new Error('no target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const result = await new Promise((resolve, reject) => {
    const id = 1;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
  });

  const r = result.result;
  if (r.exceptionDetails) console.log('EXCEPTION: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  else console.log(typeof r.value === 'object' ? JSON.stringify(r.value, null, 2) : String(r.value));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
