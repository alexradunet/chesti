// Only bundled design assets are public. Never turn a URL into an arbitrary disk path.
const names = [
  'crest.png', 'logo.png',
  ...['bell', 'check', 'flame', 'gem', 'hourglass', 'key', 'lens', 'orb', 'quill', 'rune_x', 'scroll', 'shield', 'tome'].map(name => `icons/${name}.png`),
  'fonts/jersey-15.ttf', 'fonts/piazzolla.ttf', 'fonts/silkscreen.woff2', 'fonts/jetbrains-mono.woff2',
];
export const designAssets = new Map(names.map(name => [
  `/balaur/${name}`,
  {
    file: Bun.file(new URL(`../../public/balaur/${name}`, import.meta.url)),
    type: name.endsWith('.png') ? 'image/png' : name.endsWith('.ttf') ? 'font/ttf' : 'font/woff2',
  },
]));
