// Dev tool: launch the built app with remote debugging and drive it over CDP (no extra dependencies).
//   node tools/drive.mjs <scenario.mjs>
// The scenario module default-exports async ({ eval, shot, wait, key, type }) => {...}
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 9333;
const electron = process.env.BNC_EXE || join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scenarioPath = resolve(process.argv[2]);
const extraArgs = process.argv.slice(3);

const child = spawn(electron, [...(process.env.BNC_EXE ? [] : [root]), `--remote-debugging-port=${port}`, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', (d) => (logs += d));
child.stderr.on('data', (d) => (logs += d));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'));
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('Electron did not expose a debug target.\n' + logs);
}

try {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleLines.push('[exception] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');

  const api = {
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    async shot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      return file;
    },
    wait: sleep,
    async key(key, opts = {}) {
      const base = { key, code: opts.code ?? key, windowsVirtualKeyCode: opts.vk ?? 0, modifiers: opts.modifiers ?? 0 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: opts.text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async type(text) {
      await send('Input.insertText', { text });
    },
    async click(x, y, clickCount = 1) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    },
    async mouse(type, x, y, extra = {}) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
    },
    async drag(x1, y1, x2, y2, steps = 8, extra = {}) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none', ...extra });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1, ...extra });
      for (let i = 1; i <= steps; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: 'left', buttons: 1, ...extra });
        await sleep(12);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1, ...extra });
    },
    async resize(width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    },
    console: () => consoleLines,
    logs: () => logs,
  };
  await sleep(2500);
  const scenario = (await import(pathToFileURL(scenarioPath).href)).default;
  await scenario(api);
  if (consoleLines.length) console.log('--- console ---\n' + consoleLines.join('\n'));
  ws.close();
} catch (e) {
  console.error('DRIVE ERROR:', e.message);
  console.error(logs.slice(-2000));
  process.exitCode = 1;
} finally {
  child.kill();
}

