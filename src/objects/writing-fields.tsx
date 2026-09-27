import { Button, Dialog, Field, Input, Select, Textarea } from '../ui/index.js';

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
  const commands = [
    ['bold', 'Bold'],
    ['italic', 'Italic'],
    ['strike', 'Strikethrough'],
    ['bullet', 'Bulleted list'],
    ['ordered', 'Numbered list'],
    ['quote', 'Block quote'],
    ['code', 'Inline code'],
    ['code-block', 'Code block'],
    ['link', 'Link'],
    ['undo', 'Undo'],
    ['redo', 'Redo'],
  ] as const;
  return <section class="writing" id="writing-area" tabindex={-1}>
    <div class="writing-heading">
      <Heading id="writing-heading">Writing</Heading>
      <Button class="js-only" type="button" data-insert-object-link="">Insert object link</Button>
    </div>
    <div class="wood writing-toolbar" role="toolbar" aria-label="Writing formatting" data-writing-toolbar="" hidden>
      <Field class="sr-only" for={blockId} label="Paragraph style" />
      <Select id={blockId} data-writing-block="" aria-label="Paragraph style">
        <option value="paragraph">Paragraph</option>
        {[1, 2, 3, 4, 5, 6].map(level => <option value={`heading-${level}`}>Heading {level}</option>)}
      </Select>
      {commands.map(([command, label]) => <Button type="button" variant="ghost" data-writing-command={command} aria-label={label} title={label}>{label}</Button>)}
    </div>
    <div data-writing-mount="" hidden></div>
    <Field class="sr-only" for={textareaId} label="Writing Markdown source" />
    <Textarea id={textareaId} class="markdown-source" name="body" rows={rows} aria-describedby="markdown-help" spellcheck={true} data-writing-source={JSON.stringify(body)}>{`\n${body}`}</Textarea>
    <p class="fine" id="markdown-help">Use # headings, **bold**, and [label](url). Changes need saving.</p>
    <p class="fine" data-writing-status="" role="status" hidden></p>
    <Dialog class="writing-link-dialog" data-writing-link-dialog="" aria-labelledby={linkHeadingId}>
      <h2 id={linkHeadingId}>Edit link</h2>
      <Field label="Link address"><Input data-writing-link-url="" type="text" inputmode="url" autocomplete="off" placeholder="https://example.com" /></Field>
      <p class="fine">Use https, http, mailto, or an object link. Leave empty to remove a link.</p>
      <p data-writing-link-error="" role="alert"></p>
      <Button type="button" data-writing-link-apply="">Apply link</Button>{' '}
      <Button type="button" variant="ghost" data-writing-link-cancel="">Cancel</Button>
    </Dialog>
  </section>;
}
