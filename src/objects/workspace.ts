import { openDatabase } from '../database.js';
import { ObjectRuntime } from './runtime.js';
import { seedDemo } from './demo.js';

/** Seed only the first application initialization, never an emptied workspace. */
export function openWorkspace(file: string): ObjectRuntime {
  const db = openDatabase(file);
  try {
    const objects = db.transaction(() => {
      const existing = db.query(`SELECT 1 FROM sqlite_schema
        WHERE type = 'table' AND name IN ('object_metadata', 'objects') LIMIT 1`).get();
      const objects = new ObjectRuntime(db);
      if (!existing) seedDemo(objects);
      return objects;
    }).immediate();
    db.exec('PRAGMA optimize=0x10002');
    return objects;
  } catch (error) {
    db.close();
    throw error;
  }
}
