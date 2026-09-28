import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchChrome } from './chrome.mjs';

const root = new URL('../', import.meta.url);
const demoURL = new URL('demo/index.html', root).href;
const adapterSource = await readFile(new URL('src/adapter.js', root), 'utf8');
let page;
const shadow = 'document.getElementById("purr-review-root").shadowRoot';
const anchor = id => `document.querySelector('tr[bidding="${id}"] a[title="Click to change bid"]')`;
const click = action => `${shadow}.querySelector('[data-action="${action}"]').click()`;
const paperItem = id => `${shadow}.querySelector('.paper-item[data-paper-id="${id}"]')`;

before(async () => { page = await launchChrome(); });
after(async () => { await page?.close(); });

async function fixture() {
  await page.navigate(demoURL + '?test=' + Date.now());
  await page.until('Boolean(window.demo && document.querySelectorAll("tr[bidding]").length === 7)', 'load synthetic CMT fixture');
}
async function adapter() {
  await fixture();
  await page.evaluate(`window.adapter = (() => { ${adapterSource}\n return createCMTAdapter(); })(); window.papers = adapter.discoverPapers();`);
}
async function launch(content) {
  await fixture();
  if (content) await page.evaluate(`(() => { const row = document.querySelector('tr[bidding="101"]'); row.querySelector('[data-bind="text: title"]').textContent = ${JSON.stringify(content.title)}; row.querySelector('[data-bind="text: abstract"]').textContent = ${JSON.stringify(content.abstract)}; })()`);
  await startApp();
}
async function startApp() {
  await page.evaluate('document.getElementById("launch").click()');
  await page.until('Boolean(window.__PURR_REVIEW__ && document.getElementById("purr-review-root")?.shadowRoot)', 'launch app');
}
async function settle(count, timeout = 9000) {
  await page.until(`window.demo.outcomes.length >= ${count}`, 'CMT simulated response', timeout);
}
async function errorOf(expression) {
  return page.evaluate(`(async () => { try { await (${expression}); return null; } catch (error) { return error.message; } })()`);
}

test('semantic header grid extracts live rows, hidden abstracts, existing bids and conflicts', async () => {
  await adapter();
  const papers = await page.evaluate('papers.map(({id,title,abstract,topics,bid,disabled,disabledReason,metadata}) => ({id,title,abstract,topics,bid,disabled,disabledReason,metadata}))');
  assert.equal(papers.length, 7);
  assert.equal(papers[0].id, '101');
  assert.equal(papers[0].title, 'Test paper 001');
  assert.match(papers[0].abstract, /^Synthetic abstract A/);
  assert.equal(papers[1].abstract, '');
  assert.ok(papers[2].title.length > 200);
  assert.equal(papers[5].title, 'Test paper 006: A & B < C > D');
  assert.deepEqual(await page.evaluate('(({track, primarySubject, secondarySubjects, relevance, tpmsRank}) => ({track, primarySubject, secondarySubjects, relevance, tpmsRank}))(papers[0])'), {
    track: 'Test track', primarySubject: 'Synthetic topic A', secondarySubjects: ['Synthetic topic B', 'Synthetic topic C'], relevance: '0.50', tpmsRank: '1'
  });
  assert.equal(await page.evaluate('adapter.getBid(papers[3])'), 'Eager');
  assert.ok(await errorOf('adapter.setBid(papers[4], "Willing", {expectedPrevious: null})'), 'conflicted rows must not submit');
  assert.equal(await page.evaluate('demo.requests.length'), 0);
});

test('four decisions use observed option labels and opaque option values', async () => {
  await adapter();
  for (const [label, value] of [['Not Willing', 'b-18'], ['In a Pinch', 'b-73'], ['Willing', 'b-29'], ['Eager', 'b-56']]) {
    const previous = await page.evaluate('adapter.getBid(papers[0])');
    await page.evaluate(`adapter.setBid(papers[0], ${JSON.stringify(label)}, {expectedPrevious: ${JSON.stringify(previous)}})`);
    assert.equal(await page.evaluate('adapter.getBid(papers[0])'), label);
    assert.equal(await page.evaluate('demo.requests.at(-1).value'), value);
    assert.equal(await page.evaluate(`adapter.verifyBid(papers[0], ${JSON.stringify(label)})`), true);
    assert.equal(await page.evaluate('document.querySelectorAll("tr[bidding] select").length'), 0);
  }
});

test('slow responses remain unconfirmed until CMT closes its editor and reflects the bid', async () => {
  await adapter();
  await page.evaluate('document.getElementById("slow").checked = true; window.saveFinished = false; window.saveTask = adapter.setBid(papers[0], "Willing", {expectedPrevious:"Not Entered"}).then(() => saveFinished = true); true');
  await page.until('demo.requests.length === 1', 'save request dispatched');
  assert.equal(await page.evaluate('saveFinished'), false);
  assert.equal(await page.evaluate('adapter.verifyBid(papers[0], "Willing")'), false);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Not Entered');
  await page.until('saveFinished', 'save verified');
  assert.equal(await page.evaluate('adapter.getBid(papers[0])'), 'Willing');
});

test('failed save preserves the old bid and rejects confirmation', async () => {
  await adapter();
  await page.evaluate('document.getElementById("fail").checked = true');
  assert.ok(await errorOf('adapter.setBid(papers[0], "Eager", {expectedPrevious:"Not Entered"})'));
  assert.equal(await page.evaluate('adapter.getBid(papers[0])'), 'Not Entered');
  assert.equal(await page.evaluate('adapter.verifyBid(papers[0], "Eager")'), false);
  assert.equal(await page.evaluate('demo.requests.length'), 1);
});

test('ambiguous option labels fail before dispatching any change', async () => {
  await adapter();
  await page.evaluate('document.getElementById("ambiguous").checked = true');
  assert.ok(await errorOf('adapter.setBid(papers[0], "Willing", {expectedPrevious:"Not Entered"})'));
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Not Entered');
});

test('external bid changes are rejected rather than overwritten', async () => {
  await adapter();
  await page.evaluate(`${anchor('101')}.textContent = 'Eager'`);
  assert.ok(await errorOf('adapter.setBid(papers[0], "Not Willing", {expectedPrevious:"Not Entered"})'));
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Eager');
});

test('CMT dialogs fail safely without selecting or confirming an option', async () => {
  await adapter();
  await page.evaluate('document.getElementById("dialog").checked = true');
  assert.ok(await errorOf('adapter.setBid(papers[0], "Eager", {expectedPrevious:"Not Entered"})'));
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  assert.equal(await page.evaluate('document.getElementById("cmt-demo-dialog").open'), true);
});

test('duplicate paper IDs are rejected', async () => {
  await adapter();
  await page.evaluate('document.querySelectorAll("tr[bidding]")[1].setAttribute("bidding", "101"); document.querySelectorAll("tr[bidding]")[1].cells[0].querySelector("a").textContent = "101"');
  assert.ok(await errorOf('adapter.discoverPapers()'));
});

test('unbound CMT templates are rejected, never invented as real papers', async () => {
  await adapter();
  await page.evaluate(`document.querySelector('#BiddingModel tbody').innerHTML = '<tr data-bind="attr: { bidding: id }"><td><a data-bind="text: id"></a></td><td><strong data-bind="text: title"></strong><div data-bind="text: abstract"></div></td><td></td><td></td><td></td><td></td><td></td><td></td><td><a title="Click to change bid" data-bind="text: bid"></a></td></tr>'`);
  assert.ok(await errorOf('adapter.discoverPapers()'));
});

test('skip is non-destructive and keyboard decisions ignore rapid repeats', async () => {
  await launch();
  await page.key('s');
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  await page.until('!window.__PURR_REVIEW__.diagnostics().session.busy', 'skip animation complete');
  await page.key('ArrowRight');
  for (let i = 0; i < 6; i++) await page.key('ArrowRight', { autoRepeat: true });
  await settle(1);
  assert.equal(await page.evaluate('demo.requests.length'), 1);
  assert.equal(await page.evaluate('demo.requests[0].id'), '102');
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Not Entered');
  assert.equal(await page.evaluate(`${anchor('104')}.textContent`), 'Eager');
});

test('undo during a slow save restores the actual previous CMT bid once', async () => {
  await launch();
  await page.evaluate('document.getElementById("slow").checked = true');
  await page.key('ArrowRight');
  await page.until('demo.requests.length === 1', 'initial save began');
  await page.key('z');
  await page.key('z', { autoRepeat: true });
  await settle(2, 12000);
  assert.equal(await page.evaluate('demo.requests.length'), 2);
  assert.deepEqual(await page.evaluate('demo.requests.map(request => [request.id, request.selected])'), [['101', 'Willing'], ['101', 'Not Entered']]);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Not Entered');
});

test('failed saves stay on the paper and do not create an undo restoration', async () => {
  await launch();
  await page.evaluate('document.getElementById("fail").checked = true');
  await page.key('ArrowUp');
  await settle(1);
  await page.until('window.__PURR_REVIEW__.diagnostics().session.blocked', 'blocked after synchronization failure');
  assert.match(await page.evaluate(`${shadow}.querySelector('.notice').textContent`), /error while saving/);
  await page.key('z');
  assert.equal(await page.evaluate('demo.requests.length'), 1);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Not Entered');
  assert.match(await page.evaluate(`${shadow}.textContent`), /Test paper 001/);
});

test('escape removes UI and global state, and relaunch stays singular', async () => {
  await launch();
  await page.key('Escape');
  await page.until('!document.getElementById("purr-review-root") && !window.__PURR_REVIEW__', 'clean exit');
  await page.key('ArrowRight');
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  await page.evaluate('document.getElementById("launch").click()');
  await page.until('Boolean(window.__PURR_REVIEW__)', 'relaunch');
  await page.evaluate('document.getElementById("launch").click()');
  await page.until('document.querySelectorAll("#purr-review-root").length === 1', 'singular launch');
  await page.key('ArrowDown');
  await settle(1);
  assert.equal(await page.evaluate('demo.requests.length'), 1);
});

test('app loads entirely locally and survives narrow and reduced-motion viewports', async () => {
  const remoteRequests = [];
  page.on('Network.requestWillBeSent', event => { if (/^https?:/.test(event.request.url)) remoteRequests.push(event.request.url); });
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await launch();
  assert.equal(await page.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
  const visibleActions = await page.evaluate(`Array.from(${shadow}.querySelectorAll('[data-action="bid"]')).filter(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth; }).length`);
  assert.equal(visibleActions, 4);
  assert.deepEqual(remoteRequests, []);
  await page.call('Emulation.clearDeviceMetricsOverride');
  await page.call('Emulation.setEmulatedMedia', { features: [] });
});

async function pointOn(selector) {
  return page.evaluate(`(() => { const r = ${shadow}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
}
async function mouseDrag(dx, dy, { cancel = false } = {}) {
  const start = await pointOn('.paper-line');
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 6; step++) await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + dx * step / 6, y: start.y + dy * step / 6, button: 'left', buttons: 1 });
  if (cancel) await page.evaluate(`${shadow}.querySelector('.card').dispatchEvent(new PointerEvent('pointercancel', {pointerId:1, isPrimary:true, pointerType:'mouse', bubbles:true}))`);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + dx, y: start.y + dy, button: 'left', buttons: 0, clickCount: 1 });
}
async function touchDrag(selector, dx, dy) {
  const start = await pointOn(selector);
  const viewport = await page.evaluate('({width: innerWidth, height: innerHeight})');
  dx = Math.min(viewport.width - 2 - start.x, Math.max(2 - start.x, dx));
  dy = Math.min(viewport.height - 2 - start.y, Math.max(2 - start.y, dy));
  await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  for (let step = 1; step <= 6; step++) await page.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + dx * step / 6, y: start.y + dy * step / 6, id: 1 }] });
  await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('native mouse dragging submits each direction, below-threshold and canceled drags do not', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const [dx, dy, bid] of [[-160, 0, 'Not Willing'], [0, 160, 'In A Pinch'], [160, 0, 'Willing'], [0, -160, 'Eager']]) {
    await launch();
    await mouseDrag(dx, dy);
    await settle(1);
    assert.equal(await page.evaluate('demo.requests[0].selected'), bid);
    assert.equal(await page.evaluate('demo.requests.length'), 1);
  }
  await launch();
  await mouseDrag(25, 10);
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  await mouseDrag(160, 0, { cancel: true });
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  assert.equal(await page.evaluate(`${shadow}.querySelector('.card').style.transform`), '');
  await page.call('Emulation.clearDeviceMetricsOverride');
});

test('native touch grip supports all four decisions and abstract scrolling never bids', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 430, height: 1000, deviceScaleFactor: 1, mobile: true });
  await page.call('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const [dx, dy, bid] of [[-120, 0, 'Not Willing'], [0, 120, 'In A Pinch'], [120, 0, 'Willing'], [0, -120, 'Eager']]) {
    await launch();
    await touchDrag('.grip', dx, dy);
    await settle(1);
    assert.equal(await page.evaluate('demo.requests[0].selected'), bid);
    assert.equal(await page.evaluate('demo.requests.length'), 1);
  }
  await launch();
  await touchDrag('.abstract', 0, -130);
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  await page.call('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.call('Emulation.clearDeviceMetricsOverride');
});

test('details and focused-button Enter behavior preserve keyboard focus and never bid by accident', async () => {
  await launch();
  await page.key('Enter');
  assert.equal(await page.evaluate(`${shadow}.querySelector('.modal-layer').hidden`), false);
  assert.match(await page.evaluate(`${shadow}.querySelector('.panel-body').textContent`), /Synthetic abstract A/);
  assert.equal(await page.evaluate(`${shadow}.activeElement.dataset.action`), 'close-panel');
  await page.key('Enter');
  assert.equal(await page.evaluate(`${shadow}.querySelector('.modal-layer').hidden`), true);
  await page.evaluate(`${shadow}.querySelector('[data-action="skip"]').focus()`);
  await page.key('Enter');
  await page.until('window.__PURR_REVIEW__.diagnostics().session.skipped === 1', 'focused Skip activated');
  assert.equal(await page.evaluate('demo.requests.length'), 0);
});

test('existing bids require explicit navigation, and undo restores an existing bid', async () => {
  await launch();
  assert.equal(await page.evaluate(`${paperItem('104')}.dataset.bid`), 'eager');
  await page.evaluate(`${paperItem('104')}.click()`);
  assert.match(await page.evaluate(`${shadow}.querySelector('.card').textContent`), /Test paper 004/);
  assert.equal(await page.evaluate(`${paperItem('104')}.getAttribute('aria-current')`), 'true');
  await page.key('ArrowLeft');
  await settle(1);
  await page.until('!window.__PURR_REVIEW__.diagnostics().session.busy', 'existing bid saved');
  await page.key('z');
  await settle(2);
  await page.until('!window.__PURR_REVIEW__.diagnostics().session.busy', 'existing bid restored');
  assert.deepEqual(await page.evaluate('demo.requests.map(request => [request.id, request.selected])'), [['104', 'Not Willing'], ['104', 'Eager']]);
  assert.equal(await page.evaluate(`${paperItem('104')}.dataset.bid`), 'eager');
});

test('exit during a submitted save removes only Purr Review; the CMT callback still completes once', async () => {
  await launch();
  await page.evaluate('document.getElementById("slow").checked = true');
  await page.key('ArrowRight');
  await page.until('demo.requests.length === 1', 'save submitted');
  await page.key('Escape');
  assert.equal(await page.evaluate('Boolean(window.__PURR_REVIEW__)'), false);
  await settle(1);
  assert.equal(await page.evaluate('demo.requests.length'), 1);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Willing');
  assert.equal(await page.evaluate('Boolean(document.getElementById("purr-review-root"))'), false);
});

test('production minified bundle makes the same verified DOM change', async () => {
  await fixture();
  const minified = await readFile(new URL('dist/purr-review.min.js', root), 'utf8');
  await page.evaluate(minified);
  await page.key('ArrowUp');
  await settle(1);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Eager');
  assert.equal(await page.evaluate('demo.requests.length'), 1);
});

test('a bid changed externally after rendering is never silently overwritten', async () => {
  await launch();
  await page.evaluate(`${anchor('101')}.textContent = 'Eager'`);
  await page.key('ArrowRight');
  await page.until('window.__PURR_REVIEW__.diagnostics().session.blocked', 'external change blocked');
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Eager');
});

const fittingContent = {
  title: Array(6).fill('Synthetic test title').join(' '),
  abstract: Array(18).fill('Synthetic abstract A for local testing.').join(' ')
};

async function typographyMetrics() {
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  return page.evaluate(`(() => { const root = ${shadow}; const title = getComputedStyle(root.querySelector('h1')); const abstract = getComputedStyle(root.querySelector('.abstract')); const reading = root.querySelector('.reading'); return { titleSize: parseFloat(title.fontSize), abstractSize: parseFloat(abstract.fontSize), titleWeight: title.fontWeight, titleFamily: title.fontFamily, abstractFamily: abstract.fontFamily, clientHeight: reading.clientHeight, scrollHeight: reading.scrollHeight, clientWidth: reading.clientWidth, scrollWidth: reading.scrollWidth, overflowY: getComputedStyle(reading).overflowY }; })()`);
}

test('default typography fits a synthetic long paper on mobile with equal readable text sizes', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await launch(fittingContent);
    const metrics = await typographyMetrics();
    assert.equal(metrics.titleSize, metrics.abstractSize);
    assert.ok(metrics.titleSize >= 12 && metrics.titleSize < 20);
    assert.equal(metrics.titleWeight, '700');
    assert.equal(metrics.titleFamily, metrics.abstractFamily);
    assert.ok(metrics.clientHeight > 0);
    assert.ok(metrics.scrollHeight <= metrics.clientHeight + 1, JSON.stringify(metrics));
    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, JSON.stringify(metrics));
    await page.evaluate(click('text-size'));
    assert.equal(await page.evaluate(`${shadow}.querySelector('#auto-fit').checked`), true);
    assert.equal(await page.evaluate('demo.requests.length'), 0);
  } finally {
    await page.call('Emulation.clearDeviceMetricsOverride');
  }
});

test('automatic typography expands and refits when the viewport changes', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await launch(fittingContent);
    const small = await typographyMetrics();
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.until(`parseFloat(getComputedStyle(${shadow}.querySelector('h1')).fontSize) === 20`, 'automatic text expands after resize');
    const large = await typographyMetrics();
    assert.equal(large.titleSize, 20);
    assert.equal(large.abstractSize, 20);
    assert.ok(large.titleSize > small.titleSize);
    assert.ok(large.scrollHeight <= large.clientHeight + 1, JSON.stringify(large));
    await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.until(`parseFloat(getComputedStyle(${shadow}.querySelector('h1')).fontSize) < 20`, 'automatic text refits after resize');
    const restored = await typographyMetrics();
    assert.equal(restored.titleSize, small.titleSize);
    assert.equal(restored.titleSize, restored.abstractSize);
    assert.ok(restored.scrollHeight <= restored.clientHeight + 1, JSON.stringify(restored));
  } finally {
    await page.call('Emulation.clearDeviceMetricsOverride');
  }
});

test('very long synthetic abstracts keep the minimum font size and remain scrollable', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await launch({ title: 'Synthetic overflow title', abstract: Array(600).fill('Synthetic overflow abstract for local testing.').join(' ') });
    const metrics = await typographyMetrics();
    assert.equal(metrics.titleSize, 12);
    assert.equal(metrics.abstractSize, 12);
    assert.ok(metrics.scrollHeight > metrics.clientHeight);
    assert.match(metrics.overflowY, /auto|scroll/);
    const scrollTop = await page.evaluate(`(() => { const reading = ${shadow}.querySelector('.reading'); reading.scrollTop = reading.scrollHeight; return reading.scrollTop; })()`);
    assert.ok(scrollTop > 0);
    assert.equal(await page.evaluate('demo.requests.length'), 0);
  } finally {
    await page.call('Emulation.clearDeviceMetricsOverride');
  }
});

test('native typography inputs never bid and manual sizes persist through navigation and automatic fitting', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  try {
    await launch();
    await page.evaluate(click('text-size'));
    assert.equal(await page.evaluate(`${shadow}.querySelector('#auto-fit').checked`), true);
    const titleBefore = await page.evaluate(`Number(${shadow}.querySelector('#title-size').value)`);
    await page.evaluate(`${shadow}.querySelector('#title-size').focus()`);
    await page.key('ArrowRight');
    const titleSize = await page.evaluate(`Number(${shadow}.querySelector('#title-size').value)`);
    assert.equal(titleSize, titleBefore + 1);
    assert.equal(await page.evaluate(`${shadow}.querySelector('#auto-fit').checked`), false);
    assert.ok((await page.evaluate(`${shadow}.querySelector('#title-size-value').textContent`)).includes(String(titleSize)));
    const abstractBefore = await page.evaluate(`Number(${shadow}.querySelector('#abstract-size').value)`);
    await page.evaluate(`${shadow}.querySelector('#abstract-size').focus()`);
    await page.key('ArrowLeft');
    const abstractSize = await page.evaluate(`Number(${shadow}.querySelector('#abstract-size').value)`);
    assert.equal(abstractSize, abstractBefore - 1);
    assert.ok((await page.evaluate(`${shadow}.querySelector('#abstract-size-value').textContent`)).includes(String(abstractSize)));
    assert.equal(await page.evaluate('demo.requests.length'), 0);
    await page.evaluate(click('close-panel'));
    const manual = await typographyMetrics();
    assert.equal(manual.titleSize, titleSize);
    assert.equal(manual.abstractSize, abstractSize);
    await page.key('s');
    await page.until('window.__PURR_REVIEW__.diagnostics().session.skipped === 1 && !window.__PURR_REVIEW__.diagnostics().session.busy', 'skip with manual typography');
    const next = await typographyMetrics();
    assert.equal(next.titleSize, titleSize);
    assert.equal(next.abstractSize, abstractSize);
    await page.evaluate(click('text-size'));
    assert.equal(await page.evaluate(`${shadow}.querySelector('#auto-fit').checked`), false);
    await page.evaluate(`${shadow}.querySelector('#auto-fit').click()`);
    const automatic = await typographyMetrics();
    assert.equal(automatic.titleSize, automatic.abstractSize);
    assert.ok(automatic.titleSize <= 20);
    await page.evaluate(`${shadow}.querySelector('#auto-fit').click()`);
    const restored = await typographyMetrics();
    assert.equal(restored.titleSize, titleSize);
    assert.equal(restored.abstractSize, abstractSize);
    assert.equal(await page.evaluate('demo.requests.length'), 0);
  } finally {
    await page.call('Emulation.clearDeviceMetricsOverride');
  }
});

test('paper footer preserves subject categories, formats scores and exposes missing values', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await launch();
    assert.equal(await page.evaluate(`${shadow}.querySelector('.paper-context').textContent`), 'Test track → Synthetic topic A → Synthetic topic B, Synthetic topic C (Relevance: 0.50, TPMS: 1.00)');
    const layout = await page.evaluate(`(() => { const root = ${shadow}; const context = root.querySelector('.paper-context'); const rect = context.getBoundingClientRect(); const card = root.querySelector('.card').getBoundingClientRect(); return {left: rect.left, right: rect.right, bottom: rect.bottom, cardLeft: card.left, cardRight: card.right, cardBottom: card.bottom, scrollWidth: context.scrollWidth, clientWidth: context.clientWidth, scrollHeight: context.scrollHeight, clientHeight: context.clientHeight}; })()`);
    assert.ok(layout.left >= layout.cardLeft && layout.right <= layout.cardRight, JSON.stringify(layout));
    assert.ok(layout.bottom <= layout.cardBottom, JSON.stringify(layout));
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, JSON.stringify(layout));
    assert.ok(layout.scrollHeight <= layout.clientHeight + 1, JSON.stringify(layout));
    await page.evaluate('window.__PURR_REVIEW__.destroy(); const row = document.querySelector("tr[bidding=\\"101\\"]"); row.cells[6].textContent = ""; row.cells[7].textContent = ""; document.getElementById("launch").click()');
    await page.until('Boolean(window.__PURR_REVIEW__ && document.getElementById("purr-review-root")?.shadowRoot)', 'relaunch with missing synthetic scores');
    assert.equal(await page.evaluate(`${shadow}.querySelector('.paper-context').textContent`), 'Test track → Synthetic topic A → Synthetic topic B, Synthetic topic C (Relevance: —, TPMS: —)');
    assert.equal(await page.evaluate('demo.requests.length'), 0);
  } finally {
    await page.call('Emulation.clearDeviceMetricsOverride');
  }
});

test('arrow keys scroll focused overflowing metadata without submitting a bid', async () => {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  try {
    await fixture();
    await page.evaluate('document.querySelector("tr[bidding=\\"101\\"]").cells[3].textContent = Array(100).fill("Synthetic overflow topic").join(" "); document.getElementById("launch").click()');
    await page.until('Boolean(window.__PURR_REVIEW__ && document.getElementById("purr-review-root")?.shadowRoot)', 'launch with overflowing synthetic metadata');
    const overflowing = await page.evaluate(`(() => { const context = ${shadow}.querySelector('.paper-context'); context.focus(); return context.scrollHeight > context.clientHeight; })()`);
    assert.equal(overflowing, true);
    assert.equal(await page.evaluate(`${shadow}.activeElement.classList.contains('paper-context')`), true);
    await page.key('ArrowDown');
    await page.until(`${shadow}.querySelector('.paper-context').scrollTop > 0`, 'native metadata scrolling');
    assert.equal(await page.evaluate('demo.requests.length'), 0);
    assert.equal(await page.evaluate('window.__PURR_REVIEW__.diagnostics().session.busy'), false);
  } finally {
    await page.call('Emulation.clearDeviceMetricsOverride');
  }
});

test('a paused card animation cannot keep a confirmed bid waiting', async () => {
  await launch();
  await page.key('ArrowRight');
  const paused = await page.evaluate(`(() => { const animations = ${shadow}.querySelector('.card').getAnimations(); animations.forEach(animation => animation.pause()); return animations.length; })()`);
  assert.equal(paused, 1);
  await page.until('window.__PURR_REVIEW__.diagnostics().session.confirmed === 1 && !window.__PURR_REVIEW__.diagnostics().session.busy', 'confirmed bid advances despite paused animation', 4000);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Willing');
  assert.equal(await page.evaluate('demo.requests.length'), 1);
  assert.equal(await page.evaluate('window.__PURR_REVIEW__.diagnostics().session.history'), 1);
  assert.equal(await page.evaluate(`${shadow}.querySelector('.paper-id').textContent`), 'Paper 102');
});

test('animation deadlines never advance a slow bid before CMT confirms it', async () => {
  await launch();
  await page.evaluate('document.getElementById("slow").checked = true');
  await page.key('ArrowRight');
  const paused = await page.evaluate(`(() => { const animations = ${shadow}.querySelector('.card').getAnimations(); animations.forEach(animation => animation.pause()); return animations.length; })()`);
  assert.equal(paused, 1);
  await page.until(`${shadow}.querySelector('.card').getAnimations().length === 0`, 'cosmetic animation deadline', 1200);
  assert.equal(await page.evaluate('demo.outcomes.length'), 0);
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Not Entered');
  const pending = await page.evaluate('window.__PURR_REVIEW__.diagnostics().session');
  assert.equal(pending.busy, true);
  assert.equal(pending.confirmed, 0);
  assert.equal(pending.history, 0);
  assert.equal(await page.evaluate(`${shadow}.querySelector('.paper-id').textContent`), 'Paper 101');
  await page.until('window.__PURR_REVIEW__.diagnostics().session.confirmed === 1 && !window.__PURR_REVIEW__.diagnostics().session.busy', 'advance only after actual CMT confirmation');
  assert.equal(await page.evaluate(`${anchor('101')}.textContent`), 'Willing');
  assert.equal(await page.evaluate('demo.requests.length'), 1);
  assert.equal(await page.evaluate(`${shadow}.querySelector('.paper-id').textContent`), 'Paper 102');
});

async function sortingFixture() {
  await fixture();
  await page.evaluate(`(() => { const values = [['2','0.70'],['10','0.20'],['3','0.70'],['20',''],['8','0.45'],['11',''],['100','0.05']]; document.querySelectorAll('tr[bidding]').forEach((row,index) => { const [id,relevance] = values[index]; row.setAttribute('bidding',id); row.cells[0].querySelector('a').textContent = id; row.cells[6].textContent = relevance; }); })()`);
  await startApp();
}
async function sortPapers(value) {
  await page.evaluate(`(() => { const select = ${shadow}.querySelector('#paper-sort'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
async function sidebarIds() {
  return page.evaluate(`Array.from(${shadow}.querySelectorAll('.paper-list .paper-item')).map(item => item.dataset.paperId)`);
}
async function currentPaperId() {
  return page.evaluate(`${shadow}.querySelector('.paper-item[aria-current="true"]')?.dataset.paperId`);
}
async function settledUI() {
  await page.until('!window.__PURR_REVIEW__.diagnostics().session.busy', 'paper operation settled');
}

test('paper sorting uses numeric IDs and relevance with stable ties and missing values last', async () => {
  await sortingFixture();
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').value`), 'id-asc');
  assert.deepEqual(await sidebarIds(), ['2','3','8','10','11','20','100']);
  assert.equal(await currentPaperId(), '2');
  await page.evaluate(`${shadow}.querySelector('#paper-sort').focus()`);
  await page.key('ArrowDown');
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').value`), 'id-desc');
  assert.deepEqual(await sidebarIds(), ['100','20','11','10','8','3','2']);
  await page.evaluate(`${paperItem('10')}.click()`);
  for (const [value, expected] of [
    ['relevance-asc',['100','10','8','2','3','11','20']],
    ['relevance-desc',['2','3','8','10','100','11','20']],
    ['id-asc',['2','3','8','10','11','20','100']]
  ]) {
    await sortPapers(value);
    assert.deepEqual(await sidebarIds(), expected);
    assert.equal(await currentPaperId(), '10');
  }
  assert.equal(await page.evaluate('demo.requests.length'), 0);
});

test('jumping and sorted progression wrap to pending papers without revisiting existing bids', async () => {
  await sortingFixture();
  await page.evaluate(`${paperItem('100')}.click()`);
  assert.equal(await currentPaperId(), '100');
  await page.evaluate(`${shadow}.querySelector('[data-action="bid"][data-bid="Willing"]').click()`);
  await settle(1);
  await settledUI();
  assert.equal(await currentPaperId(), '2');
  await sortPapers('id-desc');
  assert.equal(await currentPaperId(), '2');
  await page.evaluate(click('skip'));
  await settledUI();
  assert.equal(await currentPaperId(), '11');
  await page.evaluate(`${paperItem('3')}.click()`);
  assert.equal(await currentPaperId(), '3');
  await page.evaluate(`${shadow}.querySelector('[data-action="bid"][data-bid="Eager"]').click()`);
  await settle(2);
  await settledUI();
  assert.equal(await currentPaperId(), '11');
  assert.deepEqual(await page.evaluate('demo.requests.map(request => request.id)'), ['100','3']);
  assert.equal(await page.evaluate(`${anchor('20')}.textContent`), 'Eager');
});

test('unavailable papers can be inspected without enabling bid controls', async () => {
  await launch();
  assert.equal(await page.evaluate(`${paperItem('105')}.dataset.bid`), 'unavailable');
  assert.equal(await page.evaluate(`${paperItem('105')}.disabled`), false);
  await page.evaluate(`${paperItem('105')}.click()`);
  assert.equal(await currentPaperId(), '105');
  assert.match(await page.evaluate(`${shadow}.querySelector('.card').textContent`), /Synthetic abstract E/);
  assert.equal(await page.evaluate(`Array.from(${shadow}.querySelectorAll('[data-action="bid"]')).every(button => button.disabled)`), true);
  await page.key('ArrowRight');
  assert.equal(await page.evaluate('demo.requests.length'), 0);
  await page.evaluate(`${paperItem('106')}.click()`);
  assert.equal(await currentPaperId(), '106');
  assert.equal(await page.evaluate(`Array.from(${shadow}.querySelectorAll('[data-action="bid"]')).every(button => !button.disabled)`), true);
});

test('sidebar navigation and sorting stay locked while a bid is saving', async () => {
  await launch();
  await page.evaluate('document.getElementById("slow").checked = true');
  await page.key('ArrowRight');
  await page.until('demo.requests.length === 1', 'slow bid started');
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').disabled`), true);
  assert.equal(await page.evaluate(`Array.from(${shadow}.querySelectorAll('.paper-item')).every(item => item.disabled)`), true);
  await page.evaluate(`${paperItem('103')}.click()`);
  assert.equal(await currentPaperId(), '101');
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').value`), 'id-asc');
  await settle(1);
  await settledUI();
  assert.equal(await currentPaperId(), '102');
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').disabled`), false);
  assert.equal(await page.evaluate(`Array.from(${shadow}.querySelectorAll('.paper-item')).every(item => !item.disabled)`), true);
});

test('sidebar bid labels and colors change only after verified saves and undo', async () => {
  await launch();
  const initial = await page.evaluate(`({text:${paperItem('101')}.textContent,color:getComputedStyle(${paperItem('101')}).backgroundColor})`);
  await page.evaluate('document.getElementById("slow").checked = true');
  await page.key('ArrowRight');
  await page.until('demo.requests.length === 1', 'bid awaiting confirmation');
  assert.equal(await page.evaluate(`${paperItem('101')}.dataset.bid`), 'unbid');
  assert.equal(await page.evaluate(`${paperItem('101')}.textContent`), initial.text);
  assert.equal(await page.evaluate(`getComputedStyle(${paperItem('101')}).backgroundColor`), initial.color);
  await settle(1);
  await settledUI();
  assert.equal(await page.evaluate(`${paperItem('101')}.dataset.bid`), 'willing');
  assert.match(await page.evaluate(`${paperItem('101')}.textContent`), /Willing/);
  const savedColor = await page.evaluate(`getComputedStyle(${paperItem('101')}).backgroundColor`);
  assert.notEqual(savedColor, initial.color);
  await page.key('z');
  await page.until('demo.requests.length === 2', 'undo awaiting confirmation');
  assert.equal(await page.evaluate(`${paperItem('101')}.dataset.bid`), 'willing');
  assert.equal(await page.evaluate(`getComputedStyle(${paperItem('101')}).backgroundColor`), savedColor);
  await settle(2);
  await settledUI();
  assert.equal(await page.evaluate(`${paperItem('101')}.dataset.bid`), 'unbid');
  assert.equal(await page.evaluate(`${paperItem('101')}.textContent`), initial.text);
  assert.equal(await page.evaluate(`getComputedStyle(${paperItem('101')}).backgroundColor`), initial.color);
});

test('failed saves preserve sidebar bid state and lock navigation', async () => {
  await launch();
  const initial = await page.evaluate(`({text:${paperItem('101')}.textContent,color:getComputedStyle(${paperItem('101')}).backgroundColor})`);
  await page.evaluate('document.getElementById("fail").checked = true');
  await page.key('ArrowUp');
  await page.until('window.__PURR_REVIEW__.diagnostics().session.blocked', 'failed save blocked');
  assert.equal(await page.evaluate(`${paperItem('101')}.dataset.bid`), 'unbid');
  assert.equal(await page.evaluate(`${paperItem('101')}.textContent`), initial.text);
  assert.equal(await page.evaluate(`getComputedStyle(${paperItem('101')}).backgroundColor`), initial.color);
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').disabled`), true);
  assert.equal(await page.evaluate(`Array.from(${shadow}.querySelectorAll('.paper-item')).every(item => item.disabled)`), true);
  assert.equal(await currentPaperId(), '101');
});

test('CMT dialogs lock paper navigation and sorting without submitting a bid', async () => {
  await launch();
  await page.evaluate('document.getElementById("cmt-demo-dialog").showModal()');
  await page.until('window.__PURR_REVIEW__.diagnostics().session.pageDialog', 'CMT dialog detected');
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').disabled`), true);
  assert.equal(await page.evaluate(`Array.from(${shadow}.querySelectorAll('.paper-item')).every(item => item.disabled)`), true);
  assert.equal(await page.evaluate('demo.requests.length'), 0);
});

test('Escape closes a panel before a second Escape exits the workspace', async () => {
  await launch();
  for (const action of ['details','text-size']) {
    await page.evaluate(click(action));
    assert.equal(await page.evaluate(`${shadow}.querySelector('.modal-layer').hidden`), false);
    await page.key('Escape');
    assert.equal(await page.evaluate('Boolean(window.__PURR_REVIEW__)'), true);
    assert.equal(await page.evaluate(`${shadow}.querySelector('.modal-layer').hidden`), true);
    await page.key('Escape', { autoRepeat: true });
    assert.equal(await page.evaluate('Boolean(window.__PURR_REVIEW__)'), true);
  }
  await page.key('Escape');
  assert.equal(await page.evaluate('Boolean(window.__PURR_REVIEW__)'), false);
  assert.equal(await page.evaluate('demo.requests.length'), 0);
});

test('the simplified workspace exposes its repository link and readable text settings', async () => {
  await launch();
  const repository = `${shadow}.querySelector('a[href="https://github.com/lmwnshn/purr-review"]')`;
  assert.match(await page.evaluate(`${repository}.textContent`), /lmwnshn\/purr-review/);
  assert.equal(await page.evaluate(`Boolean(${repository}.querySelector('svg'))`), true);
  assert.ok(await page.evaluate(`parseFloat(getComputedStyle(${shadow}.querySelector('[data-action="text-size"]')).fontSize) >= 16`));
  assert.doesNotMatch(await page.evaluate(`${shadow}.querySelector('.shell').innerText`), /\bReady\b|Not yet bid|Diagnostics|confirmed this session|\bloaded\b|existing bids/);
  assert.equal(await page.evaluate(`${shadow}.querySelectorAll('.paper-list .paper-item').length`), 7);
});

test('paper text stays inert and diagnostics omit paper content', async () => {
  const marker = 'PRIVATE_SYNTHETIC_SENTINEL';
  const title = `${marker} <img src=x onerror="window.paperMarkupExecuted=true">`;
  await launch({ title, abstract: `${marker} abstract <script>window.paperMarkupExecuted=true</script>` });
  assert.equal(await page.evaluate(`${shadow}.querySelector('h1').textContent`), title);
  assert.equal(await page.evaluate(`${shadow}.querySelectorAll('.reading img,.reading script').length`), 0);
  await page.evaluate(click('details'));
  assert.equal(await page.evaluate(`${shadow}.querySelector('.detail-title').textContent`), title);
  assert.equal(await page.evaluate(`${shadow}.querySelectorAll('.panel-body img,.panel-body script').length`), 0);
  assert.equal(await page.evaluate('Boolean(window.paperMarkupExecuted)'), false);
  assert.equal((await page.evaluate('JSON.stringify(window.__PURR_REVIEW__.diagnostics())')).includes(marker), false);
  await page.key('Escape');
  await page.key('ArrowRight');
  await page.until('window.demo.outcomes.length === 1 && !window.__PURR_REVIEW__.diagnostics().session.busy', 'private synthetic paper saved');
  assert.equal((await page.evaluate('JSON.stringify(window.__PURR_REVIEW__.diagnostics())')).includes(marker), false);
});
