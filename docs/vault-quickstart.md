# SQLite apps and Markdown interchange

Taskdesk runs on Bun. SQLite is the only live authority; Markdown remains the format for journal/note bodies and portable app exports.

## Open Today

```sh
bun install --frozen-lockfile
bun start
```

Open **http://127.0.0.1:3000/**. Today reuses the browser's saved conversation. The original issue desk remains at `/issues/new`.

First startup creates `.data/taskdesk.sqlite` and imports `.data/vault` when present, otherwise the fictional `examples/life-vault`. Existing `.data/state.json` browser state and the vault's `.lifeapps/runtime.json` grants/receipts are imported once. Original files are not modified. No personal directory is discovered automatically.

To choose a different database and initial Markdown source:

```sh
DATABASE_PATH=/absolute/path/to/taskdesk.sqlite \
VAULT_ROOT=/absolute/path/to/vault \
PI_MODEL=openai-codex/gpt-5.5 bun start
```

`VAULT_ROOT` is only used when initializing app records. Once initialized, editing or removing the import directory does not change the database. A custom database still imports the repository's legacy browser state if present; use a separate checkout without `.data/state.json` for a completely fresh browser store.

1. Click **Approve all 4 apps** to enable the sample's Wiki, Tasks, Calendar and Journal permissions, including ordinary-note reading. Use **App review** for narrower grants. Approval binds exact displayed revisions; later changes require approval again.
2. Say **“Create a task to finish the homepage tomorrow.”** Demo supports this grammar without credentials. Select Pi for open-ended requests.
3. Open the task to schedule a timed session with an explicit timezone, or use **Set a date** on Today.
4. Complete it. **Link in journal** inserts a wiki link into a draft; **Save journal** commits it explicitly. Opening Today never creates a journal automatically.
5. Refresh or restart. Records, grants, receipts and conversation persist in SQLite. Native links/forms also work without JavaScript.

The agent can discover and update a journal without requiring the user to navigate to or select it first. Every action still requires a fresh direct inspection and the same server validation as browser forms.

## Import and export

Validate a Markdown source without writing or approving anything:

```sh
bun run lifeapps check examples/life-vault
bun scripts/lifeapps.ts check examples/life-vault --json
bun run lifeapps schema
```

The unmodified sample has **13 Markdown files, four valid definitions, no errors or warnings**.

Explicitly seed an empty app database:

```sh
bun run lifeapps import /path/to/vault --db /path/to/taskdesk.sqlite
```

Import fails closed on invalid/incomplete sources, unsafe links, or visible non-Markdown assets. It never silently skips an attachment. Hidden paths other than `.apps` are excluded; the legacy authority file is read separately. Subsequent import of the same root is a no-op; a different source cannot replace an initialized app database.

Export app definitions, records, approvals and runtime receipts to a **new** directory:

```sh
bun run lifeapps export /path/to/new-export --db .data/taskdesk.sqlite
bun run lifeapps check /path/to/new-export
```

Existing destinations are rejected, not merged or overwritten. Export does not include browser sandboxes, compositions, conversations or SDK history; back up the SQLite database for a complete backup.

## Change an app definition

Edit a copy of an exported `.apps/*.md` file, then explicitly install the revision:

```sh
bun run lifeapps definition /path/to/Tasks.md --path .apps/Tasks.md --db .data/taskdesk.sqlite
```

The runtime validates the new definition and retains revision history. Changed definitions revoke their grants. Review and approve the new revision in the browser before using it. Changing a type's schema version does not automatically migrate existing records; incompatible records are reported and cannot be mutated through their old actions.

## Backups and safety

Use one app server per database. App records and grants are shared across browser sessions; the local browser cookie isolates conversations and issue sandboxes, not app data. This is loopback-only, not a multi-user service.

Record mutations, runtime receipts and conversation receipts commit together. Stale revisions fail instead of overwriting changes. Source Markdown files are never a second live writer.

Use a SQLite-aware backup, or stop all database connections before copying the database and any remaining `-wal`/`-shm` sidecars. Do not copy only the main file while WAL writes are active. Keep the original Markdown/JSON inputs until you have verified your migration and backup. Restore a database only with the server stopped.

Run `bun run lifeapps --help` for command syntax. `check` exits **0** for valid input (warnings allowed), **1** for validation errors, and **2** for usage/internal failures. Interchange commands return **2** on failure. See [the app contract](app-definition-v1.md) for field, relationship, revision and approval rules.
