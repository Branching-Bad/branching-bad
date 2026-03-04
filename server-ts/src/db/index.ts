import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function nowIso(): string {
  return new Date().toISOString();
}

export class Db {
  path: string;
  private _db: Database.Database | null = null;

  constructor(dbPath: string) {
    this.path = dbPath;
  }

  connect(): Database.Database {
    if (!this._db) {
      const db = new Database(this.path);
      db.pragma('foreign_keys = ON');
      db.pragma('journal_mode = WAL');
      this._db = db;
    }
    return this._db;
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  init(): void {
    const db = this.connect();
    db.exec(`
      CREATE TABLE IF NOT EXISTS refinery_schema_history (
        version INTEGER PRIMARY KEY,
        name TEXT,
        applied_on TEXT,
        checksum TEXT
      )
    `);

    const applied = db
      .prepare('SELECT version FROM refinery_schema_history')
      .all()
      .map((row: any) => row.version as number);
    const appliedSet = new Set(applied);

    const migrationsDir = path.resolve(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const match = file.match(/^V(\d+)__(.+)\.sql$/);
      if (!match) continue;
      const version = parseInt(match[1], 10);
      const name = match[2];

      if (appliedSet.has(version)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      db.exec(sql);
      db.prepare(
        'INSERT INTO refinery_schema_history (version, name, applied_on, checksum) VALUES (?, ?, ?, ?)',
      ).run(version, name, nowIso(), '');
    }
  }

  dbPathString(): string {
    return this.path;
  }
}
