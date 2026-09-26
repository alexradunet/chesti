import { Value } from 'typebox/value';
import { JOURNAL_TYPE_ID, ObjectLookupSchema } from './model.js';
import type { ObjectLookupResult, ViewConversation } from './model.js';
import type { WritingEditor, WritingSelection } from './writing.js';
import type * as WritingModule from './writing.js';

const dirtyForms = new Set<HTMLFormElement>();
const forms = document.querySelectorAll<HTMLFormElement>('form[data-enhance]');
const writingForm = document.querySelector<HTMLFormElement>('[data-object-editor]');
let writingEditor: WritingEditor | undefined;
if (writingForm) void (async () => {
  try {
    // Optional page-specific bundle: a static import would make its load failure
    // disable all form enhancement instead of leaving the native editor usable.
    const moduleUrl = '/writing-client.js';
    const module = await import(moduleUrl) as typeof WritingModule;
    writingEditor = await module.enhanceWriting(writingForm);
  } catch (error) {
    const status = writingForm.querySelector<HTMLElement>('[data-writing-status]');
    if (status) {
      status.hidden = false;
      status.textContent = `Formatted editing is unavailable; your Markdown source is unchanged. ${error instanceof Error ? error.message : 'You can keep editing and saving below.'}`;
    }
  }
})();

interface AiState { open: boolean; draft: string; conversationId?: string; previousId?: string; contextTitle: string }
const aiPanel = document.querySelector<HTMLElement>('#ai-panel');
const aiForm = document.querySelector<HTMLFormElement>('[data-ai-form]');
const aiPrompt = aiForm?.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
const aiStatus = document.querySelector<HTMLElement>('[data-ai-status]');
const aiTurns = document.querySelector<HTMLElement>('[data-ai-turns]');
const aiContext = document.querySelector<HTMLElement>('[data-ai-context-label]');
const aiEmptyTemplate = document.querySelector<HTMLTemplateElement>('[data-ai-empty-template]');
const navigation = document.querySelector<HTMLElement>('#workspace-nav');
const backdrop = document.querySelector<HTMLElement>('[data-panel-backdrop]');
const objectSearch = document.querySelector<HTMLDialogElement>('#object-search');
const narrowScreen = window.matchMedia('(max-width: 1199px)');
const mobileScreen = window.matchMedia('(max-width: 760px)');
const storageKey = `taskdesk:ai:${aiForm?.querySelector<HTMLInputElement>('[name="csrf"]')?.value ?? ''}`;
let conversation: ViewConversation | undefined;
let aiBusy = false;
let aiLoading = false;
let navOpen = false;
let lastPanelTrigger: HTMLElement | null = null;
let draftStored = true;
let aiState: AiState = {
  open: aiPanel ? !aiPanel.hidden : false,
  draft: aiPrompt?.value ?? '',
  conversationId: aiForm?.querySelector<HTMLInputElement>('[name="conversationId"]')?.value || undefined,
  previousId: aiForm?.querySelector<HTMLInputElement>('[name="previousId"]')?.value || document.body.dataset.aiViewId || undefined,
  contextTitle: document.body.dataset.aiContextTitle || document.body.dataset.aiViewTitle || 'New view',
};
try {
  const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as AiState | null;
  if (!aiState.draft && stored && (!aiState.conversationId || aiState.conversationId === stored.conversationId) && typeof stored.open === 'boolean' && typeof stored.draft === 'string' && typeof stored.contextTitle === 'string') {
    aiState = { ...stored, open: aiState.open || stored.open };
  }
} catch { /* The panel still works when browser storage is unavailable. */ }

function persistAi(): void {
  try { sessionStorage.setItem(storageKey, JSON.stringify(aiState)); draftStored = true; }
  catch { draftStored = false; }
}

function syncPanels(): void {
  document.body.classList.toggle('ai-open', aiState.open);
  document.body.classList.toggle('nav-open', navOpen);
  if (aiPanel) aiPanel.hidden = !aiState.open;
  if (navigation) navigation.hidden = mobileScreen.matches && !navOpen;
  const modal = navOpen && mobileScreen.matches ? navigation : aiState.open && narrowScreen.matches ? aiPanel : null;
  if (backdrop) backdrop.hidden = !modal;
  for (const selector of ['.workspace-content', '#workspace-nav', '#ai-panel']) {
    const region = document.querySelector<HTMLElement>(selector);
    if (region) region.inert = Boolean(modal && region !== modal);
  }
  for (const panel of [navigation, aiPanel]) {
    if (!panel) continue;
    if (panel === modal) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); }
    else { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); }
  }
  for (const toggle of document.querySelectorAll('[data-ai-toggle]')) toggle.setAttribute('aria-expanded', String(aiState.open));
  for (const toggle of document.querySelectorAll('[data-nav-toggle]')) toggle.setAttribute('aria-expanded', String(navOpen));
}

function setAiOpen(open: boolean, trigger?: HTMLElement): void {
  if (trigger) lastPanelTrigger = trigger;
  aiState.open = open;
  if (open) navOpen = false;
  syncPanels();
  persistAi();
  if (open) aiPrompt?.focus();
  else (lastPanelTrigger?.isConnected ? lastPanelTrigger : document.querySelector<HTMLElement>('[data-ai-toggle]'))?.focus();
}

function showAiStatus(message: string, error = false): void {
  if (!aiStatus) return;
  aiStatus.textContent = message;
  aiStatus.classList.toggle('error', error);
  aiStatus.setAttribute('role', error ? 'alert' : 'status');
}

function syncAiSuggestions(): void {
  const suggestions = aiTurns?.querySelector<HTMLElement>('[data-ai-suggestions]');
  if (suggestions) suggestions.hidden = Boolean(aiBusy || aiLoading || aiState.conversationId || aiState.previousId || conversation?.turns.length || aiState.draft !== '' || aiPrompt?.value !== '');
}

function renderConversation(): void {
  if (aiContext) aiContext.textContent = conversation?.turns.at(-1)?.title ?? aiState.contextTitle;
  if (!aiTurns) return;
  aiTurns.replaceChildren();
  if (!conversation?.turns.length) {
    const empty = aiEmptyTemplate?.content.cloneNode(true);
    if (empty) {
      aiTurns.append(empty);
      if (aiState.previousId) {
        const heading = aiTurns.querySelector('h3');
        const text = aiTurns.querySelector('[data-ai-empty-description]');
        if (heading) heading.textContent = 'Make this view your own';
        if (text) text.textContent = 'Describe what to change. You’ll get a separate draft to review; the original stays untouched.';
      }
    }
  }
  for (const turn of conversation?.turns ?? []) {
    const article = document.createElement('article');
    article.className = 'ai-turn';
    const prompt = document.createElement('p');
    prompt.className = 'ai-user-message';
    prompt.textContent = turn.prompt;
    const result = document.createElement('div');
    result.className = 'ai-result';
    const title = document.createElement('strong');
    title.textContent = turn.title;
    const description = document.createElement('p');
    description.textContent = turn.description || 'View generated. Preview it before publishing.';
    const preview = document.createElement('a');
    preview.className = 'ai-preview-link';
    preview.href = `/views/${encodeURIComponent(turn.viewId)}`;
    preview.textContent = 'Open view preview';
    const model = document.createElement('small');
    model.textContent = turn.model;
    result.append(title, description, preview, model);
    article.append(prompt, result);
    aiTurns.append(article);
  }
  aiTurns.scrollTop = aiTurns.scrollHeight;
  const previous = aiForm?.querySelector<HTMLInputElement>('[name="previousId"]');
  if (previous) { previous.value = aiState.previousId ?? ''; previous.disabled = !aiState.previousId; }
  syncAiSuggestions();
}

function startConversation(previousId?: string, title = 'New view'): void {
  if (aiBusy || aiLoading) return;
  conversation = undefined;
  aiState = { open: true, draft: '', previousId, contextTitle: title };
  if (aiPrompt) aiPrompt.value = '';
  showAiStatus('');
  renderConversation();
  setAiOpen(true);
}

document.body.classList.add('enhanced');
if (aiPrompt) {
  aiPrompt.value = aiState.draft;
  aiPrompt.addEventListener('input', () => { aiState.draft = aiPrompt.value; persistAi(); syncAiSuggestions(); });
}
aiTurns?.addEventListener('click', event => {
  const suggestion = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-ai-suggestion]') : null;
  if (!suggestion || !aiPrompt || aiBusy || aiLoading || aiState.conversationId || aiState.previousId || conversation?.turns.length || aiState.draft !== '' || aiPrompt.value !== '') return;
  aiPrompt.value = suggestion.dataset.aiSuggestion ?? '';
  aiState.draft = aiPrompt.value;
  persistAi();
  syncAiSuggestions();
  aiPrompt.focus();
});
for (const toggle of document.querySelectorAll<HTMLElement>('[data-ai-toggle]')) toggle.addEventListener('click', event => {
  event.preventDefault();
  setAiOpen(!aiState.open, toggle);
});
for (const close of document.querySelectorAll<HTMLElement>('[data-ai-close]')) close.addEventListener('click', () => setAiOpen(false));
for (const trigger of document.querySelectorAll<HTMLElement>('[data-ai-start], [data-ai-context]')) trigger.addEventListener('click', event => {
  event.preventDefault();
  lastPanelTrigger = trigger;
  if (trigger.hasAttribute('data-ai-context') || trigger.dataset.previousId) startConversation(trigger.dataset.previousId, trigger.dataset.contextTitle);
  else startConversation();
  if (!aiState.conversationId && !aiState.draft && !aiState.previousId && document.body.dataset.aiPrompt && aiPrompt) {
    aiPrompt.value = document.body.dataset.aiPrompt;
    aiState.draft = aiPrompt.value;
    persistAi();
    syncAiSuggestions();
  }
});
document.querySelector('[data-ai-new]')?.addEventListener('click', () => startConversation());
for (const toggle of document.querySelectorAll<HTMLElement>('[data-nav-toggle]')) toggle.addEventListener('click', () => {
  lastPanelTrigger = toggle;
  navOpen = !navOpen;
  if (navOpen) { aiState.open = false; persistAi(); }
  syncPanels();
  if (navOpen) navigation?.querySelector<HTMLElement>('a,button')?.focus();
});
function closeDrawer(): void {
  if (navOpen) { navOpen = false; syncPanels(); lastPanelTrigger?.focus(); }
  else setAiOpen(false);
}
document.querySelector('[data-nav-close]')?.addEventListener('click', closeDrawer);
backdrop?.addEventListener('click', closeDrawer);
document.addEventListener('keydown', event => {
  if (objectSearch?.open) return;
  if (event.key === 'Escape' && (navOpen || aiState.open)) { event.preventDefault(); closeDrawer(); }
  const panel = navOpen && mobileScreen.matches ? navigation : aiState.open && narrowScreen.matches ? aiPanel : null;
  if (event.key !== 'Tab' || !panel) return;
  const focusable = [...panel.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(element => !element.hidden && element.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
});
function onViewportChange(): void {
  if (!mobileScreen.matches) navOpen = false;
  syncPanels();
  if (aiState.open && narrowScreen.matches) aiPrompt?.focus();
}
narrowScreen.addEventListener('change', onViewportChange);
mobileScreen.addEventListener('change', onViewportChange);
syncPanels();
renderConversation();

async function restoreConversation(): Promise<void> {
  if (!aiState.conversationId) return;
  aiLoading = true;
  syncAiSuggestions();
  showAiStatus('Loading conversation…');
  try {
    const response = await fetch(`/views/conversations/${encodeURIComponent(aiState.conversationId)}`, { headers: { Accept: 'application/json' } });
    const data = await response.json() as ViewConversation & { error?: string };
    if (!response.ok) throw new Error(data.error || 'Unable to load the conversation.');
    conversation = data;
    aiState.previousId = data.previousId;
    aiState.contextTitle = data.contextTitle;
    persistAi();
    renderConversation();
    showAiStatus('');
  } catch (error) {
    showAiStatus(`${error instanceof Error ? error.message : 'Unable to load the conversation.'} Start a new conversation to continue.`, true);
  } finally { aiLoading = false; syncAiSuggestions(); }
}
void restoreConversation();

aiForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!aiPrompt || aiBusy || aiLoading || !aiForm.reportValidity()) return;
  aiBusy = true;
  syncAiSuggestions();
  aiForm.setAttribute('aria-busy', 'true');
  const controls = [...aiForm.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea')];
  controls.forEach(control => { control.disabled = true; });
  showAiStatus('Generating a draft with your configured model…');
  const data = new URLSearchParams({ csrf: aiForm.querySelector<HTMLInputElement>('[name="csrf"]')!.value, prompt: aiPrompt.value });
  if (aiState.conversationId) data.set('conversationId', aiState.conversationId);
  else if (aiState.previousId) data.set('previousId', aiState.previousId);
  try {
    const response = await fetch('/views/generate', { method: 'POST', body: data, headers: { Accept: 'application/json' } });
    const result = await response.json() as { conversation: ViewConversation; viewId: string; url: string; error?: string };
    if (!response.ok) throw new Error(result.error || 'Unable to generate a view. Your prompt is still here.');
    conversation = result.conversation;
    aiState.conversationId = conversation.id;
    aiState.previousId = conversation.previousId;
    aiState.contextTitle = conversation.contextTitle;
    aiState.draft = '';
    aiPrompt.value = '';
    persistAi();
    renderConversation();
    aiBusy = false;
    if (!dirtyForms.size && ![...forms].some(form => form.dataset.busy === 'true')) {
      window.location.assign(result.url);
    } else {
      showAiStatus('Draft ready. Your unsaved edits are still here; save them before opening the view preview.');
    }
  } catch (error) {
    showAiStatus(error instanceof Error ? error.message : 'Unable to generate a view. Your prompt is still here.', true);
  } finally {
    aiBusy = false;
    aiForm.removeAttribute('aria-busy');
    controls.forEach(control => { control.disabled = false; });
    syncAiSuggestions();
  }
});

const resizeHandle = document.querySelector<HTMLElement>('[data-ai-resize]');
let aiWidth = 380;
function resizeAi(width: number): void {
  aiWidth = Math.round(Math.min(Math.min(560, window.innerWidth - 710), Math.max(320, width)));
  document.body.style.setProperty('--ai-width', `${aiWidth}px`);
  resizeHandle?.setAttribute('aria-valuenow', String(aiWidth));
  resizeHandle?.setAttribute('aria-valuemax', String(Math.min(560, window.innerWidth - 710)));
  try { localStorage.setItem('taskdesk:ai-width', String(aiWidth)); } catch { /* Optional preference. */ }
}
try {
  const width = Number(localStorage.getItem('taskdesk:ai-width'));
  if (width >= 320 && width <= 560 && !narrowScreen.matches) resizeAi(width);
} catch { /* Use the default panel width. */ }
window.addEventListener('resize', () => { if (!narrowScreen.matches) resizeAi(aiWidth); });
resizeHandle?.addEventListener('keydown', event => {
  if (narrowScreen.matches || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  resizeAi(event.key === 'Home' ? 320 : event.key === 'End' ? 560 : aiWidth + (event.key === 'ArrowLeft' ? 20 : -20));
});
resizeHandle?.addEventListener('pointerdown', event => {
  if (event.button !== 0 || narrowScreen.matches) return;
  event.preventDefault();
  resizeHandle.setPointerCapture(event.pointerId);
});
resizeHandle?.addEventListener('pointermove', event => {
  if (resizeHandle.hasPointerCapture(event.pointerId)) resizeAi(window.innerWidth - event.clientX);
});
resizeHandle?.addEventListener('pointerup', event => {
  if (resizeHandle.hasPointerCapture(event.pointerId)) resizeHandle.releasePointerCapture(event.pointerId);
});

let pinnedViews = new Set<string>();
try {
  const stored: unknown = JSON.parse(localStorage.getItem('taskdesk:pinned-views') ?? '[]');
  if (Array.isArray(stored)) pinnedViews = new Set(stored.filter((value): value is string => typeof value === 'string'));
} catch { /* Pins are an optional local preference. */ }
function renderPins(): void {
  let visible = 0;
  for (const link of document.querySelectorAll<HTMLElement>('[data-pinned-view]')) {
    link.hidden = !pinnedViews.has(link.dataset.viewId ?? '');
    if (!link.hidden) visible++;
  }
  const empty = document.querySelector<HTMLElement>('[data-pins-empty]');
  if (empty) empty.hidden = visible > 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pin-view]')) {
    const pinned = pinnedViews.has(button.dataset.viewId ?? '');
    button.setAttribute('aria-pressed', String(pinned));
    button.textContent = pinned ? 'Unpin view' : 'Pin view';
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pin-view]')) button.addEventListener('click', () => {
  const id = button.dataset.viewId;
  if (!id) return;
  if (pinnedViews.has(id)) pinnedViews.delete(id); else pinnedViews.add(id);
  try { localStorage.setItem('taskdesk:pinned-views', JSON.stringify([...pinnedViews])); }
  catch { showAiStatus('This browser could not save your pinned views.', true); }
  renderPins();
});
renderPins();
if (new URLSearchParams(location.search).get('focus') === 'search') document.querySelector<HTMLInputElement>('main input[type="search"]')?.focus();

async function lookupObjects(query: string, signal: AbortSignal): Promise<ObjectLookupResult> {
  const response = await fetch(`/objects/lookup?${new URLSearchParams({ q: query })}`, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Search failed (${response.status}). Try again.`);
  const result: unknown = await response.json();
  if (!Value.Check(ObjectLookupSchema, result)) throw new Error('Search returned an invalid response.');
  return result;
}

if (objectSearch) {
  const searchForm = objectSearch.querySelector<HTMLFormElement>('[data-object-search-form]')!;
  const input = searchForm.querySelector<HTMLInputElement>('input[name="q"]')!;
  const results = objectSearch.querySelector<HTMLUListElement>('[data-search-results]')!;
  const status = objectSearch.querySelector<HTMLElement>('[data-search-status]')!;
  let pending: AbortController | undefined;
  let returnFocus: HTMLElement | null = null;
  let insertion: WritingSelection | undefined;
  const search = async () => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    results.replaceChildren();
    status.textContent = 'Searching…';
    try {
      const result = await lookupObjects(input.value, controller.signal);
      if (controller.signal.aborted) return;
      for (const item of result.items) {
        const row = document.createElement('li');
        const choice = insertion ? document.createElement('button') : document.createElement('a');
        if (choice instanceof HTMLAnchorElement) choice.href = `/objects/${item.id}`;
        else {
          choice.type = 'button';
          choice.addEventListener('click', () => {
            const target = insertion;
            if (!target || !target.insert(item.title || 'Untitled', `/objects/${item.id}`)) return;
            objectSearch.close();
          });
        }
        const title = document.createElement('strong');
        title.textContent = item.title || 'Untitled';
        const type = document.createElement('span');
        type.textContent = item.typeName;
        choice.append(title, type);
        row.append(choice);
        results.append(row);
      }
      status.textContent = result.truncated ? 'Showing the first 50 matches. Narrow your search.' : result.items.length ? `${result.items.length} found. Use ↓ or Tab to choose; Enter ${insertion ? 'inserts a link' : 'opens an object'}.` : 'No matching objects.';
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error instanceof Error ? error.message : 'Search failed. Try again.';
    }
  };
  const openSearch = (selection?: WritingSelection) => {
    if (objectSearch.open) { input.focus(); return; }
    insertion = selection;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    objectSearch.querySelector('#object-search-heading')!.textContent = insertion ? 'Insert an object link' : 'Find an object';
    objectSearch.showModal();
    input.focus();
    input.select();
    void search();
  };
  for (const trigger of document.querySelectorAll<HTMLAnchorElement>('[data-object-search]')) trigger.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openSearch();
  });
  for (const trigger of document.querySelectorAll<HTMLButtonElement>('[data-insert-object-link]')) trigger.addEventListener('click', () => {
    const textarea = trigger.form?.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    if (!textarea || textarea.disabled || textarea.readOnly || trigger.form?.dataset.busy === 'true') return;
    if (writingEditor) {
      openSearch(writingEditor.selection());
      return;
    }
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    openSearch({
      insert(title, href) {
        if (!textarea.isConnected || textarea.disabled || textarea.readOnly || textarea.form?.dataset.busy === 'true') return false;
        const label = title.replace(/[\r\n]+/g, ' ').replace(/[\\[\]`*_{}()<>!#+\-.|~&]/g, '\\$&');
        textarea.setRangeText(`[${label}](${href})`, start, end, 'end');
        start = end = textarea.selectionEnd;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      restore() { textarea.focus(); textarea.setSelectionRange(start, end); },
    });
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && !event.isComposing && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
  });
  objectSearch.querySelector('[data-search-close]')?.addEventListener('click', () => objectSearch.close());
  objectSearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      objectSearch.close();
    }
  });
  objectSearch.addEventListener('close', () => {
    pending?.abort();
    if (insertion) insertion.restore();
    else if (returnFocus?.isConnected) returnFocus.focus();
    insertion = undefined;
  });
  searchForm.addEventListener('submit', event => {
    event.preventDefault();
    if (searchForm.reportValidity()) void search();
  });
  input.addEventListener('input', () => {
    pending?.abort();
    results.replaceChildren();
    status.textContent = 'Press Enter to search.';
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && results.firstElementChild) {
      event.preventDefault();
      results.querySelector<HTMLElement>('a, button')?.focus();
    }
  });
  results.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const choices = [...results.querySelectorAll<HTMLElement>('a, button')];
    const index = choices.findIndex(choice => choice === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) input.focus();
    else choices[Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))]?.focus();
  });
}


function markDirty(form: HTMLFormElement): void {
  dirtyForms.add(form);
  const status = form.querySelector<HTMLElement>('[data-form-state]');
  if (status && form.dataset.busy !== 'true') {
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Unsaved changes';
    status.classList.remove('error');
  }
}

for (const form of forms) {
  if (form.dataset.draft === 'true') dirtyForms.add(form);
  else if (form.hasAttribute('data-object-editor')) {
    const state = form.querySelector<HTMLElement>('[data-form-state]');
    const revision = form.querySelector<HTMLInputElement>('input[name="revision"]');
    if (state && revision && state.getAttribute('role') !== 'alert') state.textContent = `Saved · revision ${revision.value}`;
  }
  form.addEventListener('input', event => {
    if (!(event.target instanceof Element && event.target.closest('[data-writing-mount], [data-writing-toolbar], [data-writing-link-dialog]'))) markDirty(form);
  });
  form.addEventListener('change', event => {
    if (!(event.target instanceof Element && event.target.closest('[data-writing-mount], [data-writing-toolbar], [data-writing-link-dialog]'))) markDirty(form);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.dataset.busy === 'true') return;
    let writingSource: string | undefined;
    if (form === writingForm) {
      try {
        const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]')!;
        writingSource = writingEditor ? writingEditor.flush() : textarea.value === textarea.defaultValue ? JSON.parse(textarea.dataset.writingSource!) as string : textarea.value;
      }
      catch (error) {
        const status = form.querySelector<HTMLElement>('[data-form-state]');
        if (status) {
          status.setAttribute('role', 'alert');
          status.textContent = error instanceof Error ? error.message : 'Writing could not be saved. Your draft remains in the editor.';
        }
        return;
      }
    }
    if (!form.reportValidity()) return;
    const data = new URLSearchParams();
    for (const [name, value] of new FormData(form)) data.append(name, String(value));
    if (writingSource !== undefined) data.set('body', writingSource);
    const submitter = event.submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) data.append(submitter.name, submitter.value);
    const status = form.querySelector<HTMLElement>('[data-form-state]');
    const controls = [...form.elements].filter((control): control is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement => control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement || control instanceof HTMLButtonElement);
    const previouslyDisabled = controls.map(control => control.disabled);
    if (status) {
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = 'Saving…';
      status.classList.remove('error');
    }
    form.dataset.busy = 'true';
    form.setAttribute('aria-busy', 'true');
    if (form === writingForm) writingEditor?.setBusy(true);
    for (const control of controls) control.disabled = true;
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin', headers: { Accept: 'text/html' } });
      const html = await response.text();
      const page = new DOMParser().parseFromString(html, 'text/html');
      const error = page.querySelector('[data-form-state][role="alert"]')?.textContent?.trim()
        || [...page.querySelectorAll('[role="alert"]')].map(element => element.textContent?.trim()).find(Boolean);
      if (!response.ok && form.hasAttribute('data-object-editor')) {
        const discovery = form.querySelector('[data-journal-discovery]');
        const nextDiscovery = page.querySelector('[data-journal-discovery]');
        if (discovery && nextDiscovery) discovery.replaceWith(document.importNode(nextDiscovery, true));
      }
      if (response.status === 409 && form.hasAttribute('data-object-editor')) {
        const nextPanel = page.querySelector<HTMLElement>('[data-conflict-panel]:not([hidden])');
        const currentPanel = document.querySelector<HTMLElement>('[data-conflict-panel]');
        const nextControls = page.querySelector('[data-object-save-controls]');
        const currentControls = form.querySelector('[data-object-save-controls]');
        if (nextPanel && currentPanel && nextControls && currentControls) {
          const panel = document.importNode(nextPanel, true);
          currentPanel.replaceWith(panel);
          currentControls.replaceWith(document.importNode(nextControls, true));
          form.closest('.object-editing')?.classList.add('has-conflict');
          const reading = document.querySelector<HTMLElement>('[data-native-reading]');
          if (reading) reading.hidden = true;
          panel.focus();
        }
      }
      if (!response.ok || !response.redirected) throw new Error(error || `The request could not be saved (${response.status}). Your changes are still here.`);
      dirtyForms.delete(form);
      form.dataset.busy = 'false';
      window.location.assign(response.url);
    } catch (error) {
      if (status) {
        status.setAttribute('role', 'alert');
        status.setAttribute('aria-live', 'assertive');
        status.classList.add('error');
        status.textContent = error instanceof Error ? error.message : 'Unable to save. Your changes are still here.';
      }
    } finally {
      form.dataset.busy = 'false';
      form.removeAttribute('aria-busy');
      if (form === writingForm) writingEditor?.setBusy(false);
      controls.forEach((control, index) => { control.disabled = previouslyDisabled[index] ?? false; });
    }
  });
}

window.addEventListener('beforeunload', event => {
  if (!dirtyForms.size && !aiBusy && (draftStored || !aiState.draft) && ![...forms].some(form => form.dataset.busy === 'true')) return;
  event.preventDefault();
  event.returnValue = '';
});

const typeNameInput = document.querySelector<HTMLInputElement>('[data-type-create] input[name="name"]');
const typeNamePreview = document.querySelector<HTMLElement>('[data-type-name-preview]');
if (typeNameInput && typeNamePreview) {
  const sync = () => { typeNamePreview.textContent = typeNameInput.value.trim() || 'Your new type'; };
  typeNameInput.addEventListener('input', sync);
  sync();
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-journal-today]')) {
  link.href = `/journal?date=${localDate()}`;
  link.addEventListener('click', () => { link.href = `/journal?date=${localDate()}`; });
}
const journalPicker = document.querySelector<HTMLFormElement>('[data-journal-picker]');
const pickedDate = journalPicker?.querySelector<HTMLInputElement>('input[name="date"]');
if (journalPicker && pickedDate) {
  if (journalPicker.dataset.localDateDefault === 'true' && pickedDate.value === pickedDate.defaultValue && pickedDate.value !== localDate()) {
    window.location.replace(`/journal?date=${localDate()}`);
  }
  pickedDate.addEventListener('input', () => {
    const date = document.querySelector<HTMLInputElement>('[data-journal-open] input[name="date"]');
    const label = document.querySelector<HTMLElement>('[data-journal-day]');
    const discovery = document.querySelector<HTMLElement>('[data-journal-discovery]');
    if (date) date.value = pickedDate.value;
    if (label) label.textContent = pickedDate.value;
    if (discovery) discovery.hidden = true;
  });
}

for (const select of document.querySelectorAll<HTMLSelectElement>('[data-new-type]')) {
  const form = select.form;
  if (!form) continue;
  const title = form.querySelector<HTMLInputElement>('input[name="title"]');
  const journalDate = form.querySelector<HTMLInputElement>('[data-journal-date]');
  let currentType = select.value;
  let titleEdited = form.dataset.draft === 'true' || Boolean(title && title.value !== title.defaultValue);
  title?.addEventListener('input', () => { titleEdited = true; });
  journalDate?.addEventListener('input', () => {
    const discovery = form.querySelector<HTMLElement>('[data-journal-discovery]');
    if (discovery) discovery.hidden = true;
  });
  if (form.dataset.localDateDefault === 'true' && journalDate && journalDate.value === journalDate.defaultValue) {
    const discovery = form.querySelector<HTMLElement>('[data-journal-discovery]');
    if (discovery && journalDate.value !== localDate()) discovery.hidden = true;
    journalDate.value = localDate();
    if (title && !titleEdited && title.dataset.journalTitleDefault === 'true') title.value = journalDate.value;
  }
  const sync = () => {
    if (form.dataset.busy === 'true') { select.value = currentType; return; }
    if (select.value !== currentType) {
      const discovery = form.querySelector<HTMLElement>('[data-journal-discovery]');
      if (discovery) discovery.hidden = true;
    }
    currentType = select.value;
    const back = document.querySelector<HTMLAnchorElement>('[data-object-back]');
    if (back) {
      back.href = `/?type=${encodeURIComponent(select.value)}`;
      back.textContent = `← ${select.selectedOptions[0]?.textContent ?? ''} objects`;
    }
    let count = 0;
    for (const field of form.querySelectorAll<HTMLFieldSetElement>('[data-type-ids]')) {
      const active = field.dataset.retained === 'true' || (field.dataset.typeIds?.split(' ').includes(select.value) ?? false);
      field.hidden = !active;
      field.disabled = !active;
      if (active) count++;
    }
    for (const field of form.querySelectorAll<HTMLInputElement>('[data-inactive-draft]')) field.disabled = true;
    for (const rule of form.querySelectorAll<HTMLElement>('[data-builtin-rule]')) rule.hidden = rule.dataset.builtinRule !== select.value;
    if (journalDate) journalDate.required = select.value === JOURNAL_TYPE_ID;
    if (select.value === JOURNAL_TYPE_ID && form.dataset.newObject === 'true' && title && !titleEdited && !title.value) title.value = journalDate?.value || localDate();
    const badge = form.querySelector<HTMLElement>('[data-property-count]');
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
    const typeLabel = form.querySelector('[data-object-type-label]');
    if (typeLabel) typeLabel.textContent = select.selectedOptions[0]?.textContent ?? '';
    form.querySelector('[data-type-setup]')?.setAttribute('href', `/types/${select.value}`);
    const empty = form.querySelector<HTMLElement>('[data-properties-empty]');
    if (empty) empty.hidden = count > 0;
  };
  select.addEventListener('change', sync);
  sync();
}

for (const select of document.querySelectorAll<HTMLSelectElement>('[data-property-kind]')) {
  const sync = () => {
    const help = select.form?.querySelector<HTMLElement>('[data-kind-help]');
    if (help) help.textContent = select.selectedOptions[0]?.dataset.help ?? '';
    for (const section of select.form?.querySelectorAll<HTMLElement>('[data-kind-options]') ?? []) {
      const enabled = section.dataset.kindOptions === select.value;
      section.hidden = !enabled;
      for (const input of section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
        input.disabled = !enabled;
        if (input.name === 'options' || input.name === 'targetTypeId') input.required = enabled;
      }
    }
  };
  select.addEventListener('change', sync);
  sync();
}

