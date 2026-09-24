import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { EditorState } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { documentSchema } from './document.js';
import type { ViewConversation } from './model.js';

const dirtyForms = new Set<HTMLFormElement>();
const editors = new Map<HTMLFormElement, EditorView>();
const forms = document.querySelectorAll<HTMLFormElement>('form[data-enhance]');

interface AiState { open: boolean; draft: string; conversationId?: string; previousId?: string; contextTitle: string }
const aiPanel = document.querySelector<HTMLElement>('#ai-panel');
const aiForm = document.querySelector<HTMLFormElement>('[data-ai-form]');
const aiPrompt = aiForm?.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
const aiStatus = document.querySelector<HTMLElement>('[data-ai-status]');
const aiTurns = document.querySelector<HTMLElement>('[data-ai-turns]');
const aiContext = document.querySelector<HTMLElement>('[data-ai-context-label]');
const navigation = document.querySelector<HTMLElement>('#workspace-nav');
const backdrop = document.querySelector<HTMLElement>('[data-panel-backdrop]');
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

function renderConversation(): void {
  if (aiContext) aiContext.textContent = conversation?.turns.at(-1)?.title ?? aiState.contextTitle;
  if (!aiTurns) return;
  aiTurns.replaceChildren();
  if (!conversation?.turns.length) {
    const empty = document.createElement('div');
    empty.className = 'ai-empty';
    const heading = document.createElement('h3');
    heading.textContent = aiState.previousId ? 'Make this view your own' : 'A different way to see your objects';
    const text = document.createElement('p');
    text.textContent = aiState.previousId ? 'Describe what to change. You’ll get a separate draft to review; the original stays untouched.' : 'Describe a list, table, calendar, or board. AI builds a draft here, and you preview it in the main workspace.';
    empty.append(heading, text);
    aiTurns.append(empty);
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
  aiPrompt.addEventListener('input', () => { aiState.draft = aiPrompt.value; persistAi(); });
}
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
  } finally { aiLoading = false; }
}
void restoreConversation();

aiForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!aiPrompt || aiBusy || aiLoading || !aiForm.reportValidity()) return;
  aiBusy = true;
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

function markDirty(form: HTMLFormElement): void {
  dirtyForms.add(form);
  const status = form.querySelector<HTMLElement>('[data-form-state]');
  if (status && form.dataset.busy !== 'true') {
    status.setAttribute('role', 'status');
    status.textContent = 'Unsaved changes';
    status.classList.remove('error');
  }
}

for (const form of forms) {
  form.addEventListener('input', () => markDirty(form));
  form.addEventListener('change', () => markDirty(form));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.dataset.busy === 'true') return;
    if (!form.reportValidity()) return;
    const data = new URLSearchParams();
    for (const [name, value] of new FormData(form)) data.append(name, String(value));
    const submitter = event.submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) data.append(submitter.name, submitter.value);
    const status = form.querySelector<HTMLElement>('[data-form-state]');
    const controls = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button')];
    const previouslyDisabled = controls.map(control => control.disabled);
    const editor = editors.get(form);
    if (status) {
      status.setAttribute('role', 'status');
      status.textContent = 'Saving…';
      status.classList.remove('error');
    }
    form.dataset.busy = 'true';
    form.setAttribute('aria-busy', 'true');
    for (const control of controls) control.disabled = true;
    editor?.setProps({ editable: () => false });
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin', headers: { Accept: 'text/html' } });
      const html = await response.text();
      const page = new DOMParser().parseFromString(html, 'text/html');
      const error = page.querySelector('[role="alert"]')?.textContent?.trim();
      if (!response.ok || !response.redirected) throw new Error(error || `The request could not be saved (${response.status}). Your changes are still here.`);
      dirtyForms.delete(form);
      form.dataset.busy = 'false';
      window.location.assign(response.url);
    } catch (error) {
      if (status) {
        status.setAttribute('role', 'alert');
        status.classList.add('error');
        status.textContent = error instanceof Error ? error.message : 'Unable to save. Your changes are still here.';
      }
    } finally {
      editor?.setProps({ editable: () => true });
      form.dataset.busy = 'false';
      form.removeAttribute('aria-busy');
      controls.forEach((control, index) => { control.disabled = previouslyDisabled[index] ?? false; });
    }
  });
}

window.addEventListener('beforeunload', event => {
  if (!dirtyForms.size && !aiBusy && (draftStored || !aiState.draft) && ![...forms].some(form => form.dataset.busy === 'true')) return;
  event.preventDefault();
  event.returnValue = '';
});

for (const select of document.querySelectorAll<HTMLSelectElement>('[data-new-type]')) {
  select.addEventListener('change', () => select.form?.requestSubmit());
}

for (const select of document.querySelectorAll<HTMLSelectElement>('[data-property-kind]')) {
  const sync = () => {
    for (const section of select.form?.querySelectorAll<HTMLElement>('[data-kind-options]') ?? []) {
      const enabled = section.dataset.kindOptions === select.value;
      section.hidden = !enabled;
      for (const input of section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) input.disabled = !enabled;
    }
  };
  select.addEventListener('change', sync);
  sync();
}

for (const mount of document.querySelectorAll<HTMLElement>('[data-editor-mount]')) {
  const form = mount.closest<HTMLFormElement>('form');
  const field = form?.querySelector<HTMLInputElement>('[data-document-field]');
  const fallback = form?.querySelector<HTMLElement>('[data-markdown-fallback]');
  const textarea = fallback?.querySelector<HTMLTextAreaElement>('textarea');
  const toolbar = form?.querySelector<HTMLElement>('[data-editor-toolbar]');
  if (!form || !field || !fallback || !textarea || !toolbar) continue;
  let view: EditorView | undefined;
  try {
    const doc = documentSchema.nodeFromJSON(JSON.parse(mount.dataset.document ?? '{}'));
    doc.check();
    const mentions = JSON.parse(mount.dataset.objects ?? '[]') as { id: string; title: string; type: string }[];
    const listItem = documentSchema.nodes.list_item!;
    const commands: Record<string, Command> = {
      bold: toggleMark(documentSchema.marks.strong!),
      italic: toggleMark(documentSchema.marks.em!),
      code: toggleMark(documentSchema.marks.code!),
      heading: setBlockType(documentSchema.nodes.heading!, { level: 2 }),
      paragraph: setBlockType(documentSchema.nodes.paragraph!),
      bullet: wrapInList(documentSchema.nodes.bullet_list!),
      ordered: wrapInList(documentSchema.nodes.ordered_list!),
      undo,
      redo,
    };
    view = new EditorView(mount, {
      state: EditorState.create({
        doc,
        plugins: [history(), keymap({
          'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
          'Mod-b': commands.bold!, 'Mod-i': commands.italic!, 'Mod-`': commands.code!,
          Enter: splitListItem(listItem), Tab: sinkListItem(listItem), 'Shift-Tab': liftListItem(listItem),
          'Mod-[': liftListItem(listItem), 'Mod-]': sinkListItem(listItem),
        }), keymap(baseKeymap)],
      }),
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': 'writing-label', spellcheck: 'true' },
      dispatchTransaction(transaction) {
        if (!view) return;
        view.updateState(view.state.apply(transaction));
        if (transaction.docChanged) {
          field.value = JSON.stringify(view.state.doc.toJSON());
          form.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
    });
    editors.set(form, view);
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-command]')) {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        if (!view) return;
        if (button.dataset.command === 'mention') {
          const select = toolbar.querySelector<HTMLSelectElement>('[data-mention-picker]');
          const mention = mentions.find(item => item.id === select?.value);
          if (!mention) { select?.focus(); return; }
          view.dispatch(view.state.tr.replaceSelectionWith(documentSchema.nodes.object_link!.create({ objectId: mention.id, label: mention.title })).scrollIntoView());
        } else {
          commands[button.dataset.command ?? '']?.(view.state, view.dispatch, view);
        }
        view.focus();
      });
    }
    field.value = JSON.stringify(view.state.doc.toJSON());
    field.disabled = false;
    textarea.disabled = true;
    fallback.hidden = true;
    mount.hidden = false;
    toolbar.hidden = false;
    if (window.location.hash) {
      const preview = form.querySelector<HTMLDetailsElement>('[data-document-preview]');
      const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (preview && target && preview.contains(target)) { preview.open = true; target.scrollIntoView(); }
    }
  } catch {
    view?.destroy();
    editors.delete(form);
    field.disabled = true;
    textarea.disabled = false;
    fallback.hidden = false;
    mount.hidden = true;
    toolbar.hidden = true;
    const status = form.querySelector<HTMLElement>('[data-form-state]');
    if (status) status.textContent = 'Rich editor unavailable. You can still write and save Markdown.';
  }
}
