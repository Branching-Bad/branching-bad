import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import { validateGraph } from '../workflow/validate.js';
import { startWorkflowRun } from '../workflow/orchestrator.js';
import { retryNode } from '../workflow/retry.js';
import type { Graph } from '../workflow/model.js';

export function workflowRoutes(state: AppState): Router {
  const r = Router();

  r.get('/', (req, res, next) => {
    try {
      const repoId = String(req.query.repoId ?? '');
      if (!repoId) throw new ApiError(400, 'repoId required');
      res.json(state.db.listWorkflows(repoId));
    } catch (e) { next(e); }
  });

  r.post('/', (req, res, next) => {
    try {
      const { repoId, name, graph } = req.body as { repoId: string; name: string; graph?: Graph };
      if (!repoId || !name) throw new ApiError(400, 'repoId and name required');
      const g: Graph = graph ?? { nodes: [], edges: [] };
      const errs = validateGraph(g);
      if (errs.length) throw new ApiError(400, errs.join('; '));
      const id = randomUUID();
      const wf = state.db.createWorkflow(id, repoId, name, g);
      res.status(201).json(wf);
    } catch (e) { next(e); }
  });

  r.get('/:id', (req, res, next) => {
    try {
      const wf = state.db.getWorkflow(req.params.id);
      if (!wf) throw new ApiError(404, 'not found');
      res.json(wf);
    } catch (e) { next(e); }
  });

  r.put('/:id', (req, res, next) => {
    try {
      const { name, graph, cron, cron_enabled } = req.body as {
        name?: string; graph?: Graph; cron?: string | null; cron_enabled?: boolean;
      };
      if (graph) {
        const errs = validateGraph(graph);
        if (errs.length) throw new ApiError(400, errs.join('; '));
      }
      state.db.updateWorkflow(req.params.id, { name, graph, cron, cron_enabled });
      state.workflowScheduler?.refresh(req.params.id);
      const wf = state.db.getWorkflow(req.params.id);
      res.json(wf);
    } catch (e) { next(e); }
  });

  r.delete('/:id', (req, res, next) => {
    try {
      state.db.deleteWorkflow(req.params.id);
      state.workflowScheduler?.refresh(req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  r.post('/:id/run', async (req, res, next) => {
    try {
      const runId = await startWorkflowRun(state, { workflowId: req.params.id, trigger: 'manual' });
      res.status(202).json({ runId });
    } catch (e) { next(e); }
  });

  r.get('/:id/runs', (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      res.json(state.db.listWorkflowRuns(req.params.id, limit));
    } catch (e) { next(e); }
  });

  r.get('/runs/:runId', (req, res, next) => {
    try {
      const run = state.db.getWorkflowRun(req.params.runId);
      if (!run) throw new ApiError(404, 'not found');
      const attempts = state.db.listAttempts(req.params.runId);
      res.json({ run, attempts });
    } catch (e) { next(e); }
  });

  const streamOutput = (kind: 'stdout' | 'stderr') => (req: Request, res: Response, next: NextFunction) => {
    try {
      const a = state.db.getAttempt(req.params.attemptId as string);
      if (!a) throw new ApiError(404, 'attempt not found');
      const file = kind === 'stdout' ? a.stdout_file : a.stderr_file;
      const inline = kind === 'stdout' ? a.stdout_inline : a.stderr_inline;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (file && fs.existsSync(file)) fs.createReadStream(file).pipe(res);
      else res.end(inline ?? '');
    } catch (e) { next(e); }
  };
  r.get('/runs/:runId/attempts/:attemptId/stdout', streamOutput('stdout'));
  r.get('/runs/:runId/attempts/:attemptId/stderr', streamOutput('stderr'));

  r.post('/runs/:runId/nodes/:nodeId/retry', async (req, res, next) => {
    try {
      const attemptId = await retryNode(state, req.params.runId, req.params.nodeId);
      res.status(202).json({ attemptId });
    } catch (e) { next(e); }
  });

  r.post('/runs/:runId/cancel', (req, res, next) => {
    try {
      state.db.updateWorkflowRunStatus(req.params.runId, 'cancelled', new Date().toISOString());
      res.status(202).end();
    } catch (e) { next(e); }
  });

  r.post('/:id/cron/toggle', (req, res, next) => {
    try {
      const wf = state.db.getWorkflow(req.params.id);
      if (!wf) throw new ApiError(404, 'not found');
      state.db.updateWorkflow(req.params.id, { cron_enabled: !wf.cron_enabled });
      state.workflowScheduler?.refresh(req.params.id);
      res.json(state.db.getWorkflow(req.params.id));
    } catch (e) { next(e); }
  });

  return r;
}
