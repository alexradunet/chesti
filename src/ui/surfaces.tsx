import type { Child } from 'hono/jsx';
import type { JSX } from 'hono/jsx/jsx-runtime';

type PanelTag = 'section' | 'article' | 'aside' | 'div';
export function Panel({ as: Tag = 'section', class: className = '', children, ...attributes }: JSX.IntrinsicElements['section'] & { as?: PanelTag; children?: Child }) {
  return <Tag {...attributes} class={`parch panel ${className}`.trim()}>{children}</Tag>;
}

export function CardLink({ class: className = '', children, ...attributes }: JSX.IntrinsicElements['a'] & { href: string; children?: Child }) {
  return <a {...attributes} class={`parch card-link ${className}`.trim()}>{children}</a>;
}

export function Dialog({ class: className = '', children, ...attributes }: JSX.IntrinsicElements['dialog']) {
  return <dialog {...attributes} class={`parch ornate ${className}`.trim()}>{children}</dialog>;
}

export function Status({ message, error = false, class: className = '', ...attributes }: JSX.IntrinsicElements['p'] & { message?: string; error?: boolean }) {
  return <p {...attributes} class={`form-state${error ? ' error' : ''} ${className}`.trim()} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>{message}</p>;
}

export function Notice({ error = false, class: className = '', children, ...attributes }: JSX.IntrinsicElements['div'] & { error?: boolean; children?: Child }) {
  return <div {...attributes} class={`parch notice${error ? ' error' : ''} ${className}`.trim()} role={error ? 'alert' : 'status'}>{children}</div>;
}
