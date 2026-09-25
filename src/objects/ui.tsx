import type { Child } from 'hono/jsx';
import type { JSX } from 'hono/jsx/jsx-runtime';

const iconPaths = {
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  calendar: 'M8 3v4M16 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1M8 14h2M14 14h2M8 17h2',
  tasks: 'M9 6h11M9 12h11M9 18h11M3 6l1 1 2-3M3 12l1 1 2-3M3 18l1 1 2-3',
  objects: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  views: 'M3 5h18v14H3zM3 10h18M9 10v9',
  type: 'M12 3l9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  ai: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  pin: 'M9 3h6l-1 7 4 4H6l4-4zM12 14v7',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  page: 'M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6',
  journal: 'M5 4h14v17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M7 4v17M10 8h6M10 12h4',
  reminder: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
} as const;

export type IconName = keyof typeof iconPaths;

export function Icon({ name }: { name: IconName }) {
  return <svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={iconPaths[name]} /></svg>;
}

type ActionStyle = { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; class?: string; children?: Child };

// Keep native elements and attributes: links navigate; buttons perform actions.
export function Button({ variant = 'secondary', class: className = '', children, type = 'button', ...attributes }: JSX.IntrinsicElements['button'] & ActionStyle) {
  return <button {...attributes} type={type} class={`button button-${variant} ${className}`.trim()}>{children}</button>;
}

export function ButtonLink({ variant = 'secondary', class: className = '', children, ...attributes }: JSX.IntrinsicElements['a'] & ActionStyle & { href: string }) {
  return <a {...attributes} class={`button button-${variant} ${className}`.trim()}>{children}</a>;
}

export function Badge({ tone = 'neutral', children, ...attributes }: JSX.IntrinsicElements['span'] & { tone?: 'neutral' | 'success' | 'warning'; children?: Child }) {
  return <span {...attributes} class={`tag tag-${tone}`}>{children}</span>;
}

export function PageHeading({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: Child; children?: Child }) {
  return <div class="page-heading">
    <div>
      {eyebrow && <span class="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {description && <p class="muted">{description}</p>}
    </div>
    {children && <div class="heading-actions">{children}</div>}
  </div>;
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: Child }) {
  return <div class="empty">
    <span class="empty-icon"><Icon name={icon} /></span>
    <h3>{title}</h3>
    {children}
  </div>;
}
