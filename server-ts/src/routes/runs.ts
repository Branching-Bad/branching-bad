import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';

import { ApiError } from '../errors.js';
import { gitStatusInfo } from '../executor/index.js';
import { startRunInternal } from '../services/runService.js';
import type { AppState } from '../state.js';
import { streamSSEBatch, streamStoreAsSSE, waitForStoreSSE } from './sse.js';

export type { StartRunPayload, StartRunResult } from '../services/runService.js';
export { startRunInternal } from '../services/runService.js';
export { spawnResumeRun } from '../services/agentSpawner.js';

export function runRoutes(): Router {
  const router = Router();

  // POST /api/runs/start - start a run
  router.post('/api/runs/start', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const result = await startRunInternal(state, req.body);
      return res.status(202).json(result.response);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/runs/latest - get latest run for task
  router.get('/api/runs/latest', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.query.taskId as string;
      if (!taskId) {
        return ApiError.badRequest('taskId query parameter is required.').toResponse(res);
      }

      const run = state.db.getLatestRunByTask(taskId);
      if (run) {
        const events = state.db.listRunEvents(run.id);
        return res.json({ run, events });
      }
      return res.json({ run: null, events: [] });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/runs/:run_id - get run by id
  router.get('/api/runs/:run_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = req.params.run_id as string;
      const run = state.db.getRunById(runId);
      if (!run) {
        return ApiError.notFound('Run not found.').toResponse(res);
      }
      const events = state.db.listRunEvents(runId);
      return res.json({ run, events });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/runs/:run_id/ws - SSE stream for run logs
  router.get('/api/runs/:run_id/ws', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = req.params.run_id as string;
      const run = state.db.getRunById(runId);
      if (!run) {
        return ApiError.notFound('Run not found.').toResponse(res);
      }

      const store = state.processManager.getStore(runId);
      if (store) {
        return streamStoreAsSSE(res, store);
      }

      if (run.status === 'running') {
        return waitForStoreSSE(res, state, runId, false);
      }

      const events = state.db.listRunEvents(runId);
      const messages: string[] = events.map((e) =>
        JSON.stringify({
          type: 'db_event',
          data: JSON.stringify({ type: e.type, payload: e.payload }),
        }),
      );
      messages.push(
        JSON.stringify({
          type: 'finished',
          data: JSON.stringify({ exitCode: run.exit_code, status: run.status }),
        }),
      );

      return streamSSEBatch(res, messages);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/runs/:run_id/stop - stop running process
  router.post('/api/runs/:run_id/stop', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = req.params.run_id as string;
      const run = state.db.getRunById(runId);
      if (!run) {
        return ApiError.notFound('Run not found.').toResponse(res);
      }

      if (run.status !== 'running') {
        return ApiError.badRequest('Run is not currently running.').toResponse(res);
      }

      const killed = await state.processManager.killProcess(runId);
      if (!killed) {
        return ApiError.badRequest('No running process found for this run.').toResponse(res);
      }

      state.db.updateRunStatus(runId, 'cancelled', true);
      state.db.updateTaskStatus(run.task_id, 'CANCELLED');
      state.db.addRunEvent(runId, 'run_cancelled', { reason: 'user_requested' });

      const store = state.processManager.getStore(runId);
      if (store) {
        store.pushFinished(null, 'cancelled');
      }

      return res.json({ status: 'cancelled', run_id: runId });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/runs/:run_id/diff - get run diff
  router.get('/api/runs/:run_id/diff', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = req.params.run_id as string;
      const diff = state.db.getRunDiff(runId);
      return res.json({ diff: diff ?? '' });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/runs/:run_id/tasklist-progress — read live tasklist status
  router.get('/api/runs/:run_id/tasklist-progress', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = String(req.params.run_id);
      const run = state.db.getRunById(runId);
      if (!run) return ApiError.notFound('Run not found').toResponse(res);

      const task = state.db.getTaskById(run.task_id);
      if (!task) return ApiError.notFound('Task not found').toResponse(res);

      const repo = state.db.getRepoById(task.repo_id);
      if (!repo) return ApiError.notFound('Repo not found').toResponse(res);

      const workingDir = run.worktree_path ?? repo.path;
      // Try to find the tasklist.json in .branching-bad/<issueKey>/
      const issueKey = task.jira_issue_key || task.id;
      const filePath = path.join(workingDir, '.branching-bad', issueKey, 'tasklist.json');

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const tasks: Record<string, string> = {};
        for (const phase of parsed.phases ?? []) {
          for (const t of phase.tasks ?? []) {
            if (t.id) tasks[t.id] = t.status ?? 'pending';
          }
        }
        return res.json({ tasks });
      } catch {
        // File doesn't exist — check DB events as fallback
        const events = state.db.listRunEvents(runId);
        const progressEvent = [...events].reverse().find((e: any) => e.type === 'tasklist_progress');
        if (progressEvent?.payload?.snapshot) {
          return res.json({ tasks: (progressEvent.payload as any).snapshot });
        }
        return res.json({ tasks: {} });
      }
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/runs/:run_id/git-status - get git status info
  router.get('/api/runs/:run_id/git-status', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const runId = req.params.run_id as string;
      const run = state.db.getRunById(runId);
      if (!run) {
        return ApiError.notFound('Run not found').toResponse(res);
      }

      const task = state.db.getTaskById(run.task_id);
      if (!task) {
        return ApiError.notFound('Task not found').toResponse(res);
      }

      const repo = state.db.getRepoById(task.repo_id);
      if (!repo) {
        return ApiError.notFound('Repo not found').toResponse(res);
      }

      const workingDir = run.worktree_path ?? repo.path;
      const info = gitStatusInfo(workingDir, repo.default_branch, run.branch_name);

      return res.json({
        commits: info.commits,
        diffStat: info.diffStat,
        ahead: info.ahead,
        behind: info.behind,
      });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
