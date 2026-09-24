import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { parseMarkdown, type MarkdownFile } from './markdown.js';
import type { AppCandidate } from './definition.js';
import type { VaultDocument } from './records.js';
import { snapshotFromFiles, type VaultSnapshot } from './reader.js';

export function initializeVault(db: Database): void {
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS vault_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
    const version = db.query<{ value: string }, []>("SELECT value FROM vault_metadata WHERE key = 'schema_version'").get();
    if (version && version.value !== '1') throw new Error('Unsupported app database schema.');
    db.query("INSERT INTO vault_metadata(key, value) VALUES ('schema_version', '1') ON CONFLICT(key) DO NOTHING").run();
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_apps (
      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, current_revision TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vault_app_revisions (
      app_id TEXT NOT NULL REFERENCES vault_apps(id), revision TEXT NOT NULL,
      definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
      body TEXT NOT NULL, source TEXT NOT NULL,
      PRIMARY KEY(app_id, revision)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vault_approvals (
      app_id TEXT PRIMARY KEY, path TEXT NOT NULL, revision TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vault_grants (
      app_id TEXT NOT NULL REFERENCES vault_approvals(app_id) ON DELETE CASCADE,
      permission TEXT NOT NULL, PRIMARY KEY(app_id, permission)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vault_records (
      id TEXT PRIMARY KEY COLLATE NOCASE, path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('note', 'record')),
      type TEXT, schema_version INTEGER,
      fields_json TEXT NOT NULL CHECK(json_valid(fields_json)),
      title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL, revision TEXT NOT NULL,
      CHECK((kind = 'note' AND type IS NULL AND schema_version IS NULL) OR
        (kind = 'record' AND type IS NOT NULL AND schema_version IS NOT NULL))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS vault_records_type ON vault_records(type);
    CREATE TABLE IF NOT EXISTS vault_relationships (
      source_id TEXT NOT NULL COLLATE NOCASE REFERENCES vault_records(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      target_id TEXT NOT NULL COLLATE NOCASE REFERENCES vault_records(id),
      PRIMARY KEY(source_id, field)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS vault_relationships_target ON vault_relationships(target_id);
    CREATE TABLE IF NOT EXISTS vault_receipts (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('applied', 'failed')), message TEXT NOT NULL,
      resource TEXT, path TEXT, revision TEXT, error_status INTEGER
    ) STRICT;
  `);
  })();
}

interface DefinitionRow { path: string; revision: string; definition_json: string; body: string; source: string }
interface RecordRow { id: string; path: string; kind: 'note' | 'record'; type: string | null; schema_version: number | null; fields_json: string; title: string; body: string; source: string; revision: string }

/** Source is a formatting cache; schema, identity, custom fields and body have structured authority. */
export function loadSnapshot(db: Database, root: string): VaultSnapshot {
  const files: MarkdownFile[] = [];
  for (const row of db.query<DefinitionRow, []>(`SELECT a.path, r.revision, r.definition_json, r.body, r.source
    FROM vault_apps a JOIN vault_app_revisions r ON r.app_id = a.id AND r.revision = a.current_revision ORDER BY a.path`).all()) {
    const file = parseMarkdown(row.path, row.source);
    file.frontmatter = JSON.parse(row.definition_json) as Record<string, unknown>;
    file.body = row.body;
    file.revision = row.revision;
    files.push(file);
  }
  for (const row of db.query<RecordRow, []>('SELECT * FROM vault_records ORDER BY path').all()) {
    const file = parseMarkdown(row.path, row.source);
    file.frontmatter = JSON.parse(row.fields_json) as Record<string, unknown>;
    if (row.kind === 'record') file.frontmatter = { id: row.id, type: row.type, schema: row.schema_version, ...file.frontmatter };
    file.title = row.title;
    file.body = row.body;
    file.revision = row.revision;
    files.push(file);
  }
  return snapshotFromFiles(root, files);
}

export function saveDefinition(db: Database, app: AppCandidate): void {
  const definition = app.definition!;
  db.query(`INSERT INTO vault_apps(id, path, current_revision) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET path = excluded.path, current_revision = excluded.current_revision`).run(definition.id, app.file.path, app.file.revision);
  // Bind content as UTF-8 bytes and cast in SQLite: Bun 1.4.2 string binding
  // strips a leading BOM, which would corrupt imported content and revisions.
  db.query(`INSERT INTO vault_app_revisions(app_id, revision, definition_json, body, source) VALUES (?, ?, ?, CAST(? AS TEXT), CAST(? AS TEXT))
    ON CONFLICT(app_id, revision) DO NOTHING`).run(definition.id, app.file.revision, JSON.stringify(definition), Buffer.from(app.file.body), Buffer.from(app.file.source));
}

export function saveRecord(db: Database, document: VaultDocument): void {
  const file = document.file;
  const record = document.kind === 'record';
  const id = record ? String(file.frontmatter.id) : db.query<{ id: string }, [Uint8Array]>('SELECT id FROM vault_records WHERE path = CAST(? AS TEXT)').get(Buffer.from(file.path))?.id ?? randomUUID();
  const fields = { ...file.frontmatter };
  if (record) { delete fields.id; delete fields.type; delete fields.schema; }
  db.query(`INSERT INTO vault_records(id, path, kind, type, schema_version, fields_json, title, body, source, revision)
    VALUES (?, CAST(? AS TEXT), ?, ?, ?, ?, CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), ?)
    ON CONFLICT(id) DO UPDATE SET fields_json = excluded.fields_json, title = excluded.title,
      body = excluded.body, source = excluded.source, revision = excluded.revision`).run(
    id, Buffer.from(file.path), document.kind, record ? String(file.frontmatter.type) : null,
    record ? Number(file.frontmatter.schema) : null, JSON.stringify(fields), Buffer.from(file.title), Buffer.from(file.body), Buffer.from(file.source), file.revision,
  );
}

/** Keep reference edges relational even while a definition is pending approval. */
export function saveRelationships(db: Database, documents: VaultDocument[]): void {
  const remove = db.query('DELETE FROM vault_relationships WHERE source_id = ?');
  const insert = db.query("INSERT INTO vault_relationships(source_id, field, target_id) SELECT ?, ?, id FROM vault_records WHERE id = ? AND kind = 'record'");
  for (const document of documents) {
    if (document.kind !== 'record') continue;
    const id = String(document.file.frontmatter.id);
    remove.run(id);
    for (const [name, field] of Object.entries(document.type?.fields ?? {})) {
      const target = document.file.frontmatter[name];
      if (field.type === 'reference' && typeof target === 'string') insert.run(id, name, target);
    }
  }
}
