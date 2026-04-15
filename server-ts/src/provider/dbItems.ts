import type { ProviderItemRow } from './models.js';
import { Db, nowIso } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

declare module '../db/index.js' {
  interface Db {
    upsertProviderItems(
      providerAccountId: string,
      providerResourceId: string,
      providerId: string,
      items: [string, string, string][],
    ): number;
    listProviderItems(
      repoId: string,
      providerId: string,
      statusFilter?: string,
    ): ProviderItemRow[];
    getProviderItem(id: string): ProviderItemRow | null;
    updateProviderItemStatus(id: string, status: string): void;
    deleteProviderItemsForRepo(providerId: string, repoId: string): number;
    linkProviderItemToTask(itemId: string, taskId: string): void;
    countAllPendingProviderItems(): Map<string, number>;
    countPendingProviderItemsForRepo(repoId: string): Map<string, number>;
    getLastProviderSyncTime(
      providerAccountId: string,
      providerResourceId: string,
    ): string | null;
  }
}

const ITEM_COLS =
  'id, provider_account_id, provider_resource_id, provider_id, external_id, title, status, linked_task_id, data_json, created_at, updated_at';

Db.prototype.upsertProviderItems = function (
  providerAccountId: string,
  providerResourceId: string,
  providerId: string,
  items: [string, string, string][],
): number {
  const db = this.connect();
    const ts = nowIso();
    let upserted = 0;

    const tx = this.transaction(() => {
      for (const [externalId, title, dataJson] of items) {
        const existing = db
          .prepare(
            'SELECT id, status, linked_task_id FROM provider_items WHERE provider_account_id = ? AND external_id = ?',
          )
          .get(providerAccountId, externalId) as
          | { id: string; status: string; linked_task_id: string | null }
          | undefined;

        if (existing) {
          let newStatus = existing.status;
          if (existing.linked_task_id) {
            const taskRow = db
              .prepare('SELECT status FROM tasks WHERE id = ?')
              .get(existing.linked_task_id) as { status: string } | undefined;
            if (taskRow && (taskRow.status === 'DONE' || taskRow.status === 'done')) {
              newStatus = 'regression';
            }
          }

          db.prepare(
            'UPDATE provider_items SET title = ?, data_json = ?, status = ?, updated_at = ? WHERE id = ?',
          ).run(title, dataJson, newStatus, ts, existing.id);
        } else {
          const id = uuidv4();
          db.prepare(
            `INSERT INTO provider_items (
              id, provider_account_id, provider_resource_id, provider_id,
              external_id, title, status, linked_task_id, data_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`,
          ).run(
            id,
            providerAccountId,
            providerResourceId,
            providerId,
            externalId,
            title,
            dataJson,
            ts,
            ts,
          );
        }
        upserted += 1;
      }
    });
    tx();

    return upserted;
};

Db.prototype.listProviderItems = function (
  repoId: string,
  providerId: string,
  statusFilter?: string,
): ProviderItemRow[] {
  const db = this.connect();
    let sql: string;
    const params: any[] = [repoId, providerId];

    if (statusFilter) {
      sql = `SELECT pi.id, pi.provider_account_id, pi.provider_resource_id, pi.provider_id,
              pi.external_id, pi.title, pi.status, pi.linked_task_id, pi.data_json,
              pi.created_at, pi.updated_at
             FROM provider_items pi
             INNER JOIN provider_bindings pb
               ON pi.provider_account_id = pb.provider_account_id
               AND pi.provider_resource_id = pb.provider_resource_id
             WHERE pb.repo_id = ? AND pi.provider_id = ? AND pi.status = ?
             ORDER BY pi.updated_at DESC`;
      params.push(statusFilter);
    } else {
      sql = `SELECT pi.id, pi.provider_account_id, pi.provider_resource_id, pi.provider_id,
              pi.external_id, pi.title, pi.status, pi.linked_task_id, pi.data_json,
              pi.created_at, pi.updated_at
             FROM provider_items pi
             INNER JOIN provider_bindings pb
               ON pi.provider_account_id = pb.provider_account_id
               AND pi.provider_resource_id = pb.provider_resource_id
             WHERE pb.repo_id = ? AND pi.provider_id = ?
             ORDER BY pi.updated_at DESC`;
    }

    return db.prepare(sql).all(...params) as any[];
};

Db.prototype.getProviderItem = function (id: string): ProviderItemRow | null {
  const db = this.connect();
    const row = db
      .prepare(`SELECT ${ITEM_COLS} FROM provider_items WHERE id = ?`)
      .get(id) as any | undefined;
    return row ?? null;
};

Db.prototype.updateProviderItemStatus = function (id: string, status: string): void {
  const db = this.connect();
    db.prepare('UPDATE provider_items SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      nowIso(),
      id,
    );
};

Db.prototype.deleteProviderItemsForRepo = function (
  providerId: string,
  repoId: string,
): number {
  const db = this.connect();
    const result = db
      .prepare(
        `DELETE FROM provider_items
         WHERE provider_id = ?
           AND provider_resource_id IN (
             SELECT pr.id FROM provider_resources pr
             JOIN provider_bindings pb ON pb.provider_resource_id = pr.id
             WHERE pb.repo_id = ? AND pb.provider_id = ?
           )`,
      )
      .run(providerId, repoId, providerId);
    return Number(result.changes);
};

Db.prototype.linkProviderItemToTask = function (itemId: string, taskId: string): void {
  const db = this.connect();
    db.prepare(
      "UPDATE provider_items SET linked_task_id = ?, status = 'accepted', updated_at = ? WHERE id = ?",
    ).run(taskId, nowIso(), itemId);
};

Db.prototype.countAllPendingProviderItems = function (): Map<string, number> {
  const db = this.connect();
    const rows = db
      .prepare(
        "SELECT provider_id, COUNT(*) as cnt FROM provider_items WHERE status IN ('pending', 'regression') GROUP BY provider_id",
      )
      .all() as any[];
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.provider_id, row.cnt);
    }
    return map;
};

Db.prototype.countPendingProviderItemsForRepo = function (
  repoId: string,
): Map<string, number> {
  const db = this.connect();
  const rows = db
    .prepare(
      `SELECT pi.provider_id, COUNT(*) as cnt
         FROM provider_items pi
         INNER JOIN provider_bindings pb
           ON pi.provider_account_id = pb.provider_account_id
           AND pi.provider_resource_id = pb.provider_resource_id
        WHERE pb.repo_id = ?
          AND pi.status IN ('pending', 'regression')
        GROUP BY pi.provider_id`,
    )
    .all(repoId) as any[];
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.provider_id, row.cnt);
  }
  return map;
};

Db.prototype.getLastProviderSyncTime = function (
  providerAccountId: string,
  providerResourceId: string,
): string | null {
  const db = this.connect();
    const row = db
      .prepare(
        'SELECT MAX(updated_at) as max_updated FROM provider_items WHERE provider_account_id = ? AND provider_resource_id = ?',
      )
      .get(providerAccountId, providerResourceId) as any | undefined;
    return row?.max_updated ?? null;
};
