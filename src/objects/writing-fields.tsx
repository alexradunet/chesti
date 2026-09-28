import { Button, Dialog, Field, Input, Select, Textarea } from '../ui/index.js';

// Fixed, decorative glyphs: never render model/user-supplied SVG.
const writingIcons = {
  bold: 'M6 4h7a4 4 0 0 1 0 8H6zm0 8h8a4 4 0 0 1 0 8H6z',
  italic: 'M10 4h10M4 20h10M15 4 9 20',
  strike: 'M17 6c-1-2-3-3-5-3-3 0-5 2-5 4s2 3 5 4M7 18c1 2 3 3 5 3 3 0 5-2 5-4 0-1-1-2-2-3M3 12h18',
  bullet: 'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',
  ordered: 'M10 6h11M10 12h11M10 18h11M3 3h1v5M2 8h4M2 13c0-3 4-3 4 0 0 2-4 3-4 6h4',
  task: 'm3 6 2 2 4-5M12 6h9M12 13h9M12 20h9M3 12h5v8H3z',
  quote: 'M4 5h6v7H4v-1c0 6 2 8 5 8M14 5h6v7h-6v-1c0 6 2 8 5 8',
  code: 'm8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  'code-block': 'M3 3h18v18H3zM3 7h18m-12 4-3 3 3 3m6-6 3 3-3 3',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  undo: 'M9 4 3 10l6 6M3 10h11a6 6 0 0 1 0 12',
  redo: 'm15 4 6 6-6 6m6-6H10a6 6 0 0 0 0 12',
  edit: 'm15 4 5 5M4 15 16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1z',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  object: 'M14 3H4v18h16V9zM14 3v6h6M8 15h8m-4-3v6',
} as const;

function WritingIcon({ name }: { name: keyof typeof writingIcons }) {
  return <svg class="writing-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={writingIcons[name]} /></svg>;
}

export function WritingFields({
  body,
  headingLevel = 2,
  textareaId = 'markdown-body',
  blockId = 'writing-block',
  linkHeadingId = 'writing-link-heading',
  rows = 14,
}: {
  body: string;
  headingLevel?: 2 | 3;
  textareaId?: string;
  blockId?: string;
  linkHeadingId?: string;
  rows?: number;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  const groups = [
    { label: 'Text formatting', commands: [['bold', 'Bold'], ['italic', 'Italic'], ['strike', 'Strikethrough']] },
    { label: 'Lists and quotes', commands: [['bullet', 'Bulleted list'], ['ordered', 'Numbered list'], ['task', 'Task list'], ['quote', 'Block quote']] },
    { label: 'Code and links', commands: [['code', 'Inline code'], ['code-block', 'Code block'], ['link', 'Link']] },
    { label: 'Edit history', commands: [['undo', 'Undo'], ['redo', 'Redo']] },
  ] as const;
  return <section class="writing" id="writing-area" tabindex={-1}>
    <div class="writing-heading">
      <Heading id="writing-heading">Writing</Heading>
      <div class="writing-modes" role="group" aria-label="Writing mode" data-writing-modes="" hidden>
        <Button type="button" variant="ghost" data-writing-edit="" aria-pressed="true" aria-controls={textareaId}><WritingIcon name="edit" />Edit</Button>
        <Button type="button" variant="ghost" data-writing-show-preview="" aria-pressed="false" aria-controls={`${textareaId}-preview`}><WritingIcon name="preview" />Preview</Button>
      </div>
    </div>
    <div class="writing-surface">
      <div class="writing-toolbar" role="group" aria-label="Writing formatting" data-writing-toolbar="" hidden>
        <Field class="sr-only" for={blockId} label="Paragraph style" />
        <Select id={blockId} data-writing-block="" aria-label="Paragraph style">
          <option value="">Text style</option>
          <option value="paragraph">Paragraph</option>
          {[1, 2, 3, 4, 5, 6].map(level => <option value={`heading-${level}`}>Heading {level}</option>)}
        </Select>
        {groups.map(group => <div class="writing-tool-group" role="group" aria-label={group.label}>
          {group.commands.map(([command, label]) => <Button
            type="button"
            variant="ghost"
            data-writing-command={command}
            aria-label={label}
            title={label}
          ><WritingIcon name={command} /></Button>)}
        </div>)}
      </div>
      <Field class="sr-only" for={textareaId} label="Writing Markdown source" />
      <Textarea id={textareaId} class="markdown-source" name="body" rows={rows} aria-describedby="markdown-help" spellcheck={true} placeholder="Start writing…" data-writing-source={JSON.stringify(body)}>{`\n${body}`}</Textarea>
      <div id={`${textareaId}-preview`} class="markdown-content writing-preview" data-writing-preview="" role="region" aria-label="Draft writing preview" tabindex={0} hidden></div>
      <div class="writing-footer">
        <Button class="js-only" type="button" variant="ghost" data-insert-object-link=""><WritingIcon name="object" />Insert object link</Button>
        <span class="fine" id="markdown-help">Markdown · Changes need saving</span>
      </div>
    </div>
    <details class="writing-help">
      <summary>Formatting guide</summary>
      <p class="fine">Write <code># Heading</code>, <code>**bold**</code>, <code>*italic*</code>, or <code>[label](url)</code>. Start a list with <code>- </code> or a task with <code>- [ ] </code>.</p>
      <p class="fine js-only">Select text, then choose a formatting button. Ctrl/Command+B or I adds bold or italic. Tab leaves the editor. Preview reads your draft without saving it.</p>
    </details>
    <p class="fine writing-status" data-writing-status="" role="status" hidden></p>
    <Dialog class="writing-link-dialog" data-writing-link-dialog="" aria-labelledby={linkHeadingId}>
      <h2 id={linkHeadingId}>Insert link</h2>
      <Field label="Link address"><Input data-writing-link-url="" type="text" inputmode="url" autocomplete="off" placeholder="https://example.com" /></Field>
      <p class="fine">Use https, http, mailto, or an object link. Selected text becomes the link label; edit existing links directly in Markdown.</p>
      <p data-writing-link-error="" role="alert"></p>
      <Button type="button" data-writing-link-apply="">Apply link</Button>{' '}
      <Button type="button" variant="ghost" data-writing-link-cancel="">Cancel</Button>
    </Dialog>
  </section>;
}
