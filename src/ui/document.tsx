import type { Child } from 'hono/jsx';
import type { JSX } from 'hono/jsx/jsx-runtime';

export function Document({ title, writing = false, bodyAttributes = {}, children }: {
  title: string;
  writing?: boolean;
  bodyAttributes?: JSX.IntrinsicElements['body'];
  children?: Child;
}) {
  const { class: className = '', ...attributes } = bodyAttributes;
  return <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="dark light" />
      <title>{title} · Taskdesk</title>
      <link rel="icon" href="/balaur/logo.png" type="image/png" />
      <link rel="stylesheet" href="/tokens.css" />
      <link rel="stylesheet" href="/ui.css" />
      <link rel="stylesheet" href="/objects.css" />
      {writing && <link rel="stylesheet" href="/writing.css" />}
    </head>
    <body {...attributes} class={`object-shell ${className}`.trim()}>{children}</body>
  </html>;
}
