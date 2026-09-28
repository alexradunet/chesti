import type { Child } from 'hono/jsx';
import type { JSX } from 'hono/jsx/jsx-runtime';

// Closed asset vocabulary: decorative icons never carry an action's accessible name.
const icons = {
  plus: 'quill', search: 'lens', calendar: 'hourglass', tasks: 'scroll',
  objects: 'tome', views: 'orb', type: 'gem', settings: 'key', trash: 'rune_x',
  ai: 'orb', close: 'rune_x', pin: 'gem', page: 'scroll', journal: 'tome', reminder: 'bell', people: 'shield',
} as const;
const runes = { menu: '☰', arrow: '▸' } as const;
export type IconName = keyof typeof icons | keyof typeof runes;

export function Icon({ name }: { name: IconName }) {
  if (name === 'menu' || name === 'arrow') {
    return <span class="icon icon-rune" aria-hidden="true">{runes[name]}</span>;
  }
  return <img class="icon" src={`/balaur/icons/${icons[name]}.png`} width="20" height="20" alt="" aria-hidden="true" decoding="async" />;
}

export function Brand() {
  return <a class="brand" href="/"><img class="brand-mark" src="/balaur/crest.png" width="36" height="36" alt="" />Taskdesk</a>;
}

type ActionStyle = {
  variant?: 'primary' | 'secondary' | 'wood' | 'ghost' | 'danger';
  class?: string;
  children?: Child;
};

// Native semantics and arbitrary aria/data attributes survive every atom.
export function Button({ variant = 'secondary', class: className = '', children, type = 'button', ...attributes }: JSX.IntrinsicElements['button'] & ActionStyle) {
  return <button {...attributes} type={type} class={`button button-${variant} ${className}`.trim()}>{children}</button>;
}

export function ButtonLink({ variant = 'secondary', class: className = '', children, ...attributes }: JSX.IntrinsicElements['a'] & ActionStyle & { href: string }) {
  return <a {...attributes} class={`button button-${variant} ${className}`.trim()}>{children}</a>;
}

export function Badge({ tone = 'neutral', class: className = '', children, ...attributes }: JSX.IntrinsicElements['span'] & { tone?: 'neutral' | 'success' | 'warning'; children?: Child }) {
  return <span {...attributes} class={`tag tag-${tone} ${className}`.trim()}>{children}</span>;
}
