(() => {
  'use strict';
  const initial = [
    { id: '101', title: 'Test paper 001', abstract: Array(10).fill('Synthetic abstract A for local testing.').join(' '), primary: 'Synthetic topic A', secondary: ['Synthetic topic B', 'Synthetic topic C'], bid: 'Not Entered' },
    { id: '102', title: 'Test paper 002', abstract: '', primary: 'Synthetic topic D', secondary: ['Synthetic topic E'], bid: 'Not Entered' },
    { id: '103', title: 'Test paper 003: ' + Array(12).fill('synthetic long title').join(' '), abstract: Array(8).fill('Synthetic abstract C for local testing.').join(' '), primary: 'Synthetic topic F', secondary: ['Synthetic topic G', 'Synthetic topic H'], bid: 'Not Entered' },
    { id: '104', title: 'Test paper 004', abstract: 'Synthetic abstract D for an existing-bid test.', primary: 'Synthetic topic I', secondary: ['Synthetic topic J'], bid: 'Eager' },
    { id: '105', title: 'Test paper 005', abstract: 'Synthetic abstract E for a disabled-row test.', primary: 'Synthetic topic K', secondary: [], bid: 'Not Entered', conflict: true },
    { id: '106', title: 'Test paper 006: A & B < C > D', abstract: 'Synthetic abstract F with special characters: A & B < C > D.', primary: 'Synthetic topic L', secondary: ['Synthetic topic M'], bid: 'Not Entered' },
    { id: '107', title: 'Test paper 007', abstract: 'Synthetic abstract G for local testing.', primary: 'Synthetic topic N', secondary: ['Synthetic topic O'], bid: 'Not Entered' }
  ];
  const options = [['b-41', 'Not Entered'], ['b-18', 'Not Willing'], ['b-73', 'In A Pinch'], ['b-29', 'Willing'], ['b-56', 'Eager']];
  const tbody = document.querySelector('#BiddingModel tbody');
  const status = document.createElement('p');
  const log = document.createElement('ol');
  const simulation = Object.fromEntries(['slow', 'fail', 'dialog', 'ambiguous'].map(id => {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = id; input.hidden = true;
    if (new URLSearchParams(location.search).has('test')) document.body.append(input);
    return [id, input];
  }));
  const pending = new Set();
  let generation = 0;
  const demo = window.demo = { requests: [], outcomes: [], initial, reset, options };

  function element(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  }

  function record(text) { log.append(element('li', text)); }

  function reset() {
    window.__PURR_REVIEW__?.destroy();
    generation += 1;
    for (const timer of pending) clearTimeout(timer);
    pending.clear();
    demo.requests.length = 0;
    demo.outcomes.length = 0;
    log.replaceChildren();
    tbody.replaceChildren();
    document.getElementById('cmt-demo-dialog').close();
    for (const paper of initial) {
      const row = element('tr', undefined, { bidding: paper.id });
      const id = element('td');
      id.append(element('a', paper.id, { href: '#paper-' + paper.id, title: 'Submission summary' }));
      const submission = element('td', undefined, { class: 'submission' });
      const title = element('div', undefined, { class: 'title' });
      title.append(element('strong', paper.title, { 'data-bind': 'text: title' }));
      if (paper.abstract) {
        const abstract = element('div', undefined, { class: 'abstract' });
        const toggle = element('a', 'Show Abstract', { href: '#', title: 'Click to see abstract' });
        const text = element('div', paper.abstract, { 'data-bind': 'text: abstract', style: 'display:none' });
        toggle.addEventListener('click', event => { event.preventDefault(); text.style.display = text.style.display === 'none' ? '' : 'none'; });
        abstract.append(toggle, text);
        title.append(abstract);
      }
      submission.append(title);
      const primary = element('td');
      primary.append(element('div', paper.primary, { 'data-bind': 'text: primarySubject' }));
      const secondary = element('td', undefined, { class: 'secondary' });
      const subjects = element('ul');
      for (const topic of paper.secondary) subjects.append(element('li', topic, { title: topic }));
      secondary.append(subjects);
      const discussion = element('td', paper.conflict ? 'Conflict of interest' : '');
      const bidCell = element('td', undefined, { class: 'bid' });
      const span = element('span');
      if (paper.conflict) {
        span.textContent = 'Conflict';
      } else {
        const anchor = element('a', paper.bid, { href: '#', title: 'Click to change bid', class: 'bid', 'data-bind': 'text: bid, click: $parent.selectBid' });
        anchor.addEventListener('click', event => { event.preventDefault(); openEditor(row, anchor); });
        span.append(anchor);
      }
      bidCell.append(span);
      row.append(id, submission, element('td', 'Test track', { class: 'track' }), primary, secondary, discussion, element('td', '0.50'), element('td', String(Number(paper.id) - 100)), bidCell);
      tbody.append(row);
    }
    status.textContent = 'Ready. Choose a simulation below, then launch. Press Esc to return here.';
  }

  function openEditor(row, anchor) {
    if (row.querySelector('select')) return;
    if (simulation.dialog.checked) {
      simulation.dialog.checked = false;
      document.getElementById('cmt-demo-dialog').showModal();
      record('CMT dialog opened; no request was sent.');
      return;
    }
    const wrapper = element('span');
    const select = element('select', undefined, { 'aria-label': 'Your Bid for paper ' + row.getAttribute('bidding') });
    select.append(element('option', 'Select bid...', { value: '' }));
    for (const [value, label] of options) select.append(element('option', label, { value }));
    if (simulation.ambiguous.checked) select.append(element('option', 'Willing', { value: 'b-ambiguous' }));
    select.value = options.find(([, label]) => label.toLowerCase() === anchor.textContent.toLowerCase())?.[0] || '';
    wrapper.append(select);
    anchor.style.display = 'none';
    anchor.after(wrapper);
    select.focus();

    select.addEventListener('change', () => {
      if (select.disabled || !select.value) return;
      const selected = select.selectedOptions[0]?.textContent;
      const id = row.getAttribute('bidding');
      const previous = anchor.textContent;
      const thisGeneration = generation;
      const failure = simulation.fail.checked;
      simulation.fail.checked = false;
      select.disabled = true;
      demo.requests.push({ id, previous, selected, value: select.value });
      record('Requested paper ' + id + ' → ' + selected);
      const timer = setTimeout(() => {
        pending.delete(timer);
        if (thisGeneration !== generation) return;
        wrapper.remove();
        anchor.style.display = '';
        if (failure) {
          const error = element('div', 'CMT could not save the bid. Please try again.', { role: 'alert', class: 'error' });
          row.querySelector('.bid').append(error);
          status.textContent = 'Simulated save failed. The previous CMT bid is unchanged.';
          demo.outcomes.push({ id, saved: false, bid: previous });
          record('Failed paper ' + id + '; still ' + previous);
        } else {
          anchor.textContent = selected;
          row.querySelectorAll('.error').forEach(node => node.remove());
          status.textContent = 'Confirmed paper ' + id + ': ' + selected;
          demo.outcomes.push({ id, saved: true, bid: selected });
          record('Confirmed paper ' + id + ' → ' + selected);
        }
      }, simulation.slow.checked ? 1600 : 160);
      pending.add(timer);
    });
  }

  document.getElementById('launch').addEventListener('click', () => {
    const script = document.createElement('script');
    script.src = '../dist/purr-review.js?t=' + Date.now();
    script.onload = () => { script.remove(); status.textContent = 'Purr Review is running. Press Esc to return to the simulated CMT console.'; };
    script.onerror = () => { script.remove(); status.textContent = 'Could not load ../dist/purr-review.js. Keep the demo folder beside dist, then reopen this file.'; };
    document.head.append(script);
  });
  document.getElementById('close-dialog').addEventListener('click', () => document.getElementById('cmt-demo-dialog').close());
  reset();
})();
