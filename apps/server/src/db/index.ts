import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/** `apps/server/drizzle`, next to this module whether it runs from `src` or `dist`. */
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Opens (or creates) the SQLite file and applies pending migrations. `':memory:'` for tests. */
export function openDatabase(path: string): AppDatabase {
  const client = new Database(path);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  const db = drizzle({ client, schema });
  migrate(db, { migrationsFolder });
  return db;
}
