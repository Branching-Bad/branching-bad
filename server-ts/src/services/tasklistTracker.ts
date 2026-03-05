/**
 * Polls the tasklist.json file in .branching-bad/<issueKey>/
 * for status changes and pushes progress updates.
 */

import fs from 'fs';
import type { Db } from '../db/index.js';
import type { MsgStore } from '../msgStore.js';

const POLL_MS = 5000;

interface TasklistTask {
  id: string;
  status?: string;
  [key: string]: unknown;
}

interface TasklistPhase {
  tasks?: TasklistTask[];
  [key: string]: unknown;
}

interface TasklistJson {
  phases?: TasklistPhase[];
  [key: string]: unknown;
}

/**
 * Read task statuses from a tasklist.json file.
 */
function readTaskStatuses(filePath: string): Record<string, string> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: TasklistJson = JSON.parse(raw);
    const statuses: Record<string, string> = {};
    for (const phase of parsed.phases ?? []) {
      for (const task of phase.tasks ?? []) {
        if (task.id) statuses[task.id] = task.status ?? 'pending';
      }
    }
    return statuses;
  } catch {
    return null;
  }
}

/**
 * Start polling the tasklist.json file for progress updates.
 * Returns a cleanup function to stop polling.
 */
export function startTasklistPoller(
  runId: string,
  tasklistPath: string,
  db: Db,
  store: MsgStore | undefined,
): () => void {
  let lastSnapshot: Record<string, string> = {};
  let stopped = false;

  // Read initial state
  const initial = readTaskStatuses(tasklistPath);
  if (initial) lastSnapshot = { ...initial };

  const timer = setInterval(() => {
    if (stopped) return;

    const current = readTaskStatuses(tasklistPath);
    if (!current) return;

    // Diff against last known state
    const changes: Array<{ id: string; status: string }> = [];
    for (const [id, status] of Object.entries(current)) {
      if (lastSnapshot[id] !== status) {
        changes.push({ id, status });
        lastSnapshot[id] = status;
      }
    }

    if (changes.length === 0) return;

    // Push event to DB
    try {
      db.addRunEvent(runId, 'tasklist_progress', {
        changes,
        snapshot: current,
      });
    } catch {
      // Ignore DB errors
    }

    // Push to live stream
    if (store) {
      store.push({
        type: 'agent_text',
        data: changes.map((c) => `[tasklist] ${c.id}: ${c.status}`).join('\n'),
      });
    }
  }, POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
