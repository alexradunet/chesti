import type { Child } from 'hono/jsx';
import type { JSX } from 'hono/jsx/jsx-runtime';

// Fields retain native labels, validation, form submission, and no-JS behavior.
// For an external label, use Field's `for` with the control's `id`.
export function Field({ label, children, class: className = '', ...attributes }: JSX.IntrinsicElements['label'] & { label?: Child; children?: Child }) {
  return <label {...attributes} class={`field ${className}`.trim()}>{label}{children}</label>;
}

export function Input({ class: className = '', ...attributes }: JSX.IntrinsicElements['input']) {
  return <input {...attributes} class={`input ${className}`.trim()} />;
}

export function Select({ children, class: className = '', ...attributes }: JSX.IntrinsicElements['select']) {
  return <select {...attributes} class={`select ${className}`.trim()}>{children}</select>;
}

export function Textarea({ children, class: className = '', ...attributes }: JSX.IntrinsicElements['textarea']) {
  // Callers supply the leading newline needed for HTML's textarea newline stripping.
  // Do not normalize source: Markdown and rejected drafts must round-trip exactly.
  return <textarea {...attributes} class={`textarea ${className}`.trim()}>{children}</textarea>;
}
