import type { ProviderBindingRow } from './models.js';
import { Db, nowIso } from '../db/index.js';

declare module '../db/index.js' {
  interface Db {
    createProviderBinding(
      repoId: string,
      accountId: string,
      resourceId: string,
      providerId: string,
      configJson: string,
    ): ProviderBindingRow;
    updateBindingConfig(
      repoId: string,
      accountId: string,
      resourceId: string,
      configJson: string,
    ): void;
    getBindingConfig(repoId: string, accountId: string, resourceId: string): string | null;
    listProviderBindings(providerId: string): ProviderBindingRow[];
    listProviderBindingsForRepo(repoId: string): ProviderBindingRow[];
  }
}

const BINDING_COLS =
  'repo_id, provider_account_id, provider_resource_id, provider_id, config_json, created_at, updated_at';

Db.prototype.createProviderBinding = function (
  repoId: string,
  accountId: string,
  resourceId: string,
  providerId: string,
  configJson: string,
): ProviderBindingRow {
  const db = this.connect();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO provider_bindings (repo_id, provider_account_id, provider_resource_id, provider_id, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_id, provider_account_id, provider_resource_id)
       DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
    ).run(repoId, accountId, resourceId, providerId, configJson, ts, ts);

    return {
      repo_id: repoId,
      provider_account_id: accountId,
      provider_resource_id: resourceId,
      provider_id: providerId,
      config_json: configJson,
      created_at: ts,
      updated_at: ts,
    };
};

Db.prototype.updateBindingConfig = function (
  repoId: string,
  accountId: string,
  resourceId: string,
  configJson: string,
): void {
  const db = this.connect();
    const result = db
      .prepare(
        'UPDATE provider_bindings SET config_json = ?, updated_at = ? WHERE repo_id = ? AND provider_account_id = ? AND provider_resource_id = ?',
      )
      .run(configJson, nowIso(), repoId, accountId, resourceId);
    if (result.changes === 0) {
      throw new Error('Binding not found');
    }
};

Db.prototype.getBindingConfig = function (
  repoId: string,
  accountId: string,
  resourceId: string,
): string | null {
  const db = this.connect();
    const row = db
      .prepare(
        'SELECT config_json FROM provider_bindings WHERE repo_id = ? AND provider_account_id = ? AND provider_resource_id = ?',
      )
      .get(repoId, accountId, resourceId) as { config_json: string } | undefined;
    return row?.config_json ?? null;
};

Db.prototype.listProviderBindings = function (providerId: string): ProviderBindingRow[] {
  const db = this.connect();
    return db
      .prepare(`SELECT ${BINDING_COLS} FROM provider_bindings WHERE provider_id = ?`)
      .all(providerId) as ProviderBindingRow[];
};

Db.prototype.listProviderBindingsForRepo = function (
  repoId: string,
): ProviderBindingRow[] {
  const db = this.connect();
    return db
      .prepare(`SELECT ${BINDING_COLS} FROM provider_bindings WHERE repo_id = ?`)
      .all(repoId) as ProviderBindingRow[];
};
