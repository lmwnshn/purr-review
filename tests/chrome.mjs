import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function launchChrome() {
  const profile = await mkdtemp(join(tmpdir(), 'purr-review-tests-'));
  const executable = process.env.CHROME_PATH || 'google-chrome';
  const child = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start. Set CHROME_PATH to a local Chrome or Chromium executable. ' + output)), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Chrome exited with ' + code + ': ' + output)); });
    child.stderr.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextID = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(new Error(data.error.message));
      else request.resolve(data.result);
    } else {
      for (const callback of listeners.get(data.method) || []) callback(data.params);
    }
  });
  function send(method, params = {}, sessionId) {
    const id = ++nextID;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 25000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  const page = {
    call,
    on(method, callback) { const list = listeners.get(method) || []; list.push(callback); listeners.set(method, list); },
    async evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    async navigate(url) { await call('Page.navigate', { url }); },
    async until(expression, message, timeout = 8000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await page.evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      throw new Error('Timed out: ' + message);
    },
    async key(key, extra = {}) {
      const codes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Escape: 27, Enter: 13, z: 90, s: 83 };
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: codes[key], ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}), ...extra });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: codes[key] });
    },
    async screenshot(path) {
      const { writeFile } = await import('node:fs/promises');
      const result = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(result.data, 'base64'));
    },
    async close() {
      try { await send('Browser.close'); } catch {  }
      socket.close();
      child.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 200));
      await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  };
  return page;
}
