import { Badge, Brand, Button, ButtonLink, CardLink, Dialog, EmptyState, Field, Icon, Input, Notice, PageHeading, Panel, Select, Status, Textarea } from './index.js';
import { Document } from './document.js';

// The examples use the same native components as the app, not copied demo markup.
export function renderDesignSystem(): string {
  return '<!doctype html>' + <Document title="Design system">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="wood workspace-header"><Brand /><ButtonLink variant="wood" href="/">Back to workspace</ButtonLink></header>
    <main id="main" tabindex={-1}>
      <PageHeading eyebrow="Balaur / Basm · Hearthwood" title="Taskdesk UI" description="Oak chrome. Parchment content. Native, reusable controls. This page is a component reference; example controls do not save workspace data." />
      <Panel>
        <h2>Actions and status</h2>
        <div class="heading-actions">
          <Button variant="primary"><Icon name="plus" />Primary action</Button>
          <Button>Secondary</Button><Button variant="wood">Wood</Button>
          <Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button>
          <Button disabled>Disabled</Button><Button aria-pressed="true">Pressed</Button>
          <ButtonLink href="#fields">Navigate to fields</ButtonLink>
        </div>
        <p><Badge>Neutral</Badge>{' '}<Badge tone="success">Published</Badge>{' '}<Badge tone="warning">Draft</Badge></p>
        <Status message="Saved revision 3." />
        <Status error message="The draft is preserved. Review the validation error before saving." />
      </Panel>
      <div class="two-columns" id="fields">
        <Panel>
          <h2>Native fields</h2>
          <Field label="Title"><Input name="example-title" placeholder="A thought worth keeping" /></Field>
          <Field label="Type"><Select name="example-type"><option>Page</option><option>Task</option></Select></Field>
          <Field label="Writing"><Textarea rows={3}>{'\nMarkdown stays the source of truth.'}</Textarea></Field>
          <Field class="check"><Input type="checkbox" />Completed</Field>
          <Field label="Date"><Input type="date" /></Field>
          <Field label="Disabled"><Input value="Read-only example" disabled /></Field>
          <Field label="Invalid"><Input aria-invalid="true" aria-describedby="example-error" value="not a number" /></Field>
          <p id="example-error" class="error">Enter a number.</p>
        </Panel>
        <Panel>
          <h2>Content and feedback</h2>
          <p>Body copy uses Piazzolla. Headings use Jersey 15; functional small text uses JetBrains Mono. Silkscreen is reserved for the nameplate.</p>
          <Notice>Nothing is saved until you explicitly submit.</Notice>
          <Notice error>This revision is stale. Your writing is still here.</Notice>
          <CardLink class="object-card" href="/objects/new">
            <div class="object-card-heading"><Icon name="page" /><strong>A reusable linked card</strong></div>
            <p class="object-card-excerpt">Links navigate. Buttons act. Native controls retain keyboard and no-JavaScript behavior.</p>
          </CardLink>
        </Panel>
      </div>
      <EmptyState icon="objects" title="Nothing on the shelf yet"><p>Start with a page, then add structure when you need it.</p><ButtonLink href="/objects/new">New page</ButtonLink></EmptyState>
      <Panel>
        <h2>Dialog surface</h2>
        <p>This is an inline, nonmodal specimen. Search and writing dialogs in the workspace use native modal focus and Escape handling.</p>
        <Dialog open class="specimen-dialog" aria-labelledby="specimen-dialog-title">
          <h3 id="specimen-dialog-title">Review before saving</h3><p>Parchment with a restrained gold frame.</p>
        </Dialog>
      </Panel>
      <p class="fine">Follows your system color preference. Use Tab to inspect focus, and your system’s reduced-motion setting to disable press movement.</p>
    </main>
  </Document>;
}

export function renderFailure(status: number, message: string): string {
  return '<!doctype html>' + <Document title={String(status)}>
    <main><PageHeading title={String(status)} description="Taskdesk could not complete this request." />
      <Panel><p>{message}</p><ButtonLink href="/">Return to Taskdesk</ButtonLink></Panel>
    </main>
  </Document>;
}
