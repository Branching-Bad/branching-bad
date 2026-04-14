import { createServer } from 'http';
import path from 'path';

import { Db } from './db/index.js';
// Import all DB modules to register prototype extensions
import './db/repos.js';
import './db/tasks.js';
import './db/taskSync.js';
import './db/plans.js';
import './db/planJobs.js';
import './db/runs.js';
import './db/agents.js';
import './provider/db.js';
import './provider/dbBindings.js';
import './provider/dbItems.js';
import './db/reviews.js';
import './db/chat.js';
import './db/autostart.js';
import './db/rules.js';
import './db/maintenance.js';
import './provider/cloudwatch/db.js';
import './provider/elasticsearch/db.js';
import './provider/elasticsearch/db-saved-queries.js';
import './provider/sonarqube/db.js';
import './db/taskOutputs.js';
import './db/memories.js';
import './db/glossary.js';
import './db/analyst.js';
import './db/workflow.js';
import './db/taskDefaults.js';

import { ProcessManager, recoverOrphans } from './processManager.js';
import { ProviderRegistry, registerAll } from './provider/index.js';
import { createApp } from './app.js';
import { spawnAutostartWorker } from './routes/autostart.js';
import { spawnProviderSyncWorker } from './provider/syncRoutes.js';
import { getAppDataDir } from './routes/shared.js';
import type { AppState } from './state.js';
import { attachWebSocketHandler } from './websocket.js';
import { WorkflowScheduler } from './workflow/scheduler.js';

function resolveDbPath(): string {
  return path.join(getAppDataDir(), 'agent.db');
}

async function main() {
  const dbPath = resolveDbPath();

  // Ensure parent directory exists
  const { mkdirSync } = await import('fs');
  const parentDir = path.dirname(dbPath);
  mkdirSync(parentDir, { recursive: true });

  // Initialize database
  const db = new Db(dbPath);
  db.init();

  // Recover orphans
  recoverOrphans(db);

  try { db.failStaleRunningPlanJobs(); } catch (e) {
    console.error('Warning: failed to recover stale plan jobs:', e);
  }
  try { db.resetStalePlanGeneratingTasks(); } catch (e) {
    console.error('Warning: failed to reset stale PLAN_GENERATING tasks:', e);
  }
  try { db.requeueStaleRunningAutostartJobs(); } catch (e) {
    console.error('Warning: failed to recover stale autostart jobs:', e);
  }
  try {
    const staleWorkflowRuns = db.listRunningWorkflowRuns();
    for (const r of staleWorkflowRuns) {
      db.updateWorkflowRunStatus(r.id, 'failed', new Date().toISOString());
    }
  } catch (e) {
    console.error('Warning: failed to recover stale workflow runs:', e);
  }

  // Create process manager
  const processManager = new ProcessManager();

  // Create provider registry
  const registry = new ProviderRegistry();
  registerAll(registry);

  // Build app state
  const state: AppState = {
    db,
    processManager,
    registry,
    setupJobs: new Map(),
  };

  // Initialize workflow cron scheduler
  const scheduler = new WorkflowScheduler(state);
  state.workflowScheduler = scheduler;
  scheduler.init();

  // Spawn background workers
  spawnAutostartWorker(state);
  spawnProviderSyncWorker(state);

  // Create Express app and HTTP server
  const app = createApp(state);
  const server = createServer(app);

  // Attach WebSocket upgrade handler
  attachWebSocketHandler(server, state);

  // Start server
  const port = parseInt(process.env.PORT || '4310', 10);

  server.listen(port, '127.0.0.1', () => {
    console.log(`Branching Bad server running on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
