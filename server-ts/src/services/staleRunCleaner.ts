import type { AppState } from '../state.js';

/**
 * Fail any "running" runs for a repo that have no live process in ProcessManager.
 * This handles orphaned runs left behind by crashes, restarts, or apply-to-main.
 */
export function cleanStaleRuns(state: AppState, repoId: string): void {
  const db = state.db.connect();
  const rows = db
    .prepare(
      `SELECT r.id FROM runs r
       JOIN tasks t ON t.id = r.task_id
       WHERE t.repo_id = ? AND r.status = 'running'`,
    )
    .all(repoId) as { id: string }[];

  for (const row of rows) {
    const store = state.processManager.getStore(row.id);
    if (!store) {
      // No live store → process is gone, mark as failed
      state.db.updateRunStatus(row.id, 'failed', true);
    }
  }
}
