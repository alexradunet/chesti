/** Writing links are deliberately narrower than general browser URLs. */
export const objectLink = /^\/objects\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

export function safeLink(href: unknown): href is string {
  return typeof href === 'string' && !/[\u0000-\u0020\u007f\\]/.test(href) &&
    (/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || objectLink.test(href));
}

export function writingHref(href: string): string {
  const target = objectLink.exec(href);
  return target ? `/objects/${target[1]!.toLowerCase()}` : href;
}
