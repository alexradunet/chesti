# Taskdesk UI — Balaur / Basm Hearthwood

Taskdesk uses the supplied **Balaur Hearthwood** visual system without importing the Balaur demo application. Objects, views, native forms, Markdown, and the isolated view generator retain their existing contracts. The integration adds no UI framework, runtime CDN, or dependency.

Open **`/design-system`** (also linked from the footer) for a reference rendered with the actual production components. Example controls there do not save data.

## Layers and ownership

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Foundations | `public/tokens.css` | Palette, self-hosted fonts, spacing, type, material roles, bevels, motion |
| Atoms | `src/ui/atoms.tsx`, `fields.tsx` | Icons, brand, buttons, links, badges, native fields |
| Surfaces / feedback | `src/ui/surfaces.tsx` | Panels, linked cards, native dialogs, notices, live status |
| Compositions | `src/ui/compositions.tsx` | Page heading and empty state |
| Document | `src/ui/document.tsx` | Common metadata, same-origin styles, optional writing styles |
| Native component CSS | `public/ui.css` | Materials, controls, states, focus, reduced motion |
| Domain screens | `src/objects/render.tsx`, `writing-fields.tsx` | Taskdesk forms and trusted view rendering |
| Domain layout | `public/objects.css`, `writing.css` | Workspace, responsive drawers, browse layouts, views, writing |
| Local assets | `public/balaur/`, `src/ui/assets.ts` | Explicitly allowlisted artwork and fonts |

Import reusable components from `src/ui/index.ts`. UI components have no dependency on the object model, database, provider, or browser state. Domain validation and mutation stay outside them. Small related atoms share files; there is no file-per-element hierarchy or component registry.

## Materials and typography

- **Oak page:** dark study / daylight study selected by the system color preference. No new preference store or theme switch.
- **Wood chrome:** `.wood`, plank grain, raised bevel, gold and parchment-colored text. Navigation, workspace header, assistant ledge, and editor toolbar.
- **Parchment content:** `.parch` (also owned by `Panel`, `Notice`, and `EmptyState`), ink-colored text, dither, two-pixel edge, hard drop. Cards, objects, journals, lists, tables, and dialogs.
- **Inset wells:** `--bevel-in` for pressed/current chrome controls.
- **Type:** Jersey 15 for headings at 20px and above; Piazzolla for readable 17px body copy; JetBrains Mono for functional small text and code; Silkscreen only for the Taskdesk nameplate.
- **Shape and motion:** square corners, hard shadows, 80ms presses. Reduced motion removes movement and transitions. No blur, soft shadow, or remote font fetching.

Materials rebind semantic roles (`--text-primary`, `--text-muted`, `--action-primary`, `--focus-ring`, status colors) at their boundary. Parchment nested inside wood must still use ink. Use the roles, rather than setting individual colors on a screen. Small text and status ink are contrast-adjusted from the source's decorative colors.

Keep ornament restrained: stitch dividers, a small card notch, or a dialog frame. Never stack all motifs on every surface. Status must have a text label, not just a color.

## Component examples

```tsx
import { Button, ButtonLink, Field, Input, Panel, Status } from '../ui/index.js';

<Panel aria-labelledby="details-heading">
  <h2 id="details-heading">Details</h2>
  <form method="post" action="/your-existing-domain-command">
    {/* Include the existing CSRF and revision fields. */}
    <Field label="Title">
      <Input name="title" required maxlength={500} aria-describedby="title-help" />
    </Field>
    <p id="title-help" class="fine">A name you can find again.</p>
    <Button type="submit" variant="primary">Save changes</Button>
    <ButtonLink href="/">Back to objects</ButtonLink>
    <Status message="Unsaved changes" data-form-state="" />
  </form>
</Panel>
```

- `Button` defaults to `type="button"`. Submit actions opt in. Variants: `primary`, `secondary`, `wood`, `ghost`, `danger`. Icon-only actions must supply an accessible label.
- `ButtonLink` / `CardLink` navigate and require `href`. Do not turn them into action buttons or invent disabled anchors.
- `Field` is a native label. Nest its control, or pair `for` and `id`. `Input`, `Select`, and `Textarea` forward native validation, form, ARIA, and data attributes. Keep help IDs and `aria-describedby` explicit.
- `Textarea` does not normalize Markdown or drafts. Server-rendered textarea callers retain the leading newline that compensates for HTML's first-newline stripping.
- `Panel` is a parchment section; `as="article"`, `"aside"`, or `"div"` preserves the needed semantics. Use `CardLink` for a wholly navigable card, never nest buttons inside an anchor.
- `Dialog` is the native `<dialog>`. Existing browser controllers own `showModal()`, focus restoration, and Escape. The component adds no competing interaction runtime.
- `Status` renders a polite status or assertive error. `Notice` is a page-level message. Preserve existing `data-*` hooks so errors and unsaved drafts remain attached to the right form.
- `Icon` uses the closed local PNG vocabulary or a typographic rune; images are decorative and pixelated. Use text for the action name. Unknown user content must never become an icon URL.

Native element CSS also covers controls created by browser code (search results, Milkdown), so they do not require a second component framework. Dynamic assistant messages use the same `.parch` material. Domain-specific property binding and generated view decisions remain in the trusted renderers, not in the generic UI layer.

## Source and intentional adaptation

Source: the user-supplied `Downloads/Balaur` export, especially `_ds/balaur-basm-design-system-0c1b20fd-0bf4-4b2c-bbd1-bfa417af0a6b/tokens/`, `basm/`, and `assets/`. Font selection follows the actual typography CSS (Jersey 15 / Piazzolla), not the older README's Pixelify / Work Sans description. Art and four font files are copied locally; no downloads are required at runtime. The export supplied no separate license files; this note records provenance, not new licensing terms.

Taskdesk retains its name and honest operational labels. The design export's companion personas, avatar picker, memory approval, dialogue-choice workflows, and other Balaur-only features are not Taskdesk features and are not imported. Unused avatars and the React demo bundle are not shipped.

Only fixed assets in `src/ui/assets.ts` are served. CSP permits same-origin fonts and images but no remote images, inline scripts, or inline styles. This does **not** enable user Markdown images or HTML; they remain inert.

## Verification when extending

Run `bun run check` and `bun test`. `test/ui.test.ts` covers native semantics and escaping; HTTP tests cover local assets, CSP, data preservation, and domain form behavior. Use Orca's browser to check desktop and narrow layouts, both color schemes, keyboard focus, disabled/pressed/error states, search and dialogs, and writing/assistant draft retention. Use an in-memory or explicitly temporary database, never the live `.data` workspace. Provider calls are not required for visual verification.
