import { v4 as uuidv4 } from 'uuid';
import type {
  ProviderAccountRow,
  ProviderResourceRow,
} from './models.js';
import { Db, nowIso } from '../db/index.js';

declare module '../db/index.js' {
  interface Db {
    upsertProviderAccount(
      providerId: string,
      config: any,
      displayName: string,
    ): ProviderAccountRow;
    listProviderAccounts(providerId: string): ProviderAccountRow[];
    getProviderAccount(id: string): ProviderAccountRow | null;
    deleteProviderAccount(id: string): void;
    upsertProviderResources(
      providerAccountId: string,
      providerId: string,
      resources: [string, string, string][],
    ): void;
    listProviderResources(providerAccountId: string): ProviderResourceRow[];
    getProviderResource(id: string): ProviderResourceRow | null;
  }
}

const ACCOUNT_COLS =
  'id, provider_id, config_json, display_name, created_at, updated_at';

const RESOURCE_COLS =
  'id, provider_account_id, provider_id, external_id, name, extra_json, created_at, updated_at';

Db.prototype.upsertProviderAccount = function (
  providerId: string,
  config: any,
  displayName: string,
): ProviderAccountRow {
  const db = this.connect();
    const configJson = JSON.stringify(config);
    const ts = nowIso();

    const existing = db
      .prepare(
        'SELECT id FROM provider_accounts WHERE provider_id = ? AND display_name = ?',
      )
      .get(providerId, displayName) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        'UPDATE provider_accounts SET config_json = ?, updated_at = ? WHERE id = ?',
      ).run(configJson, ts, existing.id);
      return db
        .prepare(`SELECT ${ACCOUNT_COLS} FROM provider_accounts WHERE id = ?`)
        .get(existing.id) as ProviderAccountRow;
    }

    const id = uuidv4();
    db.prepare(
      'INSERT INTO provider_accounts (id, provider_id, config_json, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, providerId, configJson, displayName, ts, ts);
    return db
      .prepare(`SELECT ${ACCOUNT_COLS} FROM provider_accounts WHERE id = ?`)
      .get(id) as ProviderAccountRow;
};

Db.prototype.listProviderAccounts = function (providerId: string): ProviderAccountRow[] {
  const db = this.connect();
    return db
      .prepare(
        `SELECT ${ACCOUNT_COLS} FROM provider_accounts WHERE provider_id = ? ORDER BY updated_at DESC`,
      )
      .all(providerId) as ProviderAccountRow[];
};

Db.prototype.getProviderAccount = function (id: string): ProviderAccountRow | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${ACCOUNT_COLS} FROM provider_accounts WHERE id = ?`)
      .get(id) as ProviderAccountRow | undefined;
    return row ?? null;
};

Db.prototype.deleteProviderAccount = function (id: string): void {
  const db = this.connect();
    db.prepare('DELETE FROM provider_accounts WHERE id = ?').run(id);
};

Db.prototype.upsertProviderResources = function (
  providerAccountId: string,
  providerId: string,
  resources: [string, string, string][],
): void {
  const db = this.connect();
    const ts = nowIso();
    const tx = db.transaction(() => {
      for (const [externalId, name, extraJson] of resources) {
        const existing = db
          .prepare(
            'SELECT id FROM provider_resources WHERE provider_account_id = ? AND external_id = ?',
          )
          .get(providerAccountId, externalId) as { id: string } | undefined;

        const id = existing?.id ?? uuidv4();

        db.prepare(
          `INSERT INTO provider_resources (id, provider_account_id, provider_id, external_id, name, extra_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(provider_account_id, external_id)
           DO UPDATE SET name = excluded.name, extra_json = excluded.extra_json, updated_at = excluded.updated_at`,
        ).run(id, providerAccountId, providerId, externalId, name, extraJson, ts, ts);
      }
    });
    tx();
};

Db.prototype.listProviderResources = function (
  providerAccountId: string,
): ProviderResourceRow[] {
  const db = this.connect();
    return db
      .prepare(
        `SELECT ${RESOURCE_COLS} FROM provider_resources WHERE provider_account_id = ? ORDER BY name ASC`,
      )
      .all(providerAccountId) as ProviderResourceRow[];
};

Db.prototype.getProviderResource = function (id: string): ProviderResourceRow | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${RESOURCE_COLS} FROM provider_resources WHERE id = ?`)
      .get(id) as ProviderResourceRow | undefined;
    return row ?? null;
};
