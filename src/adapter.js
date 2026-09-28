function createCMTAdapter({ signal, onDiagnostic } = {}) {
  const names = ['Not Entered', 'Not Willing', 'In a Pinch', 'Willing', 'Eager'];
  const records = new WeakMap();
  let operation = null;
  let lastConfirmation = null;
  const stats = { adapter: 'CMT inline bid editor', tables: 0, loadedRows: 0,
    papers: 0, editable: 0, existingBids: 0, unknownBids: 0, missingAbstracts: 0,
    skippedRows: 0, optionLabels: [], unavailableReasons: {}, lastResult: 'Not started' };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const canonical = value => names.find(name => name.toLowerCase() === clean(value).toLowerCase()) || null;
  const text = node => clean(node && node.textContent);
  const fail = message => { throw new Error(message); };
  const aborted = () => { if (signal && signal.aborted) throw new DOMException('Purr Review closed.', 'AbortError'); };
  const report = result => {
    stats.lastResult = result;
    if (onDiagnostic) onDiagnostic(diagnostics());
  };

  function visible(node) {
    if (!node || !node.isConnected) return false;
    for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (el.hidden || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function headerMap(table) {
    const grid = [];
    for (const [r, row] of Array.from(table.tHead ? table.tHead.rows : []).entries()) {
      grid[r] ||= [];
      let c = 0;
      for (const cell of row.cells) {
        while (grid[r][c]) c++;
        for (let y = r; y < r + (cell.rowSpan || 1); y++) {
          grid[y] ||= [];
          for (let x = c; x < c + (cell.colSpan || 1); x++) grid[y][x] = cell;
        }
        c += cell.colSpan || 1;
      }
    }
    const width = Math.max(0, ...grid.map(row => row.length));
    return Array.from({ length: width }, (_, column) => {
      const cells = [...new Set(grid.map(row => row[column]).filter(Boolean))];
      return cells.filter(cell => !/\bfilter\s*:/.test(cell.getAttribute('data-bind') || ''))
        .map(text).filter(Boolean).join(' / ');
    });
  }

  function column(headers, label) {
    const found = headers.map((header, index) => clean(header).toLowerCase() === label ? index : -1).filter(index => index >= 0);
    return found.length === 1 ? found[0] : -1;
  }

  function binding(root, property) {
    return Array.from(root.querySelectorAll('[data-bind]')).find(el =>
      new RegExp('(?:^|[,\\s])text\\s*:\\s*' + property + '(?:\\s*[,}]|\\s*$)').test(el.getAttribute('data-bind')));
  }

  function bidAnchors(cell) {
    return Array.from(cell.querySelectorAll('a,button')).filter(el =>
      clean(el.getAttribute('title')).toLowerCase() === 'click to change bid' ||
      /\bclick\s*:\s*(?:\$parent\.)?selectBid\b/.test(el.getAttribute('data-bind') || ''));
  }

  function disabled(control) {
    return !control || control.disabled || control.getAttribute('aria-disabled') === 'true' || control.closest('[inert],fieldset[disabled]');
  }

  function rowId(row, cell) {
    if (!cell) return null;
    const node = cell.querySelector('a[title="Submission summary"]') || binding(cell, 'id');
    const label = node ? text(node) : text(cell).match(/^\d+(?=\s|$)/)?.[0];
    const attr = clean(row.getAttribute('bidding'));
    if (!label || !/^\d+$/.test(label) || (attr && attr !== label)) return null;
    return label;
  }

  function discoverPapers() {
    aborted();
    const candidates = Array.from(document.querySelectorAll('table')).map(table => {
      const headers = headerMap(table);
      return { table, headers, id: column(headers, 'paper id'), title: column(headers, 'title'), bid: column(headers, 'your bid') };
    }).filter(item => item.id >= 0 && item.title >= 0 && item.bid >= 0);
    stats.tables = candidates.length;
    if (candidates.length !== 1) fail(candidates.length ?
      'More than one paper bidding table was found. Close the extra CMT view and relaunch.' :
      'No supported CMT bidding table was found. Open Reviewer Console with Paper ID, Title, and Your Bid columns.');
    const { table, headers, id, title, bid } = candidates[0];
    const fields = {
      track: column(headers, 'track'),
      primarySubject: column(headers, 'subject areas / primary'),
      secondarySubjects: column(headers, 'subject areas / secondary'),
      relevance: column(headers, 'relevance'),
      tpmsRank: column(headers, 'tpms rank'),
    };
    const rows = Array.from(table.tBodies).flatMap(body => Array.from(body.rows));
    stats.loadedRows = rows.length;
    Object.assign(stats, { papers: 0, editable: 0, existingBids: 0, unknownBids: 0, missingAbstracts: 0, skippedRows: 0, unavailableReasons: {} });
    const ids = new Set();
    const papers = [];
    for (const row of rows) {
      const cells = Array.from(row.cells);
      if (!cells[id] || !cells[title] || !cells[bid]) { stats.skippedRows++; continue; }
      const paperId = rowId(row, cells[id]);
      if (!paperId) { stats.skippedRows++; continue; }
      if (ids.has(paperId)) fail('Duplicate paper IDs were detected. Relaunch after CMT has finished loading; no bids were changed.');
      ids.add(paperId);
      const titleNode = binding(cells[title], 'title') || cells[title].querySelector('strong') || cells[title].querySelector('a');
      const abstractNode = binding(cells[title], 'abstract') || cells[title].querySelector('.abstract > div');
      const controls = bidAnchors(cells[bid]);
      const control = controls.length === 1 ? controls[0] : null;
      const rawBid = control ? text(control) : text(cells[bid]);
      const existingBid = canonical(rawBid);
      const topics = [];
      const metadata = [];
      headers.forEach((header, index) => {
        if (!cells[index] || [id, title, bid].includes(index)) return;
        if (/subject|topic/i.test(header)) {
          const items = Array.from(cells[index].querySelectorAll('li'));
          if (items.length) topics.push(...items.map(item => clean(item.getAttribute('title')) || text(item)));
          else if (text(cells[index])) topics.push(text(cells[index]));
        } else if (/^(track|relevance|tpms rank|conflicts?|status)$/i.test(header) && text(cells[index])) {
          metadata.push({ label: header, value: text(cells[index]) });
        }
      });
      let disabledReason = '';
      if (controls.length > 1) disabledReason = 'Multiple bid controls: cannot safely choose one.';
      else if (!control) disabledReason = 'CMT has disabled bidding for this paper, or its bid control is unavailable.';
      else if (disabled(control)) disabledReason = 'CMT has disabled this paper’s bid control.';
      else if (!existingBid) disabledReason = 'CMT shows an unknown or empty bid. Resolve it in CMT before triaging this paper.';
      else if (cells[bid].querySelector('select')) disabledReason = 'A CMT bid editor is already open. Finish it in CMT, then relaunch.';
      if (disabledReason) {
        const reason = controls.length > 1 ? 'ambiguousControls' : !control ? 'missingControl' : disabled(control) ? 'disabledControl' : !existingBid ? 'unknownBid' : 'openEditor';
        stats.unavailableReasons[reason] = (stats.unavailableReasons[reason] || 0) + 1;
      }
      let detailsUrl = '';
      const details = cells[id].querySelector('a[title="Submission summary"]') || cells[id].querySelector('a[href]');
      if (details) {
        try {
          const url = new URL(details.getAttribute('href'), location.href);
          if (/^https?:$/.test(url.protocol) && url.origin === location.origin && url.hash !== '#' && details.getAttribute('href') !== '#') detailsUrl = url.href;
        } catch (_) {  }
      }
      const abstract = (abstractNode?.textContent || '').replace(/\r\n?/g, '\n').trim();
      const secondarySubjects = cells[fields.secondarySubjects]
        ? Array.from(cells[fields.secondarySubjects].querySelectorAll('li')).map(item => clean(item.getAttribute('title')) || text(item)).filter(Boolean)
        : [];
      const paper = { id: paperId, title: text(titleNode) || 'Title unavailable', abstract,
        track: text(cells[fields.track]), primarySubject: text(cells[fields.primarySubject]),
        secondarySubjects: [...new Set(secondarySubjects)], relevance: text(cells[fields.relevance]), tpmsRank: text(cells[fields.tpmsRank]),
        topics: [...new Set(topics.filter(Boolean))], metadata, existingBid, disabledReason, detailsUrl, row };
      records.set(paper, { row, table, id, bid, paperId });
      papers.push(paper);
      if (!disabledReason) stats.editable++;
      if (existingBid && existingBid !== names[0]) stats.existingBids++;
      if (!existingBid) stats.unknownBids++;
      if (!paper.abstract) stats.missingAbstracts++;
    }
    stats.papers = papers.length;
    if (!papers.length) fail('The bidding table has no loaded paper rows. This may be unrendered page source: open the live CMT page, wait for papers to load, and launch there.');
    report('Loaded visible-page papers');
    return papers;
  }

  function locate(paper) {
    const record = records.get(paper);
    if (!record || !record.row.isConnected || !record.table.contains(record.row) ||
        rowId(record.row, record.row.cells[record.id]) !== record.paperId) {
      fail('CMT changed or unloaded this paper row. Exit and relaunch to refresh the paper list.');
    }
    const cell = record.row.cells[record.bid];
    if (!cell) fail('The CMT bid column changed. Exit and relaunch.');
    const controls = bidAnchors(cell);
    return { record, cell, controls, anchor: controls.length === 1 ? controls[0] : null };
  }

  function getBid(paper) {
    const { cell, anchor } = locate(paper);
    return canonical(text(anchor || cell));
  }

  function hasDialog() {
    return Array.from(document.querySelectorAll('[role="dialog"],dialog[open],.modal')).some(visible);
  }

  function rowBusy(row) {
    return Array.from(row.querySelectorAll('[aria-busy="true"]')).some(visible) || row.getAttribute('aria-busy') === 'true';
  }

  function pageBusy() {
    return Array.from(document.querySelectorAll('#progressIndicator,[role="progressbar"][aria-busy="true"]')).some(visible);
  }

  function busy(row) {
    return rowBusy(row) || pageBusy();
  }

  function confirmationState() {
    if (!operation) return null;
    const result = { stage: stats.lastResult, elapsedMs: Math.round(performance.now() - operation.started), requestedBid: operation.wanted };
    try {
      const { record, cell, controls, anchor } = locate(operation.paper);
      return { ...result, rowConnected: true, bid: canonical(text(anchor || cell)), anchorCount: controls.length,
        anchorVisible: visible(anchor), editors: cell.querySelectorAll('select').length,
        submittedEditorConnected: operation.select?.isConnected ?? null,
        rowBusy: rowBusy(record.row), pageBusy: pageBusy(), dialogOpen: hasDialog() };
    } catch (_) { return { ...result, rowConnected: false }; }
  }

  function alerts() {
    return new Map(Array.from(document.querySelectorAll('[role="alert"],.alert-danger,.alert-error,.validation-summary-errors'))
      .filter(el => visible(el) && text(el)).map(el => [el, text(el)]));
  }

  function verifyBid(paper, bid) {
    try {
      const { record, cell, anchor } = locate(paper);
      return !!canonical(bid) && !!anchor && visible(anchor) && !cell.querySelector('select') &&
        !busy(record.row) && !hasDialog() && canonical(text(anchor)) === canonical(bid);
    } catch (_) { return false; }
  }

  function waitFor(check, timeout, message) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let timer;
      const finish = (error, value) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(new DOMException('Purr Review closed.', 'AbortError'));
      const poll = () => {
        try {
          aborted();
          const value = check();
          if (value) { finish(null, value); return; }
          if (Date.now() - started >= timeout) { finish(new Error(message)); return; }
          timer = setTimeout(poll, 90);
        } catch (error) { finish(error); }
      };
      if (signal) signal.addEventListener('abort', abort, { once: true });
      poll();
    });
  }

  function optionsFor(select) {
    if (select.multiple) fail('CMT opened a multi-select bid editor, which is unsupported. No change was submitted.');
    const map = new Map();
    const values = new Set();
    for (const option of select.options) {
      const label = text(option);
      const name = canonical(label);
      if (!name) {
        if (!option.value && (!label || /^select bid(?:\.{3}|…)?$/i.test(label))) continue;
        fail('CMT offered an unfamiliar bid option. No change was submitted; inspect the bid dropdown in CMT.');
      }
      if (map.has(name) || !option.value || values.has(option.value)) fail('CMT bid options are ambiguous. No change was submitted.');
      map.set(name, option);
      values.add(option.value);
    }
    stats.optionLabels = [...map.keys()];
    if (names.slice(1).some(name => !map.has(name))) fail('CMT is missing one or more of the four expected bid options. No change was submitted.');
    return map;
  }

  async function setBid(paper, bid, { expectedPrevious } = {}) {
    aborted();
    const wanted = canonical(bid);
    if (!wanted) fail('The requested bid is not a supported CMT decision.');
    let { record, cell, anchor, controls } = locate(paper);
    if (controls.length !== 1 || disabled(anchor)) fail('This paper has no unambiguous enabled CMT bid control.');
    if (cell.querySelector('select') || !visible(anchor)) fail('A CMT bid editor is already open. Finish it in CMT before continuing.');
    if (hasDialog()) fail('A CMT dialog is open. Exit Purr Review and resolve it before continuing.');
    if (busy(record.row)) fail('CMT is still busy. Wait for it to finish before continuing.');
    const previous = getBid(paper);
    if (!previous) fail('The current CMT bid is unknown. No change was submitted.');
    if (expectedPrevious !== undefined && previous !== canonical(expectedPrevious)) fail('The bid changed outside Purr Review. No change was submitted; exit and relaunch to read the current bid.');
    if (previous === wanted && verifyBid(paper, wanted)) return { previousBid: previous, newBid: wanted, verified: true };
    operation = { paper, wanted, started: performance.now(), select: null };
    const beforeAlerts = alerts();
    const originalStyle = anchor.getAttribute('style');
    const originalChildren = new Set(cell.querySelectorAll('*'));
    let select;
    let submitted = false;
    try {
      report('Opening CMT bid editor');
      anchor.click();
      select = await waitFor(() => {
        locate(paper);
        if (hasDialog()) fail('CMT opened a dialog. Exit Purr Review and resolve it before continuing.');
        const editors = Array.from(cell.querySelectorAll('select')).filter(el => !originalChildren.has(el));
        if (editors.length > 1) fail('CMT opened multiple bid editors. No change was submitted.');
        return editors.length === 1 && visible(editors[0]) ? editors[0] : false;
      }, 4000, 'CMT did not open its bid dropdown. No change was submitted.');
      operation.select = select;
      const options = optionsFor(select);
      const option = options.get(wanted);
      if (!option) fail('CMT does not offer Not Entered, so this bid cannot be cleared through its dropdown.');
      if (disabled(select) || option.disabled || option.parentElement.disabled) fail('CMT has disabled the requested bid option. No change was submitted.');
      if (getBid(paper) !== previous) fail('The CMT bid changed while its editor was opening. No change was submitted.');
      aborted();

      select.value = option.value;
      submitted = true;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      report('Waiting for CMT confirmation');
      let reflectedSince = 0;
      await waitFor(() => {
        const current = locate(paper);
        if (hasDialog()) fail('CMT opened a dialog while saving. Exit Purr Review to resolve it and check this bid.');
        for (const [el, message] of alerts()) {
          if (beforeAlerts.get(el) !== message) fail('CMT reported an error while saving. Exit Purr Review to read its message and check this bid.');
        }
        if (!select.isConnected && visible(current.anchor) && getBid(paper) !== wanted) {
          fail('CMT closed the editor without confirming the requested bid. Check this paper in CMT before retrying.');
        }
        if (!select.isConnected && verifyBid(paper, wanted)) {
          if (!reflectedSince) reflectedSince = Date.now();
          return Date.now() - reflectedSince >= 240;
        }
        reflectedSince = 0;
        return false;
      }, 20000, 'CMT has not confirmed this bid yet. It may still finish saving; exit and check the paper before retrying.');
      report('Confirmed by CMT');
      return { previousBid: previous, newBid: wanted, verified: true };
    } catch (error) {
      report(submitted ? 'Unconfirmed; check CMT' : 'No change submitted');
      if (!submitted) {

        const createdEditors = Array.from(cell.querySelectorAll('select')).filter(node => !originalChildren.has(node));
        for (let node of createdEditors) {
          while (node.parentElement !== cell && node.parentElement && !originalChildren.has(node.parentElement)) node = node.parentElement;
          if (!Array.from(node.querySelectorAll('*')).some(child => originalChildren.has(child))) node.remove();
        }
        if (anchor.isConnected) {
          if (originalStyle === null) anchor.removeAttribute('style');
          else anchor.setAttribute('style', originalStyle);
        }
      }
      throw error;
    } finally {
      lastConfirmation = confirmationState();
      operation = null;
    }
  }

  function diagnostics() {

    return { ...stats, confirmation: confirmationState() || (lastConfirmation ? { ...lastConfirmation } : null),
      optionLabels: stats.optionLabels.slice(), unavailableReasons: { ...stats.unavailableReasons }, scope: 'Loaded rows only; current CMT filters/page apply' };
  }
  return { discoverPapers, getBid, setBid, verifyBid, diagnostics };
}
