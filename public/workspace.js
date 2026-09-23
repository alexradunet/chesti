// Trusted progressive enhancement only. Pi never supplies executable code.
// Range controls only produce the declared JSON field; the server still validates it.
function enhanceRanges(root = document) {
  for (const range of root.querySelectorAll('.range-field:not(.range-enhanced)')) {
    range.classList.add('range-enhanced');
    const zone = range.querySelector('[data-range-part="timeZone"]');
    if (zone && !zone.value) zone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    range.querySelector('[data-range-part="start"]').required = range.querySelector('textarea').required;
    range.querySelector('.range-advanced').open = false;
  }
}
function zonedTime(value, timeZone) {
  const wall = value.length === 16 ? `${value}:00` : value;
  const nominal = Date.parse(`${wall}Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' });
  let instant = nominal, offset = '+00:00', parts;
  for (let step = 0; step < 4; step++) {
    parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.slice(3);
    if (!/^[+-]\d{2}:\d{2}$/.test(offset)) throw new Error('Choose a valid IANA timezone.');
    const minutes = (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) * (offset.startsWith('-') ? -1 : 1);
    const next = nominal - minutes * 60000;
    if (next === instant) break;
    instant = next;
  }
  parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` !== wall) throw new Error('This local time does not exist in that timezone. Choose a time outside the daylight-saving gap.');
  return `${wall}${offset}`;
}
document.addEventListener('input', event => {
  const range = event.target.closest('.range-field');
  if (!range) return;
  const start = range.querySelector('[data-range-part="start"]');
  const end = range.querySelector('[data-range-part="end"]');
  const zone = range.querySelector('[data-range-part="timeZone"]');
  const raw = range.querySelector('textarea');
  const notice = range.querySelector('.range-error');
  start.setCustomValidity(''); notice.textContent = '';
  if (event.target === raw) {
    try {
      const value = raw.value ? JSON.parse(raw.value) : {};
      start.value = (value.start ?? '').slice(0, zone ? 16 : 10);
      end.value = (value.end ?? '').slice(0, zone ? 16 : 10);
      if (zone && value.timeZone) zone.value = value.timeZone;
    } catch { /* The declared JSON field is independently validated on submission. */ }
    return;
  }
  try {
    if (!start.value && !end.value) { raw.value = ''; return; }
    if (!start.value || !end.value) throw new Error('Choose both a start and an end.');
    const value = zone ? { start: zonedTime(start.value, zone.value), end: zonedTime(end.value, zone.value), timeZone: zone.value } : { start: start.value, end: end.value };
    if (zone ? Date.parse(value.start) >= Date.parse(value.end) : value.start >= value.end) throw new Error('End must be after start.');
    raw.value = JSON.stringify(value);
  } catch (error) {
    notice.textContent = error.message;
    start.setCustomValidity(error.message);
  }
});
enhanceRanges();
const desk = document.querySelector('.workbench');
if (desk) {
  const base = `/workspaces/${desk.dataset.workspace}`;
  const draftKey = `taskdesk:draft:${desk.dataset.workspace}`;
  const dirtyForms = new Set();
  let streaming = false;
  let pending = false;
  let switchToWorkspace = false;
  let refreshSequence = 0;
  let currentUrl = location.href;
  const $ = selector => document.querySelector(selector);
  const status = text => { $('#chat-status').textContent = text; };
  const draft = () => $('#message')?.value ?? '';
  const saveDraft = value => { try { sessionStorage.setItem(draftKey, value); } catch { /* storage is optional */ } };
  const scrollChat = () => { const log = $('#transcript'); log.scrollTop = log.scrollHeight; };
  function selectionStatus() {
    const count = new Set([...document.querySelectorAll('input[name="selected"]:checked')].map(el => el.value)).size;
    $('#selection-status').textContent = count ? `${count} record${count === 1 ? '' : 's'} selected for your next message.` : 'No selection · Pi can see the current view.';
  }
  function busy(value, id = '') {
    $('#conversation').dataset.busy = String(value);
    for (const control of $('#chat-send').elements) {
      if (control.name === 'selected' || control.type === 'hidden') continue;
      control.disabled = value || pending;
    }
    $('#chat-stop').hidden = !value;
    if (id) $('#chat-stop').elements.turnId.value = id;
  }
  function fromHTML(html, selector) {
    // Only complete escaped HTML from our same-origin server renderer goes here.
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
  }
  function update(data) {
    const currentDraft = draft();
    const engine = $('#chat-engine').value;
    const selection = new Set([...document.querySelectorAll('input[name="selected"]:checked')].map(el => el.value));
    const oldCanvas = $('#canvas');
    const nextCanvas = fromHTML(data.canvas, '#canvas');
    enhanceRanges(nextCanvas);
    if (!oldCanvas.isEqualNode(nextCanvas)) {
      if (dirtyForms.size) pending = true;
      else {
        oldCanvas.replaceWith(nextCanvas);
        pending = false;
        if (switchToWorkspace) { history.replaceState(null, '', base); currentUrl = location.href; switchToWorkspace = false; }
      }
    }
    $('#conversation').replaceWith(fromHTML(data.conversation, '#conversation'));
    $('#message').value = currentDraft;
    $('#chat-engine').value = engine;
    $('#chat-send').elements.focus.value = $('#canvas').dataset.focus;
    $('#chat-send').elements.revision.value = $('#canvas').dataset.revision;
    for (const checkbox of document.querySelectorAll('input[name="selected"]')) checkbox.checked = selection.has(checkbox.value);
    $('#pending-update').hidden = !pending;
    busy(data.busy || streaming);
    if (pending) status('Workspace update waiting. Finish your form, or discard its edits to refresh.');
    selectionStatus();
    scrollChat();
  }
  async function refresh() {
    const sequence = ++refreshSequence;
    const focus = switchToWorkspace ? '' : $('#canvas').dataset.focus;
    const response = await fetch(`${base}/state?focus=${encodeURIComponent(focus)}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Could not refresh the workspace. Reload to reconnect.');
    const data = await response.json();
    if (sequence === refreshSequence) update(data);
    return data;
  }
  async function checked(response) {
    if (response.ok) return response;
    const document = new DOMParser().parseFromString(await response.text(), 'text/html');
    throw new Error(document.querySelector('.error .lead')?.textContent ?? `Request failed (${response.status}).`);
  }
  async function message(form, submitter) {
    const body = new URLSearchParams(new FormData(form, submitter));
    const sentMessage = body.get('message');
    streaming = true;
    busy(true, body.get('requestId'));
    $('#message').value = '';
    saveDraft('');
    const user = document.createElement('article');
    user.className = 'message user';
    const label = document.createElement('span'); label.className = 'speaker'; label.textContent = 'YOU';
    const text = document.createElement('p'); text.textContent = sentMessage;
    user.append(label, text);
    $('#live-response').before(user);
    $('#live-response').hidden = false;
    status('Connecting to the agent…');
    let completed = false;
    let accepted = false;
    let streamFailure = '';
    try {
      const response = await checked(await fetch(form.getAttribute('action'), { method: 'POST', headers: { Accept: 'text/event-stream' }, body }));
      accepted = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'text') $('#live-response p').textContent += event.text;
          if (event.type === 'status') status(event.text);
          if (event.type === 'receipt') {
            const item = document.createElement('li');
            item.className = 'receipt';
            item.textContent = `${event.receipt.resource.split('/').at(-1)} · ${event.receipt.status}: ${event.receipt.message}`;
            $('#live-response ul').append(item);
          }
          if (event.type === 'done') { completed = true; switchToWorkspace ||= Boolean(event.layoutChanged); }
          scrollChat();
        }
      }
      if (!completed) throw new Error('Connection interrupted. Check the saved conversation and receipts before sending again.');
    } catch (error) {
      streamFailure = error.message;
      if (!accepted) { $('#message').value = sentMessage; saveDraft(sentMessage); }
    } finally {
      streaming = false;
      try { await refresh(); } catch (error) { streamFailure ||= error.message; }
      if (streamFailure) status(streamFailure);
      // Do not automatically retry a message: it may already have performed actions.
      if ($('#conversation').dataset.busy === 'true') reconnect();
    }
  }
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!desk.contains(form)) return;
    event.preventDefault();
    if (form.id === 'chat-send') { if (!streaming && !pending) await message(form, event.submitter); return; }
    const stop = form.id === 'chat-stop';
    const submitter = event.submitter;
    const body = new URLSearchParams(new FormData(form, submitter));
    if (submitter) submitter.disabled = true;
    try {
      await checked(await fetch(form.getAttribute('action'), { method: 'POST', body }));
      if (stop) { status('Stopping. Actions already applied will remain.'); return; }
      dirtyForms.delete(form);
      if (form.classList.contains('undo-layout')) switchToWorkspace = true;
      if (!streaming) { await refresh(); status(pending ? 'Saved. Other unfinished forms were preserved.' : form.classList.contains('receipt-form') ? 'Decision recorded. Check the receipt for the outcome.' : 'Saved. Current state is shown.'); }
      else status('Saved. Pi will see current state when it next inspects the resource.');
    } catch (error) { status(error.message); }
    finally { if (submitter?.isConnected) submitter.disabled = false; }
  });
  async function navigate(href, push = true) {
    if (dirtyForms.size && !window.confirm('Discard the unfinished form edits and navigate?')) {
      if (!push) history.pushState(null, '', currentUrl);
      return;
    }
    try {
      const response = await checked(await fetch(href));
      const next = fromHTML(await response.text(), '#canvas');
      if (!next) throw new Error('That resource could not be displayed.');
      dirtyForms.clear(); pending = false; switchToWorkspace = false;
      $('#canvas').replaceWith(next);
      enhanceRanges(next);
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
      $('#pending-update').hidden = true;
      $('#chat-send').elements.focus.value = next.dataset.focus;
      $('#chat-send').elements.revision.value = next.dataset.revision;
      if (push) history.pushState(null, '', href);
      currentUrl = location.href;
      busy(streaming || $('#conversation').dataset.busy === 'true');
      selectionStatus();
      // Keep the conversation DOM and its live stream intact while following links.
    } catch (error) { status(error.message); }
  }
  document.addEventListener('click', event => {
    const insert = event.target.closest('[data-journal-link]');
    if (insert && desk.contains(insert)) {
      const journal = document.querySelector('#today-journal textarea[name="body"]');
      if (!journal) { status('Open Today and enable a journal create or edit action first.'); return; }
      const text = `${journal.value && !journal.value.endsWith('\n') ? '\n' : ''}${insert.dataset.journalLink}\n`;
      journal.setRangeText(text, journal.value.length, journal.value.length, 'end');
      journal.dispatchEvent(new Event('input', { bubbles: true }));
      journal.focus();
      journal.scrollIntoView({ behavior: 'smooth', block: 'center' });
      status('Wiki link inserted into your draft. Save the journal to write it to the vault.');
      return;
    }
    const link = event.target.closest('a');
    if (!link || !desk.contains(link) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin) return;
    const sameWorkspace = url.pathname === base || (desk.classList.contains('today-workbench') && url.pathname === '/today') || ((url.pathname === '/issues' || /^\/issues\/ISS-\d+$/.test(url.pathname) || (url.pathname.startsWith('/vault') && !['/vault/apps', '/vault/approve', '/vault/act'].includes(url.pathname))) && url.searchParams.get('workspace') === desk.dataset.workspace);
    if (!sameWorkspace) return;
    event.preventDefault();
    void navigate(url.href);
  });
  window.addEventListener('popstate', () => { void navigate(location.href, false); });
  document.addEventListener('input', event => {
    if (event.target.id === 'message') saveDraft(event.target.value);
    if (event.target.name === 'selected') { selectionStatus(); return; }
    if ($('#canvas').contains(event.target) && event.target.form) dirtyForms.add(event.target.form);
  });
  $('#apply-update').addEventListener('click', async () => {
    dirtyForms.clear();
    pending = false;
    try { await refresh(); } catch (error) { status(error.message); }
  });
  window.addEventListener('beforeunload', event => {
    if (dirtyForms.size) { event.preventDefault(); event.returnValue = ''; }
  });
  async function reconnect() {
    // Read-only reconnect after refresh/navigation. Never restarts inference.
    for (let attempt = 0; attempt < 75 && !streaming; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (streaming) return;
      try { if (!(await refresh()).busy) return; }
      catch (error) { status(error.message); return; }
    }
  }
  try { $('#message').value = sessionStorage.getItem(draftKey) ?? ''; } catch { /* optional */ }
  selectionStatus();
  scrollChat();
  if ($('#conversation').dataset.busy === 'true') reconnect();
}
