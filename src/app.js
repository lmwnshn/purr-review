function launchPurrReview() {
  const GLOBAL = '__PURR_REVIEW__';
  const HOST_ID = 'purr-review-root';

  if (window[GLOBAL]?.focus) {
    window[GLOBAL].focus();
    return;
  }
  if (document.getElementById(HOST_ID)) {
    alert('Purr Review is already open. Exit the existing workspace before relaunching.');
    return;
  }

  const lifetime = new AbortController();
  const { signal } = lifetime;
  const previousFocus = document.activeElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const animationSet = new Set();
  const BIDS = ['Not Willing', 'In a Pinch', 'Willing', 'Eager'];
  const COUNT_BIDS = [...BIDS, 'Not Entered'];
  const DIRECTIONS = ['left', 'down', 'right', 'up'];
  const ARROWS = ['←', '↓', '→', '↑'];
  const KEY_BIDS = { ArrowLeft: BIDS[0], ArrowDown: BIDS[1], ArrowRight: BIDS[2], ArrowUp: BIDS[3] };
  const adapter = createCMTAdapter({ signal });
  const state = {
    papers: [], queue: [], skipped: [], history: [], processed: new Set(),
    existing: [], unavailable: [], current: null, busy: false, undoRequested: false,
    error: '', blocked: false, panel: null, status: '', sort: 'id-asc', nextTBD: true, bids: new Map(),
    fatal: '', pageDialog: false, destroyed: false, displayedBid: null,
    typography: { auto: true, title: 20, abstract: 20, effectiveTitle: 20, effectiveAbstract: 20 },
  };

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;isolation:isolate!important;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme: light; font: 15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#424242; }
    *,*::before,*::after { box-sizing:border-box; }
    button,a { -webkit-tap-highlight-color:transparent; }
    button { font:inherit; color:inherit; cursor:pointer; }
    button:disabled { cursor:default; opacity:.4; }
    button:focus-visible,a:focus-visible,[tabindex]:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible { outline:3px solid #fe3c72; outline-offset:4px; }
    button { border:0; background:none; }
    [hidden] { display:none!important; }
    .shell { font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#424242; width:100%; height:100vh; height:100dvh; display:flex; flex-direction:column; overflow:hidden; background:#ffffff; outline:0; }
    header { padding:4px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid #fe3c7226; }
    .brand { display:flex; gap:9px; align-items:center; min-width:0; min-height:36px; color:inherit; text-decoration:none; border-radius:4px; }
    .github-mark { width:24px; height:24px; flex:none; fill:currentColor; }
    .brand-name { font-size:14px; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bid-summary { display:flex; align-items:stretch; gap:5px; margin:0; padding:0; }
    .bid-total { display:flex; align-items:center; gap:6px; padding:5px 8px; border-radius:5px; background:#4242420a; font-size:11px; line-height:1.25; }
    .bid-total dt { max-width:55px; } .bid-total dd { margin:0; font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; }
    .bid-total[data-count-bid="In a Pinch"] { background:#fd55641f; }
    .bid-total[data-count-bid="Willing"] { background:#ef4a7540; }
    .bid-total[data-count-bid="Eager"] { background:#fe3c7266; }
    .bid-total[data-count-bid="Not Entered"] { background:#fff; border:1px solid #42424226; }
    .header-right { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:12px; flex:none; max-width:100%; }
    .next-mode { display:flex; align-items:center; gap:5px; font-size:12px; cursor:pointer; }
    .next-mode input { margin:0; accent-color:#ef4a75; }
    .icon-button { font-size:20px; width:32px; height:32px; border-radius:50%; color:#424242; }
    .icon-button:hover { background:#fe3c7214; }
    .text-button { padding:2px 0; font-size:12px; text-decoration:underline; text-decoration-color:#ef4a75; text-underline-offset:4px; }
    .text-button:hover { color:#424242; text-decoration-color:currentColor; }
    .header-right > .text-button { font-size:16px; min-height:36px; padding:5px 8px; border-radius:5px; }
    .work-area { flex:1; min-height:0; display:grid; grid-template-columns:148px minmax(0,1fr); }
    .paper-sidebar { min-height:0; display:flex; flex-direction:column; gap:6px; padding:12px 8px 0 12px; border-right:1px solid #4242421a; }
    .sort-label { font-size:11px; font-weight:650; }
    #paper-sort { width:100%; min-width:0; min-height:34px; padding:5px 3px; font:inherit; font-size:12px; color:#424242; background:#ffffff; border:1px solid #42424233; border-radius:5px; }
    .paper-list { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#fe3c7266 transparent; display:flex; flex-direction:column; gap:4px; padding:3px; margin:2px -3px 0; }
    .paper-item { display:flex; flex-direction:column; align-items:flex-start; flex:none; width:100%; min-height:44px; gap:2px; padding:7px 9px; border:1px solid #42424226; border-radius:6px; text-align:left; background:#ffffff; }
    .paper-item[data-bid="unbid"] { background:#ffffff; }
    .paper-item[data-bid="not-willing"] { background:#42424214; }
    .paper-item[data-bid="in-a-pinch"] { background:#fd55641f; }
    .paper-item[data-bid="willing"] { background:#ef4a7540; }
    .paper-item[data-bid="eager"] { background:#fe3c7266; }
    .paper-item[data-bid="unavailable"] { background:#4242422e; border-style:dashed; }
    .paper-item[aria-current="true"] { outline:2px solid #fe3c72; outline-offset:-2px; }
    .paper-item:hover:not(:disabled) { box-shadow:inset 0 0 0 1px #42424266; }
    .paper-number { font-size:13px; font-weight:700; overflow-wrap:anywhere; }
    .paper-bid { font-size:10px; line-height:1.35; }
    .workspace { min-width:0; min-height:0; display:grid; grid-template-columns:90px minmax(0,1200px) 90px; grid-template-rows:32px minmax(0,1fr)32px; justify-content:center; column-gap:6px; padding:0 10px; }
    .card-slot { grid-column:2; grid-row:2; position:relative; min-height:0; display:flex; perspective:1000px; }
    .card-slot::before { content:''; position:absolute; inset:6px 8px -4px; border:1px solid #fe3c7226; border-radius:15px; background:#fe3c7208; }
    .card { position:relative; width:100%; min-width:0; min-height:0; border:1px solid #42424226; border-radius:14px; padding:20px; background:#ffffff; box-shadow:0 9px 24px #42424208,0 2px 3px #42424205; display:flex; flex-direction:column; touch-action:pan-y; cursor:grab; transform-origin:50% 70%; will-change:transform; }
    .card.dragging { cursor:grabbing; }
    .paper-line { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; flex:none; }
    .eyebrow { font-size:11px; letter-spacing:.13em; text-transform:uppercase; font-weight:700; color:#424242; }
    h1 { margin:0; font-family:inherit; color:#424242; font-weight:700; font-size:var(--title-size,20px); line-height:1.4; overflow-wrap:anywhere; }
    .reading { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-gutter:stable; scrollbar-color:#fe3c7266 transparent; padding-right:4px; touch-action:pan-y; }
    .rule { width:42px; height:2px; background:#fd5564; margin:8px 0; }
    .abstract { color:#424242; font-size:var(--abstract-size,20px); line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; margin:0; }
    .abstract.empty { color:#424242; font-style:italic; }
    .topics { display:flex; gap:5px; flex-wrap:wrap; margin-top:10px; }
    .topic { font-size:11px; color:#424242; background:#fe3c720a; border:1px solid #fe3c7226; border-radius:5px; padding:3px 7px; max-width:100%; overflow-wrap:anywhere; }
    .card-foot { margin-top:8px; padding-top:6px; border-top:1px solid #42424226; display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:8px; font-size:11px; color:#424242; flex:none; }
    .paper-context { min-width:0; text-align:center; overflow-wrap:anywhere; line-height:1.5; max-height:6em; overflow:auto; overscroll-behavior:contain; touch-action:pan-y; scrollbar-width:thin; }
    .grip { display:inline-flex; align-items:center; gap:7px; padding:3px 0; cursor:grab; touch-action:none; white-space:nowrap; }
    .card-foot > button { white-space:nowrap; }
    .grip::before { content:''; width:10px; height:16px; background:radial-gradient(circle,#42424280 1px,transparent 1.3px) 0 0 / 5px 5px; }
    .stamp { position:absolute; top:14px; left:50%; transform:translateX(-50%); padding:6px 16px; border:1px solid currentColor; border-radius:5px; font-size:12px; font-weight:700; letter-spacing:.06em; background:#fffffff5; opacity:0; pointer-events:none; z-index:1; }
    .decision { align-self:center; justify-self:center; border-radius:8px; padding:4px 4px; display:flex; align-items:center; gap:7px; font-size:11px; font-weight:650; letter-spacing:.02em; text-transform:uppercase; color:#424242; transition:background .16s,color .16s,transform .16s; min-width:90px; min-height:32px; justify-content:center; }
    .decision .arrow { font-size:21px; font-weight:400; line-height:1; color:#fe3c72; }
    .decision:hover:not(:disabled),.decision.candidate { background:#ef4a751f; color:#424242; }
    .decision.candidate { transform:scale(1.04); box-shadow:0 0 0 1px #fe3c7266; }
    .decision[data-direction=left] { grid-column:1; grid-row:2; flex-direction:column; }
    .decision[data-direction=right] { grid-column:3; grid-row:2; flex-direction:column; }
    .decision[data-direction=up] { grid-column:2; grid-row:1; }
    .decision[data-direction=down] { grid-column:2; grid-row:3; }
    .decision[data-direction=left]:hover,.decision[data-direction=left].candidate { background:#fd556424; color:#424242; }
    .decision[data-direction=down]:hover,.decision[data-direction=down].candidate { background:#ef4a751a; color:#424242; }
    .decision[data-direction=up]:hover,.decision[data-direction=up].candidate { background:#fe3c7226; color:#424242; }
    footer { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:6px 20px; flex:none; }
    .shortcuts { display:flex; align-items:center; gap:16px; }
    .shortcut { font-size:12px; color:#424242; display:flex; align-items:center; gap:7px; border-radius:4px; padding:4px 0; min-height:28px; }
    kbd { font-family:inherit; font-size:10px; color:#424242; background:#42424205; border:1px solid #42424226; border-bottom-width:2px; padding:1px 5px; border-radius:4px; min-width:21px; text-align:center; }
    .hint { font-size:11px; color:#424242; }
    .notice { margin:6px 20px 0; padding:8px 12px; background:#fd556414; border:1px solid #fd556466; border-radius:8px; color:#424242; font-size:12px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .notice button { white-space:nowrap; text-decoration:underline; }
    .empty-state { grid-column:2; grid-row:1 / 4; align-self:center; text-align:center; padding:30px 15px; }
    .empty-mark { width:60px; height:60px; border-radius:50%; background:#fe3c721a; display:grid; place-content:center; color:#424242; font-size:26px; margin:0 auto 22px; }
    h2 { font-family:Georgia,"Times New Roman",serif; font-size:30px; font-weight:400; letter-spacing:-.025em; margin:0 0 12px; }
    .empty-state p { max-width:430px; color:#424242; margin:10px auto; line-height:1.8; }
    .empty-actions { display:flex; justify-content:center; flex-wrap:wrap; gap:12px; margin-top:25px; }
    .button { padding:10px 17px; border:1px solid #42424226; border-radius:7px; font-size:13px; background:#ffffff; }
    .button.primary { background:#fe3c7226; border-color:#fe3c72; color:#424242; }
    .modal-layer { position:absolute; inset:0; background:#42424240; backdrop-filter:blur(4px); display:grid; place-items:center; padding:24px; z-index:5; }
    .panel { width:min(700px,100%); max-height:90vh; max-height:90dvh; background:#ffffff; border:1px solid #42424226; border-radius:14px; box-shadow:0 25px 90px #42424226; padding:28px; display:flex; flex-direction:column; }
    .panel-head { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:15px; }
    .panel-head h2 { font-size:25px; margin:0; }
    .panel-body { min-height:0; overflow:auto; overscroll-behavior:contain; color:#424242; white-space:pre-wrap; overflow-wrap:anywhere; }
    .panel-body p { margin:0 0 18px; }
    .panel-body h3 { font-size:16px; margin:6px 0 10px; }
    .panel-body dl { display:grid; grid-template-columns:130px 1fr; gap:8px 20px; font-size:13px; }
    .panel-body dt { color:#424242; }
    .panel-body dd { margin:0; }
    .panel-body a { color:#424242; text-decoration-color:#fe3c72; }
    .panel-body .detail-title { font-size:var(--title-size,20px); font-weight:700; line-height:1.4; }
    .panel-body .detail-abstract { font-size:var(--abstract-size,20px); line-height:1.5; }
    .panel.typography { width:min(360px,100%); }
    .type-controls { white-space:normal; }
    .type-toggle { display:flex; align-items:center; gap:9px; margin-bottom:24px; }
    .type-controls input { accent-color:#fe3c72; }
    .type-toggle input { width:17px; height:17px; margin:0; }
    .type-field { display:grid; grid-template-columns:1fr auto; gap:9px; margin-top:18px; }
    .type-field output { font-variant-numeric:tabular-nums; }
    .type-field input { grid-column:1 / -1; width:100%; margin:0; }
    pre { font:12px/1.6 ui-monospace,monospace; white-space:pre-wrap; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @media(max-width:1050px) {
      header { flex-wrap:wrap; } .header-right { margin-left:auto; }
      .bid-summary { order:3; width:100%; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); padding-bottom:4px; }
      .bid-total { justify-content:space-between; min-width:0; padding:4px 6px; gap:4px; }
    }
    @media(max-width:480px) {
      .bid-summary { gap:4px; } .bid-total { flex-direction:column; justify-content:center; gap:2px; text-align:center; font-size:10px; }
      .bid-total dt { max-width:none; min-height:2.5em; display:flex; align-items:center; } .bid-total dd { font-size:14px; }
    }
    @media(max-width:760px) {
      header { padding:4px 10px; gap:8px; } .header-right { gap:4px; } .brand { gap:7px; } .brand-name { font-size:12px; } .github-mark { width:22px; height:22px; }
      .work-area { grid-template-columns:80px minmax(0,1fr); } .paper-sidebar { gap:4px; padding:8px 5px 0; } #paper-sort { font-size:11px; padding:4px 0; min-height:36px; } .paper-item { padding:7px 5px; justify-content:center; } .paper-bid { display:none; } .paper-number { font-size:12px; }
      .workspace { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); grid-template-rows:minmax(0,1fr)48px; gap:4px; padding:7px 7px 0; }
      .card-slot { grid-column:1 / 5; grid-row:1; } .card { padding:16px; box-shadow:0 9px 24px #42424208,0 2px 3px #42424205; } .paper-line { margin-bottom:8px; }
      .card-foot { grid-template-columns:1fr auto; gap:5px; } .card-foot > button { grid-column:2; grid-row:1; } .paper-context { grid-column:1 / -1; grid-row:2; text-align:left; }
      .decision { padding:3px 2px; flex-direction:column!important; font-size:9px; letter-spacing:.03em; min-width:0; min-height:44px; width:100%; gap:3px; }
      .decision[data-direction=left] { grid-column:1; grid-row:2; } .decision[data-direction=down] { grid-column:2; grid-row:2; }
      .decision[data-direction=right] { grid-column:3; grid-row:2; } .decision[data-direction=up] { grid-column:4; grid-row:2; }
      .empty-state { grid-column:1 / 5; grid-row:1 / 3; } footer { padding:2px 12px 4px; } .shortcuts { gap:14px; } .hint { display:none; }
      .notice { margin:4px 12px 0; background:#fd556414; border:1px solid #fd556466; } .panel { padding:22px; box-shadow:0 25px 90px #42424226; } .modal-layer { padding:14px; background:#42424240; } .panel-body dl { grid-template-columns:95px 1fr; }
    }
    @media(max-width:380px) { .brand-name { font-size:11px; } .brand { gap:5px; } .github-mark { width:20px; height:20px; } header { padding-inline:8px; gap:6px; } .header-right { gap:2px; } .header-right > .text-button { padding-inline:5px; } .card { padding:12px; } .decision { font-size:8px; } }
    @media(pointer:coarse) { .icon-button { width:44px; height:44px; } .brand,.shortcut,.header-right > .text-button,#paper-sort { min-height:44px; } }
    @media(pointer:coarse) and (min-width:761px) { .workspace { grid-template-rows:44px minmax(0,1fr)44px; } .decision { min-height:44px; } }
    @media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
  `;
  root.append(style);

  const shell = document.createElement('section');
  shell.className = 'shell';
  shell.tabIndex = -1;
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-label', 'Purr Review');
  shell.innerHTML = `
    <header>
      <a class="brand" href="https://github.com/lmwnshn/purr-review" target="_blank" rel="noopener noreferrer" aria-label="lmwnshn/purr-review on GitHub" title="GitHub"><svg class="github-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg><span class="brand-name">lmwnshn/purr-review</span></a>
      <dl class="bid-summary" aria-label="Bid counts for loaded papers" title="Loaded papers with known bids. TBD means Not Entered; unknown bids and conflicts are excluded.">
        ${COUNT_BIDS.map(bid => `<div class="bid-total" data-count-bid="${bid}"><dt>${bid === 'Not Entered' ? 'TBD' : bid}</dt><dd>0</dd></div>`).join('')}
      </dl>
      <div class="header-right"><label class="next-mode" title="Checked: advance to the next TBD. Unchecked: advance to the next paper in the sorted list."><input type="checkbox" id="next-tbd" checked>Next TBD only</label><button class="text-button" data-action="download" title="Download papers and decisions as CSV">Download</button><button class="text-button type-button" data-action="text-size" aria-label="Text size">Text size</button><button class="icon-button" data-action="exit" aria-label="Exit Purr Review" title="Exit (Esc)">×</button></div>
    </header>
    <div class="notice" role="alert" hidden><span></span><button data-action="exit">Return to CMT ↗</button></div>
    <div class="work-area">
    <aside class="paper-sidebar" aria-label="Papers"><label class="sort-label" for="paper-sort">Sort</label><select id="paper-sort" aria-label="Sort papers"><option value="id-asc">Paper ID ↑</option><option value="id-desc">Paper ID ↓</option><option value="relevance-desc">Relevance ↓</option><option value="relevance-asc">Relevance ↑</option><option value="decision-asc">Decision ↑</option><option value="decision-desc">Decision ↓</option></select><nav class="paper-list" aria-label="Paper list"></nav></aside>
    <main class="workspace">
      <div class="card-slot"><article class="card" aria-label="Current paper">
        <div class="stamp" aria-hidden="true"></div>
        <div class="paper-line"><span class="eyebrow paper-id"></span></div>
        <div class="reading" tabindex="0" aria-label="Paper title and abstract; scroll to read">
          <h1></h1><div class="rule"></div><p class="abstract"></p><div class="topics"></div>
        </div>
        <div class="card-foot"><span class="grip" title="Drag here to swipe in any direction">Drag to decide</span><span class="paper-context" tabindex="0" aria-label="Track, subjects, relevance and TPMS"></span><button class="text-button" data-action="details">Full details ↗</button></div>
      </article></div>
      ${BIDS.map((bid, i) => `<button class="decision" data-action="bid" data-bid="${bid}" data-direction="${DIRECTIONS[i]}" title="${ARROWS[i]} ${bid}" aria-label="${bid} (${DIRECTIONS[i]} arrow)"><span class="arrow" aria-hidden="true">${ARROWS[i]}</span><span>${bid}</span></button>`).join('')}
      <div class="empty-state" hidden><div class="empty-mark" aria-hidden="true">✓</div><h2></h2><p></p><div class="empty-actions"><button class="button primary" data-action="revisit-skipped">Revisit skipped</button><button class="button" data-action="exit">Back to CMT ↗</button></div></div>
    </main>
    </div>
    <footer><div class="shortcuts"><button class="shortcut" data-action="undo" title="Undo last bid"><kbd>Z</kbd> Undo</button><button class="shortcut" data-action="details"><kbd>↵</kbd> Details</button><button class="shortcut" data-action="skip"><kbd>S</kbd> Skip</button></div><div class="hint">Arrow keys to decide · Esc to exit</div></footer>
    <div class="sr-only" aria-live="polite" aria-atomic="true" id="announcement"></div>
    <div class="modal-layer" hidden><section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><div class="panel-head"><h2 id="panel-title"></h2><button class="icon-button" data-action="close-panel" aria-label="Close panel">×</button></div><div class="panel-body"></div></section></div>
  `;
  root.append(shell);
  document.documentElement.append(host);
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  const card = $('.card');
  const stamp = $('.stamp');
  let gesture = null;
  let frame = 0;
  let checkFrame = 0;
  let fitFrame = 0;
  let panelFocus = null;
  const reading = $('.reading');

  function applyFontSizes(title, abstract) {
    shell.style.setProperty('--title-size', `${title}px`);
    shell.style.setProperty('--abstract-size', `${abstract}px`);
    state.typography.effectiveTitle = title;
    state.typography.effectiveAbstract = abstract;
  }

  function syncTypeControls() {
    if (state.panel !== 'typography') return;
    const type = state.typography;
    $('#auto-fit').checked = type.auto;
    for (const key of ['title', 'abstract']) {
      const size = type.auto ? type[key === 'title' ? 'effectiveTitle' : 'effectiveAbstract'] : type[key];
      $(`#${key}-size`).value = String(size);
      $(`#${key}-size-value`).textContent = `${size} px`;
    }
  }

  function fitText() {
    if (state.destroyed) return;
    const type = state.typography;
    if (!type.auto) applyFontSizes(type.title, type.abstract);
    else if (state.current && reading.clientHeight > 0) {
      let low = 12;
      let high = 20;
      let best = 12;
      while (low <= high) {
        const size = Math.floor((low + high) / 2);
        applyFontSizes(size, size);
        if (reading.scrollHeight <= reading.clientHeight + 1 && reading.scrollWidth <= reading.clientWidth + 1) {
          best = size;
          low = size + 1;
        } else high = size - 1;
      }
      applyFontSizes(best, best);
    }
    syncTypeControls();
  }

  function scheduleFit() {
    if (fitFrame || state.destroyed) return;
    fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitText(); });
  }

  const readingObserver = new ResizeObserver(scheduleFit);
  readingObserver.observe(reading);

  function announce(message) { $('#announcement').textContent = message; }
  function setStatus(text) { state.status = text; announce(text); renderStatus(); }
  function currentBid(paper) {
    return paper.disabledReason ? paper.existingBid : state.bids.get(paper.id);
  }

  function downloadCSV() {
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['Title', 'Abstract', 'Decision', 'Relevance', 'TPMS'], ...state.papers.map(paper => {
      const bid = currentBid(paper);
      return [paper.title, paper.abstract, bid === 'Not Entered' ? 'TBD' : bid || 'Unavailable', paper.relevance, paper.tpmsRank];
    })];
    const csv = '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'purr-review.csv';
    link.hidden = true;
    root.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function renderBidCounts() {
    const counts = new Map(COUNT_BIDS.map(bid => [bid, 0]));
    for (const paper of state.papers) {
      const bid = currentBid(paper);
      if (counts.has(bid)) counts.set(bid, counts.get(bid) + 1);
    }
    for (const item of $$('.bid-total')) item.querySelector('dd').textContent = String(counts.get(item.dataset.countBid));
  }

  function renderStatus() {
    renderBidCounts();
    $('[data-action="download"]').disabled = state.busy || !state.papers.length;
    const message = state.pageDialog ? 'CMT has opened a dialog. Return to CMT to resolve it before continuing.' : state.error;
    $('.notice').hidden = !message;
    $('.notice span').textContent = message;
    const locked = state.busy || state.blocked || state.pageDialog || !!state.fatal;
    card.setAttribute('aria-busy', String(state.busy));
    $$('.decision').forEach(button => { button.disabled = locked || !canBid(state.current); });
    $$('[data-action="skip"]').forEach(button => { button.disabled = locked || !state.current; });
    $$('[data-action="details"]').forEach(button => { button.disabled = !state.current || state.busy; });
    $('[data-action="undo"]').disabled = state.blocked || state.pageDialog || state.undoRequested || (!state.history.length && !state.busy);
    $('[data-action="revisit-skipped"]').disabled = locked;
    $('[data-action="text-size"]').disabled = state.busy;
    $$('.paper-item').forEach(button => { button.disabled = locked; });
    $('#paper-sort').disabled = locked;
    $('#next-tbd').disabled = locked;
  }

  function canBid(paper) {
    return !!paper && !paper.disabledReason && !!state.bids.get(paper.id);
  }

  function comparePapers(a, b) {
    const byID = a.id.localeCompare(b.id, undefined, { numeric: true });
    if (state.sort.startsWith('id-')) return state.sort === 'id-desc' ? -byID : byID;
    if (state.sort.startsWith('decision-')) {
      const rank = paper => {
        const bid = currentBid(paper);
        const index = BIDS.indexOf(bid);
        if (index < 0) return bid === 'Not Entered' ? BIDS.length : BIDS.length + 1;
        return state.sort === 'decision-desc' ? BIDS.length - 1 - index : index;
      };
      return rank(a) - rank(b) || byID;
    }
    const score = paper => {
      const value = String(paper.relevance ?? '').trim();
      return value && Number.isFinite(Number(value)) ? Number(value) : null;
    };
    const left = score(a);
    const right = score(b);
    if (left === null || right === null) return left === right ? byID : left === null ? 1 : -1;
    return (state.sort === 'relevance-desc' ? right - left : left - right) || byID;
  }

  function nextInList(paper) {
    const papers = [...state.papers].sort(comparePapers);
    if (papers.length < 2) return null;
    return papers[(papers.findIndex(item => item.id === paper.id) + 1) % papers.length];
  }

  function orderQueue() {
    state.queue.sort(comparePapers);
    if (!state.current || !state.queue.length) return;
    let index = state.queue.findIndex(paper => paper.id === state.current.id);
    if (index < 0) index = state.queue.findIndex(paper => comparePapers(paper, state.current) > 0);
    if (index > 0) state.queue = [...state.queue.slice(index), ...state.queue.slice(0, index)];
  }

  function renderSidebar() {
    const list = $('.paper-list');
    const focused = root.activeElement?.closest('.paper-item')?.dataset.paperId;
    const buttons = [...state.papers].sort(comparePapers).map(paper => {
      const bid = canBid(paper) ? state.bids.get(paper.id) : 'Unavailable';
      const label = bid === 'Not Entered' ? 'Unbid' : bid;
      const button = makeText('button', '', 'paper-item');
      button.dataset.action = 'jump-paper';
      button.dataset.paperId = paper.id;
      button.dataset.bid = label.toLowerCase().replaceAll(' ', '-');
      button.setAttribute('aria-label', `Paper ${paper.id}, ${label}`);
      button.title = `${paper.id} · ${label}${paper.disabledReason ? ` · ${paper.disabledReason}` : ''}`;
      if (state.current?.id === paper.id) button.setAttribute('aria-current', 'true');
      button.append(makeText('span', paper.id, 'paper-number'), makeText('span', label, 'paper-bid'));
      return button;
    });
    list.replaceChildren(...buttons);
    if (focused) buttons.find(button => button.dataset.paperId === focused)?.focus({ preventScroll: true });
    const selected = buttons.find(button => button.hasAttribute('aria-current'));
    if (selected) {
      const itemRect = selected.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
      else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
    }
  }

  function jumpPaper(id) {
    if (state.busy || state.blocked || state.pageDialog || state.panel || state.destroyed) return;
    const paper = state.papers.find(item => item.id === id);
    if (!paper) return;
    state.queue = state.queue.filter(item => state.bids.get(item.id) === 'Not Entered');
    state.skipped = state.skipped.filter(item => item.id !== id);
    if (canBid(paper) && !state.queue.some(item => item.id === id)) state.queue.push(paper);
    state.current = paper;
    orderQueue();
    renderPaper();
    shell.focus({ preventScroll: true });
  }

  function renderPaper() {
    if (state.destroyed) return;
    cancelGesture();
    card.style.transform = '';
    card.style.opacity = '';
    const paper = state.current;
    $('.card-slot').hidden = !paper;
    $$('.decision').forEach(button => { button.hidden = !paper; });
    $('.empty-state').hidden = !!paper;
    if (paper) {
      $('.paper-id').textContent = `Paper ${paper.id}`;
      let bid;
      try { bid = canBid(paper) ? adapter.getBid(paper) : null; } catch (error) { fail(error); }
      state.displayedBid = bid;
      state.bids.set(paper.id, bid);
      $('h1').textContent = paper.title;
      $('.abstract').textContent = paper.abstract || 'No abstract available.';
      $('.abstract').classList.toggle('empty', !paper.abstract);
      $('.topics').replaceChildren(...(paper.topics || []).slice(0, 4).map(topic => makeText('span', topic, 'topic')));
      if ((paper.topics || []).length > 4) $('.topics').append(makeText('span', `+${paper.topics.length - 4} in details`, 'topic'));
      const context = `${paper.track || '—'} → ${paper.primarySubject || '—'} → ${(paper.secondarySubjects || []).join(', ') || '—'} (Relevance: ${formatScore(paper.relevance)}, TPMS: ${formatScore(paper.tpmsRank)})`;
      $('.paper-context').textContent = context;
      $('.paper-context').title = context;
      $('.paper-context').scrollTop = 0;
      $('.reading').scrollTop = 0;
      scheduleFit();
      announce(`Paper ${paper.id}. ${paper.title}. Current bid: ${bid || 'unknown'}.`);
    } else {
      const fatal = state.fatal;
      $('.empty-mark').textContent = fatal ? '!' : '✓';
      $('.empty-state h2').textContent = fatal ? 'Papers not detected' : state.skipped.length ? 'Skipped papers remaining' : state.processed.size ? 'Queue complete' : state.existing.length ? 'No unbid papers' : 'No papers';
      $('.empty-state p').textContent = fatal || '';
      $('[data-action="revisit-skipped"]').hidden = !state.skipped.length || !!fatal;
    }
    renderSidebar();
    renderStatus();
  }

  function makeText(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function formatScore(value) {
    const text = String(value ?? '').trim();
    if (!text) return '—';
    const number = Number(text);
    return Number.isFinite(number) ? number.toFixed(2) : text;
  }

  function fail(error) {
    if (state.destroyed || signal.aborted) return;

    state.error = error?.message || String(error);
    state.blocked = true;
    state.undoRequested = false;
    state.status = 'Check CMT';
    announce(`Could not confirm the bid. ${state.error}`);
    renderStatus();
  }

  async function serialize(operation) {
    if (state.busy || state.blocked || state.pageDialog || state.destroyed) return;
    state.busy = true;
    renderStatus();
    try { await operation(); }
    catch (error) { fail(error); }
    finally {
      if (!state.destroyed) {
        state.busy = false;
        if (state.blocked) renderPaper();
        renderStatus();
        if (state.undoRequested && !state.blocked) {
          state.undoRequested = false;
          undo();
        }
      }
    }
  }

  async function animateCard(keyframes, duration = 180) {
    if (reducedMotion.matches || signal.aborted || !card.animate) return;
    let animation;
    try { animation = card.animate(keyframes, { duration, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'none' }); }
    catch (_) { return; }
    animationSet.add(animation);
    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        animationSet.delete(animation);
        animation.cancel();
        resolve();
      };
      const timer = setTimeout(finish, Math.max(350, duration + 200));
      signal.addEventListener('abort', finish, { once: true });
      animation.finished.then(finish, finish);
    });
  }

  async function slide(bid) {
    const vectors = { 'Not Willing': [-130, 0, -5], 'Willing': [130, 0, 5], 'Eager': [0, -95, 0], 'In a Pinch': [0, 95, 0] };
    const [x, y, r] = vectors[bid];
    const paper = state.current;
    const from = card.style.transform || 'translate(0,0) rotate(0deg)';
    const to = `translate(${x}px,${y}px) rotate(${r}deg)`;
    await animateCard([{ transform: from, opacity: 1 }, { transform: to, opacity: .2 }]);
    if (state.current === paper && state.busy && !state.blocked && !state.destroyed) {

      card.style.transform = reducedMotion.matches ? '' : to;
      card.style.opacity = '.2';
    }
  }
  function enter() {
    return animateCard([{ transform: 'translateY(12px) scale(.99)', opacity: .3 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], 190);
  }

  function decide(bid) {
    if (!canBid(state.current) || !BIDS.includes(bid) || state.panel || state.busy || state.blocked || state.pageDialog) return;
    const paper = state.current;
    const next = state.nextTBD ? null : nextInList(paper);
    cancelGesture(false);
    serialize(async () => {
      const previousBid = state.displayedBid;
      if (!previousBid) throw new Error('The current CMT bid could not be read safely. Return to CMT and inspect this paper.');
      if (adapter.getBid(paper) !== previousBid) throw new Error('This bid changed in CMT after the card was displayed. Return to CMT and check it before continuing.');
      setStatus('Confirming in CMT…');

      await Promise.all([adapter.setBid(paper, bid, { expectedPrevious: previousBid }), slide(bid)]);
      if (signal.aborted) return;
      state.history.push({ paper, previousBid, newBid: bid, wasProcessed: state.processed.has(paper.id) });
      state.processed.add(paper.id);
      state.bids.set(paper.id, bid);
      state.queue = state.queue.filter(item => item.id !== paper.id);
      state.current = state.nextTBD ? state.queue[0] || null : next;
      if (!state.nextTBD) orderQueue();
      state.status = 'Confirmed in CMT';
      renderPaper();
      if (state.current) await enter();
    });
  }

  function undo() {
    if (state.blocked || state.pageDialog || state.panel || state.destroyed) return;
    if (state.busy) {
      state.undoRequested = true;
      announce('Undo queued. Waiting for CMT to finish the current change.');
      renderStatus();
      return;
    }
    const entry = state.history[state.history.length - 1];
    if (!entry) return;
    serialize(async () => {
      setStatus('Restoring previous bid…');
      await adapter.setBid(entry.paper, entry.previousBid, { expectedPrevious: entry.newBid });
      if (signal.aborted) return;
      state.history.pop();
      if (!entry.wasProcessed) state.processed.delete(entry.paper.id);
      state.bids.set(entry.paper.id, entry.previousBid);
      state.queue = [entry.paper, ...state.queue.filter(paper => paper.id !== entry.paper.id)];
      state.skipped = state.skipped.filter(paper => paper.id !== entry.paper.id);
      state.current = entry.paper;
      orderQueue();
      state.status = 'Previous bid restored';
      state.undoRequested = false;
      renderPaper();
      await enter();
    });
  }

  async function skip() {
    if (!state.current || state.busy || state.blocked || state.pageDialog || state.panel) return;

    state.busy = true;
    setStatus('Skipping…');
    const paper = state.current;
    const next = state.nextTBD ? null : nextInList(paper);
    await animateCard([{ opacity: 1 }, { opacity: 0, transform: 'translateY(8px)' }], 110);
    if (signal.aborted) return;
    if (canBid(paper) && !state.skipped.some(item => item.id === paper.id)) state.skipped.push(paper);
    state.queue = state.queue.filter(item => item.id !== paper.id);
    state.current = state.nextTBD ? state.queue[0] || null : next;
    if (!state.nextTBD) orderQueue();
    state.status = 'Skipped · bid unchanged';
    renderPaper();
    if (state.current) await enter();
    state.busy = false;
    renderStatus();
    if (state.undoRequested) { state.undoRequested = false; undo(); }
  }

  function revisitSkipped() {
    if (state.busy || state.blocked || state.pageDialog || !state.skipped.length) return;
    const ids = new Set(state.queue.map(paper => paper.id));
    state.queue.push(...state.skipped.filter(paper => !ids.has(paper.id)));
    state.skipped = [];
    orderQueue();
    state.current = state.queue[0] || null;
    renderPaper();
  }

  function diagnostics() {
    return {
      version: '1.1.0', adapter: adapter.diagnostics(),
      session: { loaded: state.papers.length, initiallyBid: state.existing.length, unavailable: state.unavailable.length,
        confirmed: state.processed.size, remaining: state.queue.length, skipped: state.skipped.length,
        history: state.history.length, busy: state.busy, blocked: state.blocked, pageDialog: state.pageDialog },
      note: 'Only loaded DOM rows are included. Confirmation means CMT closed its editor and reflected the requested bid. No paper text or credentials are included in this report.',
    };
  }

  function openPanel(type) {
    if (state.busy || (type === 'details' && !state.current)) return;
    cancelGesture();
    panelFocus = root.activeElement;
    state.panel = type;
    $('.panel').classList.toggle('typography', type === 'typography');
    const body = $('.panel-body');
    body.replaceChildren();
    if (type === 'typography') {
      $('#panel-title').textContent = 'Text size';
      body.innerHTML = `<div class="type-controls"><label class="type-toggle"><input id="auto-fit" type="checkbox"> Auto fit</label><div class="type-field"><label for="title-size">Title</label><output id="title-size-value" for="title-size"></output><input id="title-size" type="range" min="12" max="36" step="1"></div><div class="type-field"><label for="abstract-size">Abstract</label><output id="abstract-size-value" for="abstract-size"></output><input id="abstract-size" type="range" min="12" max="36" step="1"></div></div>`;
      syncTypeControls();
    } else {
      const paper = state.current;
      $('#panel-title').textContent = `Paper ${paper.id} · Details`;
      body.append(makeText('h3', paper.title, 'detail-title'));
      body.append(makeText('p', paper.abstract || 'No abstract is available in the loaded page.', 'detail-abstract'));
      const list = document.createElement('dl');
      let bid;
      try { bid = adapter.getBid(paper); } catch (_) { bid = 'Unavailable'; }
      [{ label: 'Current bid', value: bid || 'Unknown' }, ...(paper.metadata || []), { label: 'Subject areas', value: (paper.topics || []).join(' · ') || 'Not exposed' }].forEach(({ label, value }) => {
        list.append(makeText('dt', label), makeText('dd', String(value ?? '')));
      });
      body.append(list);
      if (paper.detailsUrl) {
        try {
          const url = new URL(paper.detailsUrl, location.href);
          if (url.origin === location.origin && /^https?:$/.test(url.protocol)) {
            const link = makeText('a', 'Open CMT submission summary ↗');
            link.href = url.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            body.append(link);
          }
        } catch (_) {  }
      }
    }
    $('.modal-layer').hidden = false;
    $('[data-action="close-panel"]').focus({ preventScroll: true });
  }

  function closePanel() {
    state.panel = null;
    $('.modal-layer').hidden = true;
    if (panelFocus?.isConnected && !panelFocus.disabled) panelFocus.focus({ preventScroll: true });
    else shell.focus({ preventScroll: true });
  }

  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary || state.busy || state.blocked || state.pageDialog || state.panel || !canBid(state.current)) return;
    if (event.target.closest('button,a,input,select,textarea,.paper-context')) return;
    const handle = event.target.closest('.grip');
    const touch = event.pointerType !== 'mouse';
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, started: false,
      touch, handle: !!handle, threshold: Math.max(65, Math.min(125, card.getBoundingClientRect().width * .19)), bid: null };
    if (!touch || handle) event.preventDefault();
  }
  function pointerMove(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    const g = gesture;
    g.dx = event.clientX - g.x;
    g.dy = event.clientY - g.y;
    if (!g.started && Math.hypot(g.dx, g.dy) < 9) return;
    if (!g.started && g.touch && !g.handle && Math.abs(g.dy) >= Math.abs(g.dx)) { cancelGesture(); return; }
    if (!g.started) {
      g.started = true;
      card.setPointerCapture(g.id);
      card.classList.add('dragging');
    }
    if (event.cancelable) event.preventDefault();
    g.bid = Math.abs(g.dx) >= Math.abs(g.dy) ? (g.dx < 0 ? 'Not Willing' : 'Willing') : (g.dy < 0 ? 'Eager' : 'In a Pinch');
    if (!frame) frame = requestAnimationFrame(paintGesture);
  }
  function paintGesture() {
    frame = 0;
    if (!gesture?.started) return;
    const { dx, dy, threshold, bid } = gesture;
    const strength = Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / threshold);
    card.style.transform = `translate(${dx}px,${dy}px) rotate(${Math.max(-8, Math.min(8, dx / 35))}deg)`;
    stamp.textContent = bid;
    stamp.style.opacity = String(strength);
    $$('.decision').forEach(button => {
      button.classList.toggle('candidate', button.dataset.bid === bid);
      button.style.opacity = button.dataset.bid === bid ? String(.5 + strength * .5) : '';
    });
  }
  function pointerUp(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    const g = gesture;
    const commit = g.started && Math.max(Math.abs(g.dx), Math.abs(g.dy)) >= g.threshold;
    const from = card.style.transform || 'none';
    cancelGesture(!commit);
    if (commit) decide(g.bid);
    else if (g.started) animateCard([{ transform: from }, { transform: 'translate(0,0) rotate(0deg)' }], 230);
  }
  function cancelGesture(reset = true) {
    const active = gesture;
    gesture = null;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (active && card.hasPointerCapture(active.id)) card.releasePointerCapture(active.id);
    card.classList.remove('dragging');
    stamp.style.opacity = '0';
    $$('.decision').forEach(button => { button.classList.remove('candidate'); button.style.opacity = ''; });
    if (reset) card.style.transform = '';
  }

  function keyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) { if (state.panel) closePanel(); else destroy(); }
      return;
    }
    if (event.key === 'Tab') {
      const area = state.panel ? $('.panel') : shell;
      const focusable = [...area.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (root.activeElement === first || !area.contains(root.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (root.activeElement === last || !area.contains(root.activeElement))) { event.preventDefault(); first?.focus(); }
      event.stopImmediatePropagation();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (state.panel) { event.stopImmediatePropagation(); return; }
    if (root.activeElement?.matches('input,select,textarea')) { event.stopImmediatePropagation(); return; }
    if (root.activeElement?.matches('.paper-item') && (KEY_BIDS[event.key] || ['Home', 'End'].includes(event.key))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const items = $$('.paper-item:not(:disabled)');
      const index = items.indexOf(root.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
      items[next]?.focus();
      return;
    }
    if (root.activeElement?.matches('.paper-context') && (KEY_BIDS[event.key] || event.key === ' ')) {
      event.stopImmediatePropagation();
      return;
    }
    const key = event.key.toLowerCase();
    const handled = KEY_BIDS[event.key] || key === 'z' || key === 's' || event.key === 'Enter' || event.key === ' ';
    if (!handled) return;

    if ((event.key === 'Enter' || event.key === ' ') && root.activeElement?.matches('button,a')) {
      if (event.repeat) event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (KEY_BIDS[event.key]) decide(KEY_BIDS[event.key]);
    else if (key === 'z') undo();
    else if (key === 's' || event.key === ' ') skip();
    else openPanel('details');
  }

  function visiblePageDialog() {

    return [...document.querySelectorAll('.modal.show,[role="dialog"],dialog[open]')].some(element => {
      if (element === host || element.getAttribute('aria-hidden') === 'true') return false;
      const computed = getComputedStyle(element);
      return computed.display !== 'none' && computed.visibility !== 'hidden' && element.getClientRects().length > 0;
    });
  }
  function checkPage() {
    checkFrame = 0;
    if (state.destroyed) return;
    const open = visiblePageDialog();
    if (state.pageDialog !== open) { state.pageDialog = open; renderStatus(); }
  }
  const pageObserver = new MutationObserver(() => {
    if (!checkFrame) checkFrame = requestAnimationFrame(checkPage);
  });
  pageObserver.observe(document.body || document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'aria-hidden'] });

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    lifetime.abort();
    pageObserver.disconnect();
    readingObserver.disconnect();
    cancelGesture();
    if (checkFrame) cancelAnimationFrame(checkFrame);
    if (fitFrame) cancelAnimationFrame(fitFrame);
    animationSet.forEach(animation => animation.cancel());
    host.remove();
    if (window[GLOBAL] === api) delete window[GLOBAL];
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });

  }

  const api = { destroy, diagnostics, focus: () => shell.focus({ preventScroll: true }) };
  window[GLOBAL] = api;
  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const actions = { bid: () => decide(button.dataset.bid), undo, skip, details: () => openPanel('details'),
      download: downloadCSV, exit: destroy, 'jump-paper': () => jumpPaper(button.dataset.paperId), 'revisit-skipped': revisitSkipped,
      'text-size': () => openPanel('typography'), 'close-panel': closePanel };
    actions[button.dataset.action]?.();
  }, { signal });
  root.addEventListener('change', event => {
    if (event.target.id === 'next-tbd') {
      if (state.busy || state.blocked || state.pageDialog || state.panel) {
        event.target.checked = state.nextTBD;
        return;
      }
      state.nextTBD = event.target.checked;
      state.queue = state.papers.filter(paper => canBid(paper) && currentBid(paper) === 'Not Entered' && !state.skipped.some(item => item.id === paper.id));
      orderQueue();
      if (!state.current) state.current = state.nextTBD ? state.queue[0] || null : [...state.papers].sort(comparePapers)[0] || null;
      renderPaper();
      return;
    }
    if (event.target.id !== 'paper-sort') return;
    const sort = event.target.value;
    if (state.busy || state.blocked || state.pageDialog || state.panel || !['id-asc', 'id-desc', 'relevance-asc', 'relevance-desc', 'decision-asc', 'decision-desc'].includes(sort)) {
      event.target.value = state.sort;
      return;
    }
    state.sort = sort;
    orderQueue();
    renderSidebar();
    renderStatus();
  }, { signal });
  root.addEventListener('input', event => {
    if (state.panel !== 'typography') return;
    const type = state.typography;
    if (event.target.id === 'auto-fit') type.auto = event.target.checked;
    else {
      const key = { 'title-size': 'title', 'abstract-size': 'abstract' }[event.target.id];
      if (!key) return;
      if (type.auto) {
        type.title = type.effectiveTitle;
        type.abstract = type.effectiveAbstract;
        type.auto = false;
      }
      const size = Number(event.target.value);
      if (!Number.isFinite(size)) return;
      type[key] = Math.min(36, Math.max(12, Math.round(size)));
    }
    fitText();
  }, { signal });
  document.addEventListener('keydown', keyDown, { capture: true, signal });
  card.addEventListener('pointerdown', pointerDown, { signal });
  card.addEventListener('pointermove', pointerMove, { signal });
  card.addEventListener('pointerup', pointerUp, { signal });
  card.addEventListener('pointercancel', () => cancelGesture(), { signal });
  card.addEventListener('lostpointercapture', event => {

    if (event.target === card && !card.hasPointerCapture(event.pointerId)) cancelGesture();
  }, { signal });
  window.addEventListener('blur', () => cancelGesture(), { signal });
  window.addEventListener('resize', () => { cancelGesture(); scheduleFit(); }, { signal });
  window.addEventListener('pagehide', destroy, { signal });

  try {
    state.papers = adapter.discoverPapers();
    state.bids = new Map(state.papers.map(paper => [paper.id, paper.existingBid]));
    state.unavailable = state.papers.filter(paper => paper.disabledReason || !paper.existingBid);
    const available = state.papers.filter(paper => !paper.disabledReason && paper.existingBid);
    state.existing = available.filter(paper => paper.existingBid !== 'Not Entered');
    state.queue = available.filter(paper => paper.existingBid === 'Not Entered');
    orderQueue();
    state.current = state.queue[0] || null;
  } catch (error) {
    state.fatal = error.message;
    state.status = 'Detection needs attention';
  }
  renderPaper();
  checkPage();
  shell.focus({ preventScroll: true });
}

launchPurrReview();
