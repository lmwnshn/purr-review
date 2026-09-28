import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchChrome } from './chrome.mjs';

const root = new URL('../', import.meta.url);
const url = (await readFile(new URL('dist/bookmarklet-mobile.txt', root), 'utf8')).trim();
const bundle = await readFile(new URL('dist/purr-review.js', root), 'utf8');
let page;
let failLoad = false;
const requests = [];
const alerts = [];
before(async () => {
  page = await launchChrome();
  await page.call('Fetch.enable', { patterns: [{ urlPattern: 'https://wanshenl.me/purr-review/dist/*', requestStage: 'Request' }] });
  page.on('Fetch.requestPaused', async event => {
    requests.push(event.request);
    if (failLoad) await page.call('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
    else await page.call('Fetch.fulfillRequest', {
      requestId: event.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(bundle).toString('base64'),
    });
  });
  page.on('Page.javascriptDialogOpening', async event => {
    alerts.push(event.message);
    await page.call('Page.handleJavaScriptDialog', { accept: true });
  });
});
after(async () => { await page?.close(); });

async function fixture() {
  await page.navigate(new URL('demo/index.html', root).href);
  await page.until('Boolean(window.demo)', 'demo loaded');
}

test('installer offers one hosted bookmark and copies its complete URL', async () => {
  assert.ok(url.length < 2000);
  await page.navigate(new URL('index.html', root).href);
  await page.until('Boolean(document.querySelector("[data-copy-target]"))', 'installer loaded');
  await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedBookmark = value; } } })`);
  assert.equal(await page.evaluate(`document.querySelectorAll('a.install').length`), 1);
  assert.equal(await page.evaluate(`document.querySelectorAll('[data-copy-target]').length`), 1);
  assert.equal(await page.evaluate(`document.getElementById('install').getAttribute('href')`), url);
  assert.equal(await page.evaluate(`document.getElementById('bookmarklet-code').value`), url);
  await page.evaluate(`document.querySelector('[data-copy-target]').click()`);
  await page.until('typeof window.copiedBookmark === "string"', 'copied');
  assert.equal(await page.evaluate('window.copiedBookmark'), url);
  assert.match(await page.evaluate(`document.querySelector('.copy-status').textContent`), /^Copied/);
  assert.equal(await page.evaluate(`Boolean(document.querySelector('a[href="https://github.com/lmwnshn/purr-review/blob/main/dist/bookmarklet.txt"]'))`), true);
});

test('short javascript URL launches the app, submits a bid, and reuses the active instance', async () => {
  await fixture();
  await page.evaluate(`window.originalAppend = document.documentElement.append.bind(document.documentElement);document.documentElement.append = (...nodes) => { for (const node of nodes) if (node.id === 'purr-review-loader') window.loaderPrivacy = { referrerPolicy: node.referrerPolicy, crossOrigin: node.crossOrigin }; return window.originalAppend(...nodes); }`);
  const before = requests.length;
  await page.navigate(url);
  await page.until('Boolean(window.__PURR_REVIEW__)', 'loader launched');
  assert.equal(requests.length, before + 1);
  const firstURL = new URL(requests.at(-1).url);
  assert.equal(firstURL.origin + firstURL.pathname, 'https://wanshenl.me/purr-review/dist/purr-review.js');
  assert.match(firstURL.searchParams.get('t'), /^\d+$/);
  assert.ok(!Object.keys(requests.at(-1).headers).some(key => /^(referer|cookie)$/i.test(key)));
  assert.deepEqual(await page.evaluate('window.loaderPrivacy'), { referrerPolicy: 'no-referrer', crossOrigin: 'anonymous' });
  assert.equal(await page.evaluate('Boolean(document.getElementById("purr-review-loader"))'), false);
  await page.key('ArrowRight');
  await page.until('demo.outcomes.length === 1 && !window.__PURR_REVIEW__.diagnostics().session.busy', 'bid confirmed');
  assert.equal(await page.evaluate('demo.outcomes[0].bid'), 'Willing');
  await page.navigate(url);
  assert.equal(requests.length, before + 1);
  assert.equal(await page.evaluate('window.__PURR_REVIEW__.diagnostics().session.history'), 1);
  await page.evaluate('window.__PURR_REVIEW__.destroy()');
  await page.navigate(url);
  await page.until('Boolean(window.__PURR_REVIEW__)', 'fresh launch');
  assert.equal(requests.length, before + 2);
  assert.notEqual(requests.at(-1).url, firstURL.href);
});

test('blocked script download reports a visible error and permits retry', async () => {
  await fixture();
  failLoad = true;
  const before = alerts.length;
  await page.navigate(url);
  for (let i = 0; alerts.length === before && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alerts.length, before + 1);
  assert.match(alerts.at(-1), /could not load/);
  assert.equal(await page.evaluate('Boolean(document.getElementById("purr-review-loader"))'), false);
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  failLoad = false;
  await page.navigate(url);
  await page.until('Boolean(window.__PURR_REVIEW__)', 'retry launched');
});
