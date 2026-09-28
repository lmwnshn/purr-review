import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchChrome } from '../tests/chrome.mjs';

const root = new URL('../', import.meta.url);
const output = fileURLToPath(new URL('demo/purr-review-demo.mp4', root));
const poster = fileURLToPath(new URL('demo/purr-review-demo.jpg', root));
const temporary = await mkdtemp(join(tmpdir(), 'purr-review-recording-'));
const page = await launchChrome();
const shadow = 'document.getElementById("purr-review-root").shadowRoot';
const frames = [];
const writes = [];
const duration = 15000;
let recording = false;
let started = 0;
let navigationStarted = 0;
let cursor = { x: 1050, y: 640 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const at = ms => sleep(navigationStarted + ms - performance.now());
async function move(x, y, pressed = false) {
  cursor = { x, y };
  await page.evaluate(`window.recordingPointer(${x},${y},${pressed})`);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, ...(pressed ? { button: 'left', buttons: 1 } : {}) });
}
async function glide(x, y, milliseconds = 300, pressed = false) {
  const from = { ...cursor };
  const start = performance.now();
  for (let i = 1; i <= 18; i++) {
    await sleep(start + milliseconds * i / 18 - performance.now());
    const t = i / 18;
    const eased = t * t * (3 - 2 * t);
    await move(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased, pressed);
  }
}
async function click(x, y, hold = 100) {
  await glide(x, y, 220);
  await page.evaluate(`window.recordingPointer(${x},${y},true)`);
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(hold);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await page.evaluate(`window.recordingPointer(${x},${y},false)`);
}
async function point(selector) {
  return page.evaluate(`(() => { const r=${shadow}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
}
async function scrollPapers(delta, milliseconds) {
  const p = await point('.paper-list');
  await glide(p.x, p.y, 180);
  const start = performance.now();
  for (let i = 1; i <= 12; i++) {
    await sleep(start + milliseconds * i / 12 - performance.now());
    await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', ...p, deltaX: 0, deltaY: delta / 12 });
  }
  await sleep(220);
}
async function chooseVisiblePaper() {
  const p = await page.evaluate(`(() => {const r=${shadow},list=r.querySelector('.paper-list').getBoundingClientRect();const items=[...r.querySelectorAll('.paper-item[data-bid="unbid"]')].filter(n=>{const b=n.getBoundingClientRect();return b.top>list.top+60&&b.bottom<list.bottom-30});const n=items[Math.floor(items.length/2)],b=n.getBoundingClientRect();return {id:n.dataset.paperId,x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  await click(p.x, p.y);
  assert.equal(await page.evaluate(`${shadow}.querySelector('.paper-item[aria-current="true"]').dataset.paperId`), p.id);
  return p.id;
}
async function swipe(dx, dy) {
  const p = await point('.reading');
  await glide(p.x, p.y, 300);
  await page.evaluate(`window.recordingPointer(${p.x},${p.y},true)`);
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
  await glide(p.x + dx * .45, p.y + dy * .45, 360, true);
  await sleep(300);
  await glide(p.x + dx, p.y + dy, 330, true);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...cursor, button: 'left', buttons: 0, clickCount: 1 });
  await page.evaluate(`window.recordingPointer(${cursor.x},${cursor.y},false)`);
}
async function ffmpeg(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
}
try {
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page.navigate(new URL('demo/index.html', root).href);
  await page.until('Boolean(window.demo)', 'synthetic demo loaded');
  await page.evaluate(`(() => {
    const bids=['Not Entered','Not Entered','Not Entered','Willing','In A Pinch','Not Entered','Eager','Not Willing'];
    demo.initial.splice(0,demo.initial.length,...Array.from({length:40},(_,i)=>({id:String(101+i),title:'Test paper '+String(i+1).padStart(3,'0'),abstract:Array(2).fill(Array(4).fill('Synthetic abstract '+String.fromCharCode(65+i%26)+' for local testing.').join(' ')).join('\\n\\n'),primary:'Synthetic topic '+String.fromCharCode(65+i%26),secondary:['Synthetic topic '+String.fromCharCode(65+(i+1)%26)],bid:bids[i%8]})));
    demo.reset();
    document.querySelectorAll('tr[bidding]').forEach((row,i)=>row.cells[6].textContent=((i*37+23)%100/100).toFixed(2));
    document.documentElement.style.overflow='hidden';

    document.getElementById('launch').style.display='none';
    const chrome=document.createElement('div');
    chrome.id='recording-browser';
    chrome.style.cssText='position:fixed;inset:0 0 auto;background:#f1f3f5;border-bottom:1px solid #cdd1d5;padding:12px 24px;z-index:1000;font:14px system-ui';
    chrome.innerHTML='<div style="border-radius:18px;background:white;padding:8px 20px;color:#667085;margin-bottom:8px">cmt3.research.microsoft.com / Reviewer Console <span style="float:right">Local demonstration</span></div><a id="recording-bookmark" style="display:inline-flex;align-items:center;gap:8px;color:#343434;text-decoration:none;padding:7px 12px;border-radius:6px;background:#fff;border:1px solid #ddd"><img src="../assets/favicon.png" width="22" height="22">Purr Review</a>';
    document.body.append(chrome);

  })()`);
  const recordingCSS = 'body{padding-top:104px}.table-container{height:429px;overflow:hidden}';
  await page.evaluate(`(() => {const style=document.createElement('style');style.textContent=${JSON.stringify(recordingCSS)};document.head.append(style)})()`);
  const bookmarklet = (await readFile(new URL('dist/bookmarklet.txt', root), 'utf8')).trim();
  await page.evaluate(`document.getElementById('recording-bookmark').href=${JSON.stringify(bookmarklet)}`);
  await page.evaluate(`(() => {
    const pointer=document.createElement('div');
    pointer.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;width:32px;height:40px;filter:drop-shadow(0 2px 3px #0008)';
    pointer.innerHTML='<svg viewBox="0 0 32 40"><path d="M3 2L3 31L11 24L18 38L24 35L17 22L29 21Z" fill="white" stroke="#282828" stroke-width="2"/></svg>';
    const pulse=document.createElement('div');
    pulse.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;width:64px;height:64px;border:4px solid #fe3c72;border-radius:50%;transform:translate(-50%,-50%);display:none;background:#fe3c7233';
    document.documentElement.append(pulse);
    document.documentElement.append(pointer);
    window.recordingPointer=(x,y,pressed)=>{document.documentElement.append(pulse,pointer);pointer.style.left=x+'px';pointer.style.top=y+'px';pulse.style.left=x+'px';pulse.style.top=y+'px';pulse.style.display=pressed?'block':'none'};
    recordingPointer(1050,640,false);
  })()`);
  await sleep(300);
  page.on('Page.screencastFrame', event => {
    page.call('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    if (!recording) return;
    const index = frames.length;
    const time = (performance.now() - started) / 1000;
    const name = `frame-${String(index).padStart(5,'0')}.jpg`;
    frames.push({ name, time });
    writes.push(writeFile(join(temporary, name), Buffer.from(event.data,'base64')));
  });
  started = performance.now();
  recording = true;
  await page.call('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await sleep(1800);
  // Enlarge the actual bookmark anchor while retaining the simulated CMT context.
  await page.evaluate(`document.getElementById('recording-browser').style.transition='transform 650ms ease';document.getElementById('recording-browser').style.transformOrigin='top left';document.getElementById('recording-browser').style.transform='scale(2.3)'`);
  await sleep(900);
  const bookmark = await page.evaluate(`(() => {const r=document.getElementById('recording-bookmark').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await glide(bookmark.x,bookmark.y,650);
  await sleep(450);
  await click(bookmark.x,bookmark.y);
  await page.until('Boolean(window.__PURR_REVIEW__)', 'bookmarklet launched');
  await page.evaluate(`document.getElementById('recording-browser').style.display='none'`);
  navigationStarted = performance.now();
  const navigationStart = (navigationStarted-started)/1000;
  await at(850);
  const sort = await point('#paper-sort');
  await click(sort.x, sort.y);
  await at(1500);
  await page.key('ArrowDown');
  await page.key('ArrowDown');
  await page.key('Enter');
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').value`), 'relevance-desc');
  await glide(sort.x + 100, sort.y + 35, 150);
  await at(2350);
  await scrollPapers(600, 850);
  await at(3600);
  const eagerID = await chooseVisiblePaper();
  await at(5000);
  await swipe(0,-150);
  await page.until('window.demo.outcomes.length===1&&!window.__PURR_REVIEW__.diagnostics().session.busy', 'Eager swipe confirmed');
  assert.equal(await page.evaluate('demo.outcomes[0].bid'), 'Eager');
  await at(7750);
  await scrollPapers(-320, 650);
  const unwillingID = await chooseVisiblePaper();
  await at(9650);
  await swipe(-180,0);
  await page.until('window.demo.outcomes.length===2&&!window.__PURR_REVIEW__.diagnostics().session.busy', 'Not Willing swipe confirmed');
  assert.equal(await page.evaluate('demo.outcomes[1].bid'), 'Not Willing');
  await at(12100);
  await click(sort.x, sort.y);
  await page.key('Home');
  await page.key('ArrowDown');
  await page.key('Enter');
  assert.equal(await page.evaluate(`${shadow}.querySelector('#paper-sort').value`), 'id-desc');
  await glide(sort.x + 100, sort.y + 35, 150);
  await at(13300);
  await scrollPapers(280, 550);
  await at(duration);
  // Finish at normal speed so the final decision and confirmation are easy to follow.
  const navigationEnd = (performance.now()-started)/1000;
  const willingID = await chooseVisiblePaper();
  const willing = await point('.decision[data-bid="Willing"]');
  await page.evaluate(`${shadow}.querySelector('.decision[data-bid="Willing"]').style.boxShadow='0 0 0 5px #fe3c7255'`);
  await glide(willing.x, willing.y, 700);
  await sleep(350);
  await click(willing.x, willing.y, 350);
  await page.until('window.demo.outcomes.length===3&&!window.__PURR_REVIEW__.diagnostics().session.busy', 'Willing button confirmed');
  assert.equal(await page.evaluate('demo.outcomes[2].bid'), 'Willing');
  assert.equal(await page.evaluate('demo.outcomes[2].id'), willingID);
  assert.equal(await page.evaluate(`${shadow}.querySelector('.paper-item[data-paper-id="${willingID}"]').dataset.bid`), 'willing');
  await page.evaluate(`${shadow}.querySelector('.decision[data-bid="Willing"]').style.boxShadow=''`);
  // Hold the successful result, then leave 3.2 seconds for the final card.
  const elapsedPlayback = navigationStart+(navigationEnd-navigationStart)/2+(performance.now()-started)/1000-navigationEnd;
  await sleep(Math.max(1800, (16.8-elapsedPlayback)*1000));
  const installerTemplate = await readFile(new URL('scripts/install-template.html', root), 'utf8');
  const githubMark = installerTemplate.match(/<svg class="github-mark"[\s\S]*?<\/svg>/)[0].replace('class="github-mark"', 'width="28" height="28" fill="currentColor"');
  await page.evaluate(`(() => {
    const card=document.createElement('div');
    card.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#faf6ef;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#424242;font-family:system-ui;text-align:center';
    card.innerHTML='<img src="../assets/favicon.png" width="110" height="110" style="margin-bottom:32px"><div style="font-size:52px;font-weight:650;letter-spacing:-2px">Zero install. Just add a bookmark.</div><div style="font-size:26px;margin-top:22px;color:#76695d;display:flex;align-items:center;gap:12px">' + ${JSON.stringify(githubMark)} + 'lmwnshn/purr-review</div>';
    document.documentElement.append(card);
  })()`);
  await sleep(3200);
  const capturedDuration = (performance.now() - started) / 1000;
  recording = false;
  await page.call('Page.stopScreencast');
  await Promise.all(writes);
  assert.ok(frames.length > 100, 'Expected actual animation frames');
  const playbackTime = time => time <= navigationStart ? time : time <= navigationEnd ? navigationStart+(time-navigationStart)/2 : navigationStart+(navigationEnd-navigationStart)/2+(time-navigationEnd);
  const outputDuration=playbackTime(capturedDuration);
  const manifest = ['ffconcat version 1.0'];
  frames[0].time = 0;
  for (let i=0;i<frames.length;i++) {
    const seconds = playbackTime(frames[i+1]?.time ?? capturedDuration)-playbackTime(frames[i].time);
    manifest.push(`file '${frames[i].name}'`, `duration ${Math.max(.001,seconds).toFixed(6)}`);
  }
  manifest.push(`file '${frames.at(-1).name}'`);
  await writeFile(join(temporary,'frames.ffconcat'),manifest.join('\n')+'\n');
  await mkdir(fileURLToPath(new URL('demo/',root)),{recursive:true});
  await ffmpeg(['-f','concat','-safe','0','-i',join(temporary,'frames.ffconcat'),'-vf','fps=30','-t',String(outputDuration),'-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-an','-map_metadata','-1',output]);
  await ffmpeg(['-i',output,'-frames:v','1','-q:v','4','-update','1',poster]);
  console.log(JSON.stringify({output,frames:frames.length,duration:outputDuration,capturedDuration,swipes:[{id:eagerID,bid:'Eager'},{id:unwillingID,bid:'Not Willing'}],buttonDecision:{id:willingID,bid:'Willing'}}));
} finally {
  recording = false;
  await page.close();
  await rm(temporary,{recursive:true,force:true});
}
