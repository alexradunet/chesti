import { Database } from 'bun:sqlite';

type Capability = {
  available: boolean;
  detail: string;
  error?: string;
};

type RuntimeReport = {
  bunVersion: string;
  sqlite: {
    version: string;
    sourceId: string;
    compileOptions: string[];
  };
  capabilities: Record<string, Capability>;
};

function failUsage(): never {
  console.error('Usage: bun run sqlite:runtime');
  process.exit(64);
}

function probe(db: Database, detail: string, action: () => void): Capability {
  try {
    action();
    return { available: true, detail };
  } catch (error) {
    return {
      available: false,
      detail,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function scalar<T>(db: Database, sql: string): T {
  const row = db.query<Record<string, T>, []>(sql).get();
  if (!row) {
    throw new Error(`No result for ${sql}`);
  }
  return Object.values(row)[0] as T;
}

export function inspectSQLiteRuntime(): RuntimeReport {
  const db = new Database(':memory:');
  try {
    const version = scalar<string>(db, 'SELECT sqlite_version() AS value');
    const sourceId = scalar<string>(db, 'SELECT sqlite_source_id() AS value');
    const compileOptions = db
      .query<{ compile_options: string }, []>('PRAGMA compile_options')
      .all()
      .map(row => row.compile_options)
      .sort();

    const capabilities: RuntimeReport['capabilities'] = {
      jsonFunctions: probe(db, 'json(), json_extract(), and json_valid() execute against in-memory values', () => {
        const result = db
          .query<{ value: string | number }, []>("SELECT json_extract(json('{\"ok\":true}'), '$.ok') AS value WHERE json_valid('{\"ok\":true}')")
          .get();
        if (result?.value !== '1' && result?.value !== 1) {
          throw new Error(`Unexpected JSON result ${JSON.stringify(result)}`);
        }
      }),
      jsonbFunctions: probe(db, 'jsonb() executes against an in-memory value', () => {
        const result = db.query<{ value: string }, []>("SELECT typeof(jsonb('{\"ok\":true}')) AS value").get();
        if (result?.value !== 'blob') {
          throw new Error(`Unexpected JSONB result ${JSON.stringify(result)}`);
        }
      }),
      fts5TempTable: probe(db, 'TEMP FTS5 virtual table can be created and queried in memory', () => {
        db.exec("CREATE VIRTUAL TABLE temp.runtime_fts USING fts5(body); INSERT INTO runtime_fts(body) VALUES ('hello sqlite');");
        const result = db.query<{ value: number }, []>("SELECT count(*) AS value FROM runtime_fts WHERE runtime_fts MATCH 'sqlite'").get();
        if (result?.value !== 1) {
          throw new Error(`Unexpected FTS5 result ${JSON.stringify(result)}`);
        }
      }),
      dbstatVirtualTable: probe(db, 'dbstat virtual table can be queried for the in-memory main schema', () => {
        db.exec('CREATE TABLE runtime_dbstat_probe(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO runtime_dbstat_probe(value) VALUES (\'one\');');
        const result = db.query<{ value: number }, []>("SELECT count(*) AS value FROM dbstat WHERE name = 'runtime_dbstat_probe'").get();
        if (typeof result?.value !== 'number') {
          throw new Error(`Unexpected dbstat result ${JSON.stringify(result)}`);
        }
      }),
      alterTableAddColumnCheck: probe(db, 'ALTER TABLE ADD COLUMN with a CHECK constraint is accepted', () => {
        db.exec('CREATE TABLE runtime_add_column_check(id INTEGER PRIMARY KEY); ALTER TABLE runtime_add_column_check ADD COLUMN value INTEGER CHECK (value > 0);');
      }),
      alterTableAddCheckConstraintSyntax: probe(db, 'direct ALTER TABLE ADD CHECK syntax is accepted', () => {
        db.exec('CREATE TABLE runtime_add_check(id INTEGER PRIMARY KEY, value INTEGER); ALTER TABLE runtime_add_check ADD CHECK (value > 0);');
      }),
      alterTableSetNotNullSyntax: probe(db, 'direct ALTER TABLE ALTER COLUMN SET NOT NULL syntax is accepted', () => {
        db.exec('CREATE TABLE runtime_set_not_null(value TEXT); ALTER TABLE runtime_set_not_null ALTER COLUMN value SET NOT NULL;');
      }),
    };

    return {
      bunVersion: Bun.version,
      sqlite: { version, sourceId, compileOptions },
      capabilities,
    };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  if (Bun.argv.length > 2) {
    failUsage();
  }
  console.log(JSON.stringify(inspectSQLiteRuntime(), null, 2));
}
