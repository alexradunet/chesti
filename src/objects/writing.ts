import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, remarkCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from '@milkdown/core';
import { commonmark, codeBlockSchema, imageSchema, linkSchema, paragraphSchema, remarkPreserveEmptyLinePlugin } from '@milkdown/preset-commonmark';
import { gfm, extendListItemSchemaForTask, tableCellSchema, tableHeaderSchema } from '@milkdown/preset-gfm';
import { history } from '@milkdown/plugin-history';
import { $prose, $remark } from '@milkdown/utils';
import { getMarkRange } from '@milkdown/prose';
import { Plugin, TextSelection } from '@milkdown/prose/state';
import type { Command, SelectionBookmark } from '@milkdown/prose/state';
import type { Node as ProseNode } from '@milkdown/prose/model';
import { Slice } from '@milkdown/prose/model';
import type { EditorView } from '@milkdown/prose/view';
import { setBlockType, toggleMark, wrapIn } from '@milkdown/prose/commands';
import { wrapInList } from '@milkdown/prose/schema-list';
import { closeHistory, undo, redo } from '@milkdown/prose/history';
import { documentMeaning, literalAutolinks, markdownMeaning, unusedDefinitions } from './writing-format.js';
import type { MarkdownNode } from './writing-format.js';
import { safeLink, writingHref } from './writing-links.js';

export interface WritingSelection {
  insert(title: string, href: string): boolean;
  restore(): void;
}
export interface WritingEditor {
  flush(): string;
  setBusy(busy: boolean): void;
  selection(): WritingSelection;
}

export async function enhanceWriting(form: HTMLFormElement): Promise<WritingEditor> {
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]')!;
  const mount = form.querySelector<HTMLElement>('[data-writing-mount]')!;
  const toolbar = form.querySelector<HTMLElement>('[data-writing-toolbar]')!;
  const block = toolbar.querySelector<HTMLSelectElement>('[data-writing-block]')!;
  const status = form.querySelector<HTMLElement>('[data-writing-status]')!;
  const dialog = form.querySelector<HTMLDialogElement>('[data-writing-link-dialog]')!;
  const urlInput = dialog.querySelector<HTMLInputElement>('[data-writing-link-url]')!;
  urlInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    dialog.querySelector<HTMLButtonElement>('[data-writing-link-apply]')!.click();
  });
  const linkError = dialog.querySelector<HTMLElement>('[data-writing-link-error]')!;
  const nativeSnapshot = textarea.value;
  if (textarea.value !== textarea.defaultValue) throw new Error('Markdown editing already started. Save or reload before switching to formatted editing.');
  const originalSource: string = JSON.parse(textarea.dataset.writingSource!);
  let ready = false;
  let busy = false;
  let initialDoc: ProseNode;
  let view: EditorView;
  let linkBookmark: SelectionBookmark | undefined;
  let linkRange: { from: number; to: number } | undefined;
  let editor: Editor;

  const notice = (message: string) => { status.hidden = !message; status.textContent = message; };
  const usable = () => ready && !busy && form.isConnected && form.dataset.busy !== 'true';
  const commandFor = (name: string): Command | undefined => {
    const { nodes, marks } = view.state.schema;
    switch (name) {
      case 'bold': return toggleMark(marks.strong!);
      case 'italic': return toggleMark(marks.emphasis!);
      case 'strike': return toggleMark(marks.strike_through!);
      case 'code': return toggleMark(marks.inlineCode!);
      case 'bullet': return wrapInList(nodes.bullet_list!);
      case 'ordered': return wrapInList(nodes.ordered_list!);
      case 'quote': return wrapIn(nodes.blockquote!);
      case 'code-block': return setBlockType(nodes.code_block!);
      case 'undo': return undo;
      case 'redo': return redo;
    }
    return undefined;
  };
  const markNames: Record<string, string> = { bold: 'strong', italic: 'emphasis', strike: 'strike_through', code: 'inlineCode' };
  const refreshToolbar = () => {
    if (!ready) return;
    const { state } = view;
    const parent = state.selection.$from.parent;
    block.value = parent.type.name === 'heading' ? `heading-${parent.attrs.level}` : 'paragraph';
    block.disabled = busy;
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>('[data-writing-command]')) {
      const name = button.dataset.writingCommand!;
      const command = commandFor(name);
      button.disabled = busy || Boolean(command && !command(state));
      const mark = state.schema.marks[markNames[name] ?? ''];
      if (mark) {
        const active = state.selection.empty ? mark.isInSet(state.storedMarks ?? state.selection.$from.marks()) : state.doc.rangeHasMark(state.selection.from, state.selection.to, mark);
        button.setAttribute('aria-pressed', String(Boolean(active)));
      }
    }
  };
  const parse = (source: string) => editor.action(ctx => ctx.get(parserCtx)(source));
  const serialize = (doc: ProseNode) => editor.action(ctx => ctx.get(serializerCtx)(doc));
  const ast = (source: string) => editor.action(ctx => ctx.get(remarkCtx).parse(source) as MarkdownNode);
  const compatible = (source: string, doc: ProseNode) => {
    const output = serialize(doc);
    if (markdownMeaning(ast(source), source) !== markdownMeaning(ast(output), output)) {
      throw new Error('This writing cannot be round-tripped without changing its content. Edit its Markdown source instead.');
    }
    return output;
  };
  const pasteText = (text: string) => {
    if (!usable()) return;
    if (new TextEncoder().encode(text).length > 262_144) { notice('Pasted writing exceeds 256 KiB. Nothing was inserted.'); return; }
    if (view.state.selection.$from.parent.type.spec.code) {
      view.dispatch(view.state.tr.insertText(text));
      return;
    }
    try {
      const doc = parse(text);
      if (unusedDefinitions(ast(text)).length) throw new Error('Unused link definitions are retained as literal pasted text.');
      compatible(text, doc);
      view.dispatch(closeHistory(view.state.tr).replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
      notice('');
    } catch (error) {
      // ProseMirror's plain-text paste creates paragraphs, not raw Markdown-shaped newlines.
      view.dispatch(closeHistory(view.state.tr));
      view.pasteText(text);
      notice(`Pasted as plain text: ${error instanceof Error ? error.message : 'unsupported Markdown'}`);
    }
  };

  const dialect = $remark('taskdesk-literal-autolinks', () => () => (tree, file) => {
    literalAutolinks(tree as MarkdownNode, String(file.value));
  });
  const changes = $prose(() => new Plugin({
    view: () => ({ update(next, previous) {
      if (!ready) return;
      if (!next.state.doc.eq(previous.doc)) textarea.dispatchEvent(new Event('input', { bubbles: true }));
      refreshToolbar();
    } }),
    props: {
      handleDOMEvents: {
        change(_view, event) {
          const input = event.target;
          if (!(input instanceof HTMLInputElement) || !input.classList.contains('writing-task-check')) return false;
          const item = input.closest('li')!;
          const position = view.state.doc.resolve(view.posAtDOM(item, 0));
          for (let depth = position.depth; depth > 0; depth--) {
            const node = position.node(depth);
            if (node.type.name !== 'list_item') continue;
            if (usable()) {
              const focused = document.activeElement === input;
              const nodePos = position.before(depth);
              view.dispatch(closeHistory(view.state.tr).setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: input.checked }));
              const rendered = view.nodeDOM(nodePos);
              if (focused && rendered instanceof Element) rendered.querySelector<HTMLInputElement>('.writing-task-check')?.focus({ preventScroll: true });
            } else input.checked = Boolean(node.attrs.checked);
            break;
          }
          return true;
        },
        paste(_view, event) {
          event.preventDefault();
          if (!usable()) return true;
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (text) pasteText(text);
          else notice('Only text can be pasted. Images and files are not loaded.');
          return true;
        },
        drop(_view, event) {
          // Block external HTML and files before ProseMirror's DOM parser sees them.
          if (_view.dragging && usable()) return false;
          event.preventDefault();
          if (!usable()) return true;
          const text = event.dataTransfer?.getData('text/plain') ?? '';
          if (text) {
            const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (point) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(point.pos))));
            pasteText(text);
          } else notice('Only text can be dropped. Images and files are not loaded.');
          return true;
        },
      },
    },
  }));

  const excluded = new Set(remarkPreserveEmptyLinePlugin);
  editor = Editor.make().config(ctx => {
    ctx.set(rootCtx, mount);
    ctx.set(defaultValueCtx, originalSource);
    ctx.update(remarkStringifyOptionsCtx, options => ({ ...options, resourceLink: true, handlers: { ...options.handlers, break: () => '  \n' } }));
    ctx.update(editorViewOptionsCtx, options => ({
      ...options,
      attributes: { class: 'writing-editor', role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': 'writing-heading', 'aria-describedby': 'markdown-help', spellcheck: 'true' },
      editable: () => !busy,
      handleDOMEvents: {
        // Let native Tab leave the editor and the workspace own its search shortcut.
        // Returning true here skips editor keymaps without preventing browser defaults.
        keydown: (_view, event) => event.key === 'Tab' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'),
      },
      clipboardTextSerializer: slice => ctx.get(serializerCtx)(view.state.schema.topNodeType.create(null, slice.content)),
    }));
    ctx.update(imageSchema.key, previous => context => {
      const base = previous(context);
      return { ...base, attrs: { ...base.attrs, title: { default: null, validate: 'string|null' } },
        toDOM: node => ['span', { class: 'document-image', 'data-image-src': node.attrs.src }, `[Image: ${node.attrs.alt || node.attrs.src || ''}]`] };
    });
    ctx.update(linkSchema.key, previous => context => ({
      ...previous(context),
      toDOM: mark => safeLink(mark.attrs.href) ? ['a', { href: writingHref(mark.attrs.href), rel: 'noreferrer', title: mark.attrs.title }, 0] : ['span', { class: 'unsafe-writing-link' }, 0],
    }));
    ctx.update(codeBlockSchema.key, previous => context => {
      const base = previous(context);
      return { ...base, attrs: { ...base.attrs, meta: { default: '', validate: 'string' } },
        parseMarkdown: { ...base.parseMarkdown, runner(state, node, type) {
          state.openNode(type, { language: node.lang ?? '', meta: node.meta ?? '' });
          if (node.value) state.addText(String(node.value));
          state.closeNode();
        } },
        toMarkdown: { ...base.toMarkdown, runner(state, node) {
          state.addNode('code', undefined, node.textContent, { lang: node.attrs.language, meta: node.attrs.meta || null });
        } },
      };
    });
    ctx.update(paragraphSchema.key, previous => context => {
      const base = previous(context);
      return { ...base, toMarkdown: { ...base.toMarkdown, runner(state, node) {
        state.openNode('paragraph');
        state.next(node.content);
        state.closeNode();
      } } };
    });
    for (const [schema, tag] of [[tableCellSchema, 'td'], [tableHeaderSchema, 'th']] as const) {
      ctx.update(schema.key, previous => context => ({
        ...previous(context),
        toDOM: node => [tag, { 'data-align': node.attrs.alignment || 'left', colspan: node.attrs.colspan, rowspan: node.attrs.rowspan }, 0],
      }));
    }
    ctx.update(extendListItemSchemaForTask.key, previous => context => {
      const base = previous(context);
      return { ...base, toDOM: node => node.attrs.checked == null ? base.toDOM!(node) : ['li', { 'data-item-type': 'task', 'data-checked': String(node.attrs.checked) },
        ['input', { type: 'checkbox', class: 'writing-task-check', contenteditable: 'false', 'aria-label': `Completed: ${node.textContent.slice(0, 100)}`, ...(node.attrs.checked ? { checked: '' } : {}) }], ['div', 0]] };
    });
  }).use(dialect).use(commonmark.filter(plugin => !excluded.has(plugin))).use(gfm).use(history).use(changes);

  try {
    await editor.create();
    view = editor.action(ctx => ctx.get(editorViewCtx));
    compatible(originalSource, view.state.doc);
    if (textarea.value !== nativeSnapshot || document.activeElement === textarea || document.querySelector('#object-search[open]') || form.dataset.busy === 'true' || !form.isConnected) {
      throw new Error('Markdown editing started while the formatted editor loaded. Your current source stays available; save or reload before switching.');
    }
    initialDoc = view.state.doc;
  } catch (error) {
    await editor.destroy();
    mount.replaceChildren();
    throw error;
  }
  const definitions = unusedDefinitions(ast(originalSource)).map(node => editor.action(ctx => ctx.get(remarkCtx).stringify({
    type: 'root',
    children: [{ type: 'definition', identifier: node.identifier!, url: node.url!, title: node.title, label: node.label }],
  })).trimEnd());
  ready = true;
  mount.hidden = false;
  toolbar.hidden = false;
  textarea.hidden = true;
  document.body.classList.add('writing-enhanced');
  form.querySelector('#markdown-help')!.textContent = 'Edit formatted writing directly. Save applies your changes. Writing edits may normalize Markdown formatting; properties alone leave the original source unchanged.';
  refreshToolbar();
  const saveBar = form.querySelector<HTMLElement>('.save-bar')!;
  new ResizeObserver(() => {
    const bottom = Math.ceil(saveBar.getBoundingClientRect().height) + 16;
    const clearance = { top: 16, right: 0, bottom, left: 0 };
    document.documentElement.style.setProperty('--writing-save-clearance', `${bottom}px`);
    view.setProps({ scrollThreshold: clearance, scrollMargin: clearance });
  }).observe(saveBar);

  toolbar.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  });
  toolbar.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-writing-command]') : null;
    if (!button || !usable()) return;
    if (button.dataset.writingCommand === 'link') {
      linkBookmark = view.state.selection.getBookmark();
      const range = getMarkRange(view.state.selection.$from, view.state.schema.marks.link!);
      linkRange = view.state.selection.empty && range ? { from: range.from, to: range.to } : undefined;
      urlInput.value = range?.mark.attrs.href ?? '';
      linkError.textContent = '';
      dialog.showModal();
      urlInput.focus();
      return;
    }
    const command = commandFor(button.dataset.writingCommand!);
    if (command) { command(view.state, view.dispatch, view); view.focus(); }
  });
  block.addEventListener('change', () => {
    if (!usable()) return;
    const heading = block.value.startsWith('heading-');
    setBlockType(view.state.schema.nodes[heading ? 'heading' : 'paragraph']!, heading ? { level: Number(block.value.slice(8)) } : undefined)(view.state, view.dispatch);
    view.focus();
  });
  dialog.querySelector('[data-writing-link-cancel]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (linkBookmark) view.dispatch(view.state.tr.setSelection(linkBookmark.resolve(view.state.doc)));
    view.focus();
    linkBookmark = undefined;
    linkRange = undefined;
  });
  dialog.querySelector('[data-writing-link-apply]')!.addEventListener('click', () => {
    if (!usable() || !linkBookmark) return;
    const href = urlInput.value.trim();
    if (href && !safeLink(href)) { linkError.textContent = 'Use an http, https, mailto, or /objects/UUID address.'; return; }
    let tr = closeHistory(view.state.tr).setSelection(linkBookmark.resolve(view.state.doc));
    if (linkRange) tr = tr.setSelection(TextSelection.create(tr.doc, linkRange.from, linkRange.to));
    const { from, to, empty } = tr.selection;
    const link = view.state.schema.marks.link!;
    if (!href) tr = tr.removeMark(from, to, link);
    else if (empty) tr = tr.replaceSelectionWith(view.state.schema.text(href, [link.create({ href: writingHref(href) })]), false);
    else tr = tr.addMark(from, to, link.create({ href: writingHref(href) }));
    view.dispatch(tr.scrollIntoView());
    linkBookmark = view.state.selection.getBookmark();
    linkRange = undefined;
    dialog.close();
  });

  return {
    flush() {
      if (view.composing) throw new Error('Finish composing your text before saving. Your draft is still here.');
      if (view.state.doc.eq(initialDoc)) return originalSource;
      const output = serialize(view.state.doc);
      const result = definitions.length ? `${output.trimEnd()}\n\n${definitions.join('\n\n')}\n` : output;
      if (new TextEncoder().encode(result).length > 262_144) throw new Error('Writing must be no larger than 256 KiB. Your draft is still here.');
      // Validate the actual submitted payload, including retained definitions.
      markdownMeaning(ast(result), result);
      if (documentMeaning(view.state.doc) !== documentMeaning(parse(result))) {
        throw new Error('This writing cannot be saved as Markdown without changing its content. Your draft is still here.');
      }
      textarea.value = result;
      return result;
    },
    setBusy(value) { busy = value; view.setProps({ editable: () => !busy }); refreshToolbar(); },
    selection() {
      let bookmark = view.state.selection.getBookmark();
      return {
        insert(title, href) {
          if (!usable() || !safeLink(href)) return false;
          const text = view.state.schema.text(title.replace(/[\r\n]+/g, ' '), [view.state.schema.marks.link!.create({ href: writingHref(href) })]);
          view.dispatch(closeHistory(view.state.tr).setSelection(bookmark.resolve(view.state.doc)).replaceSelectionWith(text, false).scrollIntoView());
          bookmark = view.state.selection.getBookmark();
          return true;
        },
        restore() { if (form.isConnected) { view.dispatch(view.state.tr.setSelection(bookmark.resolve(view.state.doc))); view.focus(); } },
      };
    },
  };
}
