import { applyWritingEdit, formatMarkdown, writingSelection, writingSource } from './writing-commands.js';
import type { WritingSelection } from './writing-commands.js';
import { safeLink } from './writing-links.js';

export interface WritingEditor {
  flush(): string;
  setBusy(busy: boolean): void;
  selection(): WritingSelection;
}

export function enhanceWriting(form: HTMLFormElement): WritingEditor {
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]')!;
  const toolbar = form.querySelector<HTMLElement>('[data-writing-toolbar]')!;
  const block = toolbar.querySelector<HTMLSelectElement>('[data-writing-block]')!;
  const status = form.querySelector<HTMLElement>('[data-writing-status]')!;
  const modes = form.querySelector<HTMLElement>('[data-writing-modes]')!;
  const editButton = modes.querySelector<HTMLButtonElement>('[data-writing-edit]')!;
  const previewButton = modes.querySelector<HTMLButtonElement>('[data-writing-show-preview]')!;
  const preview = form.querySelector<HTMLElement>('[data-writing-preview]')!;
  const objectLink = form.querySelector<HTMLButtonElement>('[data-insert-object-link]')!;
  const dialog = form.querySelector<HTMLDialogElement>('[data-writing-link-dialog]')!;
  const urlInput = dialog.querySelector<HTMLInputElement>('[data-writing-link-url]')!;
  const linkError = dialog.querySelector<HTMLElement>('[data-writing-link-error]')!;
  let linkSelection: WritingSelection | undefined;
  let linkLabel = '';
  let busy = form.dataset.busy === 'true';
  let composing = false;
  let showingPreview = false;
  let pending: AbortController | undefined;

  const notice = (message: string) => {
    status.hidden = !message;
    status.textContent = message;
  };
  const usable = () => !busy && !composing && !textarea.disabled && !textarea.readOnly && form.isConnected && form.dataset.busy !== 'true';
  const flush = () => {
    if (composing) throw new Error('Finish composing your text before saving. Your draft is still here.');
    const source = writingSource(textarea);
    if (new TextEncoder().encode(source).length > 262_144) throw new Error('Writing must be no larger than 256 KiB. Your draft is still here.');
    return source;
  };
  const refreshControls = () => {
    for (const control of toolbar.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')) control.disabled = busy || showingPreview;
    objectLink.disabled = busy || showingPreview;
    editButton.disabled = busy;
    previewButton.disabled = busy;
    editButton.setAttribute('aria-pressed', String(!showingPreview));
    previewButton.setAttribute('aria-pressed', String(showingPreview));
    textarea.hidden = showingPreview;
    preview.hidden = !showingPreview;
  };
  const edit = (focus = true) => {
    pending?.abort();
    pending = undefined;
    showingPreview = false;
    preview.removeAttribute('aria-busy');
    preview.replaceChildren();
    refreshControls();
    if (focus) textarea.focus();
  };
  const format = (command: string) => {
    if (!usable() || showingPreview) return;
    if (command === 'undo' || command === 'redo') {
      textarea.focus();
      if (typeof document.execCommand === 'function') document.execCommand(command);
      else notice('Your browser does not support toolbar undo/redo. Use its native editing controls.');
      return;
    }
    if (command === 'link') {
      linkSelection = writingSelection(textarea, notice);
      linkLabel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      urlInput.value = '';
      linkError.textContent = '';
      dialog.showModal();
      urlInput.focus();
      return;
    }
    const change = formatMarkdown(textarea.value, textarea.selectionStart, textarea.selectionEnd, command);
    if (change && !applyWritingEdit(textarea, change)) {
      notice('Your browser could not apply formatting with undo support. Edit the Markdown source directly.');
    } else notice('');
  };

  toolbar.hidden = false;
  modes.hidden = false;
  document.body.classList.add('writing-enhanced');
  refreshControls();
  const saveBar = form.querySelector<HTMLElement>('.save-bar');
  if (saveBar) new ResizeObserver(() => {
    document.documentElement.style.setProperty('--writing-save-clearance', `${Math.ceil(saveBar.getBoundingClientRect().height) + 16}px`);
  }).observe(saveBar);

  textarea.addEventListener('compositionstart', () => { composing = true; });
  textarea.addEventListener('compositionend', () => { composing = false; });
  textarea.addEventListener('input', () => {
    // Never display a response for source that has since changed.
    if (showingPreview) edit(false);
    notice('');
  });
  textarea.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.isComposing) return;
    const command = { b: 'bold', i: 'italic' }[event.key.toLowerCase()];
    if (!command) return;
    event.preventDefault();
    format(command);
  });
  textarea.addEventListener('drop', event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    notice('Only text can be dropped. Images and files are not imported.');
  });
  toolbar.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-writing-command]') : null;
    if (button) format(button.dataset.writingCommand!);
  });
  block.addEventListener('change', () => {
    format(block.value);
    block.value = '';
  });
  editButton.addEventListener('click', () => {
    edit();
    notice('');
  });
  previewButton.addEventListener('click', async () => {
    if (!usable()) return;
    let source: string;
    try { source = flush(); }
    catch (error) {
      notice(error instanceof Error ? error.message : 'Preview is unavailable. Your draft is unchanged.');
      return;
    }
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    showingPreview = true;
    refreshControls();
    preview.textContent = 'Loading preview…';
    preview.setAttribute('aria-busy', 'true');
    preview.focus();
    notice('Preview shows this draft, not saved writing. Changes still need saving.');
    try {
      const response = await fetch('/objects/preview', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { Accept: 'application/json' },
        body: new URLSearchParams({ csrf: form.querySelector<HTMLInputElement>('[name="csrf"]')!.value, body: source }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : `Preview failed (${response.status}).`;
        throw new Error(message);
      }
      if (!result || typeof result !== 'object' || !('html' in result) || typeof result.html !== 'string') throw new Error('Preview returned an invalid response.');
      if (controller.signal.aborted || pending !== controller || source !== writingSource(textarea) || !form.isConnected) return;
      // Only the same-origin safe Markdown renderer supplies this HTML.
      preview.innerHTML = result.html;
      if (!source.trim()) preview.textContent = 'Nothing to preview yet.';
      notice('Draft preview ready. Changes still need saving.');
    } catch (error) {
      if (controller.signal.aborted || pending !== controller) return;
      edit();
      notice(`${error instanceof Error ? error.message : 'Preview is unavailable.'} Your draft is unchanged; you can still edit and save.`);
    } finally {
      if (pending === controller) {
        pending = undefined;
        preview.removeAttribute('aria-busy');
      }
    }
  });

  dialog.querySelector('[data-writing-link-cancel]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    linkSelection?.restore();
    linkSelection = undefined;
  });
  const applyLink = () => {
    if (!usable() || !linkSelection) return;
    const href = urlInput.value.trim();
    if (!safeLink(href)) {
      linkError.textContent = 'Use an http, https, mailto, or /objects/UUID address.';
      return;
    }
    // Text outside a native modal is inert until it closes.
    const selection = linkSelection;
    dialog.close();
    selection.insert(linkLabel || href, href);
  };
  dialog.querySelector('[data-writing-link-apply]')!.addEventListener('click', applyLink);
  urlInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    applyLink();
  });

  return {
    flush,
    setBusy(value) {
      busy = value;
      if (pending) edit(false);
      refreshControls();
    },
    selection() { return writingSelection(textarea, notice); },
  };
}
