import type { Child } from 'hono/jsx';
import { Icon, type IconName } from './atoms.js';

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
  return <div class="parch empty">
    <span class="empty-icon"><Icon name={icon} /></span>
    <h3>{title}</h3>
    {children}
  </div>;
}
