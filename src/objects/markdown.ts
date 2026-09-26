import { AppError } from '../core.js';
import { objectLink, safeLink, writingHref } from './writing-links.js';

const options: Bun.markdown.Options = { noHtmlBlocks: true, noHtmlSpans: true };

export function validateMarkdown(input: unknown): string {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 262_144) {
    throw new AppError(422, 'Writing must be Markdown text no larger than 256 KiB.');
  }
  return input;
}


/** Only parsed links count: code examples, images and raw HTML never create backlinks. */
export function markdownReferences(body: string): string[] {
  const targets = new Set<string>();
  Bun.markdown.render(body, {
    link: (children, { href }) => {
      const match = objectLink.exec(href);
      if (match) targets.add(match[1]!.toLowerCase());
      return children;
    },
    image: () => '',
  }, options);
  return [...targets];
}

export function markdownText(body: string): string {
  return Bun.markdown.render(body, {
    heading: text => `${text}\n`,
    paragraph: text => `${text}\n`,
    listItem: text => `${text}\n`,
    code: text => `${text}\n`,
    th: text => `${text}\t`,
    td: text => `${text}\t`,
    tr: text => `${text}\n`,
    image: () => '',
  }, options).trimEnd();
}

/** Raw source HTML is disabled; rewrite only the HTML emitted by Bun's renderer. */
export function renderMarkdown(body: string): string {
  return new HTMLRewriter()
    .on('a', { element(link) {
      if (!safeLink(link.getAttribute('href'))) link.removeAndKeepContent();
      else {
        link.setAttribute('href', writingHref(link.getAttribute('href')!));
        link.setAttribute('rel', 'noreferrer');
      }
    } })
    .on('img', { element(image) {
      // Bun already HTML-escapes these attribute values. Reuse that escaped text
      // without decoding or double-escaping it; no image URL is fetched.
      const label = image.getAttribute('alt') || image.getAttribute('src') || '';
      image.replace(`<span class="document-image">[Image: ${label}]</span>`, { html: true });
    } })
    .transform(Bun.markdown.html(body, options));
}
