import { safeLink, writingHref } from './writing-links.js';

export interface WritingEdit {
  from: number;
  to: number;
  text: string;
  start: number;
  end: number;
}

export interface WritingSelection {
  insert(title: string, href: string): boolean;
  restore(): void;
}

/** Browser textareas normalize line endings. Keep the saved source on non-writing edits. */
export function writingSource(textarea: Pick<HTMLTextAreaElement, 'value' | 'defaultValue' | 'dataset'>): string {
  return textarea.value === textarea.defaultValue ? JSON.parse(textarea.dataset.writingSource!) as string : textarea.value;
}

/** Commands edit only the selection (or its lines); they never parse/serialize the document. */
export function formatMarkdown(source: string, from: number, to: number, command: string): WritingEdit | undefined {
  let selected = source.slice(from, to);
  if (['bold', 'italic', 'strike'].includes(command) && /\S/.test(selected)) {
    from += selected.length - selected.trimStart().length;
    to -= selected.length - selected.trimEnd().length;
    selected = source.slice(from, to);
  }
  let longestTicks = 0;
  if (command === 'code' || command === 'code-block') {
    for (const match of selected.matchAll(/`+/g)) longestTicks = Math.max(longestTicks, match[0].length);
  }
  const wrap = (before: string, after: string, placeholder: string): WritingEdit => {
    const text = selected || placeholder;
    return { from, to, text: before + text + after, start: from + before.length, end: from + before.length + text.length };
  };
  switch (command) {
    case 'bold': return wrap('**', '**', 'bold text');
    case 'italic': return wrap('*', '*', 'italic text');
    case 'strike': return wrap('~~', '~~', 'text');
    case 'code': {
      // A longer delimiter can contain any existing backtick runs literally.
      const size = longestTicks + 1;
      const fence = '`'.repeat(size);
      const pad = selected.startsWith('`') || selected.endsWith('`') || (/^ .* $/.test(selected) && /\S/.test(selected)) ? ' ' : '';
      return wrap(fence + pad, pad + fence, 'code');
    }
    case 'code-block': {
      const size = Math.max(2, longestTicks) + 1;
      const fence = '`'.repeat(size);
      const before = (from > 0 && source[from - 1] !== '\n' ? '\n' : '') + fence + '\n';
      const after = '\n' + fence + (to < source.length && source[to] !== '\n' ? '\n' : '');
      return wrap(before, after, 'code');
    }
  }
  const heading = /^heading-([1-6])$/.exec(command);
  if (!heading && !['paragraph', 'bullet', 'ordered', 'task', 'quote'].includes(command)) return;
  const start = from === 0 ? 0 : source.lastIndexOf('\n', from - 1) + 1;
  // Selecting up to the start of the next line should not format that next line.
  const last = to > from && source[to - 1] === '\n' ? to - 1 : to;
  const newline = source.indexOf('\n', last);
  const end = newline < 0 ? source.length : newline;
  const lines = source.slice(start, end).split('\n');
  const text = lines.map((line, index) => {
    if (heading || command === 'paragraph') {
      return (heading ? '#'.repeat(Number(heading[1])) + ' ' : '') + line.replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '');
    }
    if (command === 'quote') return '> ' + line;
    const content = line.replace(/^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
    if (command === 'ordered') return `${index + 1}. ${content}`;
    return (command === 'task' ? '- [ ] ' : '- ') + content;
  }).join('\n');
  return { from: start, to: end, text, start, end: start + text.length };
}

export function markdownLink(label: string, href: string): string {
  if (!safeLink(href)) throw new Error('Use an http, https, mailto, or /objects/UUID address.');
  const text = label.replace(/[\r\n]+/g, ' ').replace(/[\\[\]`*_{}()<>!#+\-.|~&]/g, '\\$&');
  // Angle destinations contain parentheses; literal angle brackets must be URL-encoded.
  const target = writingHref(href).replace(/</g, '%3C').replace(/>/g, '%3E');
  return `[${text}](<${target}>)`;
}

export function applyWritingEdit(textarea: HTMLTextAreaElement, edit: WritingEdit): boolean {
  if (!textarea.isConnected || textarea.disabled || textarea.readOnly || textarea.form?.dataset.busy === 'true') return false;
  const expected = textarea.value.slice(0, edit.from) + edit.text + textarea.value.slice(edit.to);
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);
  if (expected !== textarea.value) {
    // insertText is deprecated, but is the browser API that preserves textarea undo.
    // Do not fall back to value/setRangeText: those edits can destroy native history.
    if (typeof textarea.ownerDocument.execCommand !== 'function') return false;
    textarea.ownerDocument.execCommand('insertText', false, edit.text);
    if (textarea.value !== expected) return false;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.setSelectionRange(edit.start, edit.end);
  return true;
}

export function writingSelection(textarea: HTMLTextAreaElement, notice: (message: string) => void): WritingSelection {
  let start = textarea.selectionStart;
  let end = textarea.selectionEnd;
  let source = textarea.value;
  return {
    insert(title, href) {
      if (textarea.value !== source) {
        notice('Writing changed while choosing a link. Select the text and try again.');
        return false;
      }
      const text = markdownLink(title, href);
      if (!applyWritingEdit(textarea, { from: start, to: end, text, start: start + text.length, end: start + text.length })) {
        notice('Your browser could not insert the link with undo support. Edit the Markdown source directly.');
        return false;
      }
      start = end = textarea.selectionEnd;
      source = textarea.value;
      notice('');
      return true;
    },
    restore() {
      if (!textarea.isConnected) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
    },
  };
}
