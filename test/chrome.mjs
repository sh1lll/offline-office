// Opens the app in headless Chrome for the browser tests, talking to Chrome's DevTools protocol over
// Node's built-in WebSocket (Node 22+), so no test dependencies are needed.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CHROME = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p));

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export async function open(page, { width = 1280, height = 860, dark = false } = {}) {
  // Static server for the app folder, like any web host.
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
      /^(\.\.[/\\])+/,
      '',
    );
    try {
      const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const profile = await mkdtemp(join(tmpdir(), 'oo-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    'about:blank',
  ]);
  const wsUrl = await new Promise((res, rej) => {
    let err = '';
    chrome.stderr.on('data', (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) res(m[1]);
    });
    chrome.on('exit', () => rej(new Error('Chrome exited: ' + err)));
  });
  const port = new URL(wsUrl).port;
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const waiting = new Map(),
    events = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) events.push(msg);
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      waiting.set(++id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  await send('Network.enable');
  const view = async (o) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: o.width,
      height: o.height,
      deviceScaleFactor: 1,
      mobile: o.width < 600,
    });
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: o.dark ? 'dark' : 'light' }],
    });
  };
  await view({ width, height, dark });
  const base = `http://127.0.0.1:${server.address().port}/`;
  async function go(p) {
    await send('Page.enable');
    const loaded = new Promise((r) => {
      const t = setInterval(
        () => events.some((e) => e.method === 'Page.loadEventFired') && (clearInterval(t), r()),
        20,
      );
    });
    events.length = 0;
    await send('Page.navigate', { url: base + p });
    await loaded;
    // The single-file build unpacks and starts the app just after the page loads.
    await run(
      `while (typeof Mods === 'undefined' || !Mods.addons) await new Promise((r) => setTimeout(r, 5));`,
    );
  }
  // Runs an async function body in the page and returns its JSON-able result.
  async function run(body) {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  const shot = async () =>
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  // Requests that left the machine: anything not to the local test server or data:/blob:.
  const external = () =>
    events
      .filter((e) => e.method === 'Network.requestWillBeSent')
      .map((e) => e.params.request.url)
      .filter((u) => !u.startsWith(base) && !/^(data|blob):/.test(u));
  await go(page);
  return {
    run,
    go,
    shot,
    view,
    external,
    async close() {
      ws.close();
      chrome.kill();
      server.close();
      await new Promise((r) => chrome.once('exit', r));
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
