// ---------------------------------------------------------------------------
// CloudWatch investigation routes
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { AppState } from '../../state.js';
import { ApiError } from '../../errors.js';
import { buildTaskDescription } from './index.js';
import type { InvestigationResult } from './index.js';
import { startAnalysis, startInvestigation, startSavedQueryRun } from './jobs.js';

function parseAccountConfig(state: AppState, accountId: string): { accessKeyId: string; secretAccessKey: string; region: string } {
  const account = state.db.getProviderAccount(accountId);
  if (!account) throw ApiError.notFound('Provider account not found');
  const config = JSON.parse(account.config_json);
  return {
    accessKeyId: config.access_key_id ?? '',
    secretAccessKey: config.secret_access_key ?? '',
    region: config.region ?? '',
  };
}

export function cloudwatchRoutes(): Router {
  const router = Router();

  router.post('/api/cloudwatch/investigate', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const body = req.body;
    const repoId = body.repoId as string;
    const accountId = body.accountId as string;
    const logGroup = body.logGroup as string;
    const question = body.question as string;
    const timeRange = (body.timeRangeMinutes as number) ?? 60;

    const id = uuidv4();
    const inv = state.db.createInvestigation(
      id, repoId, accountId, logGroup, question, timeRange,
    );

    const repo = state.db.getRepoById(repoId);
    if (!repo) throw ApiError.notFound('Repo not found');

    const awsCfg = parseAccountConfig(state, accountId);

    startInvestigation(state.db, {
      id, question, logGroup, timeRangeMinutes: timeRange,
      repoPath: repo.path, ...awsCfg,
    });

    return res.json({ id: inv.id, status: inv.status });
  });

  router.get('/api/cloudwatch/investigations/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const inv = state.db.getInvestigation(req.params.id as string);
    return res.json({ investigation: inv });
  });

  router.get('/api/cloudwatch/investigations', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.query.repo_id ?? '');
    const list = state.db.listInvestigations(repoId);
    return res.json({ investigations: list });
  });

  router.post('/api/cloudwatch/investigations/:id/analyze', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const id = req.params.id as string;
    const inv = state.db.getInvestigation(id);

    if (inv.status !== 'logs_ready') {
      throw ApiError.badRequest(
        `Investigation status is '${inv.status}', expected 'logs_ready'`,
      );
    }

    state.db.updateInvestigationStatus(id, 'analyzing', undefined, undefined, undefined);

    const repo = state.db.getRepoById(inv.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    startAnalysis(
      state.db, id, inv.question,
      inv.result_json as InvestigationResult, repo.path,
    );

    return res.json({ status: 'analyzing' });
  });

  router.post('/api/cloudwatch/investigations/:id/regenerate', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const id = req.params.id as string;
    const inv = state.db.getInvestigation(id);

    state.db.updateInvestigationStatus(id, 'running', {}, undefined, undefined);

    const repo = state.db.getRepoById(inv.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    const awsCfg = parseAccountConfig(state, inv.provider_account_id);

    startInvestigation(state.db, {
      id,
      question: inv.question,
      logGroup: inv.log_group,
      timeRangeMinutes: inv.time_range_minutes,
      repoPath: repo.path,
      ...awsCfg,
    });

    return res.json({ status: 'running' });
  });

  router.post('/api/cloudwatch/investigations/:id/create-task', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const id = req.params.id as string;
    const inv = state.db.getInvestigation(id);
    const invResult = inv.result_json as InvestigationResult;

    const description = buildTaskDescription(inv.question, invResult);
    const title =
      inv.question.length > 60
        ? `[CW] ${inv.question.slice(0, 60)}...`
        : `[CW] ${inv.question}`;

    const task = state.db.createManualTask({
      repoId: inv.repo_id,
      title,
      description,
      priority: 'high',
      requirePlan: true,
      autoStart: false,
    });

    state.db.setInvestigationLinkedTask(id, task.id);
    return res.json({ task: { id: task.id, title: task.title } });
  });

  // -- Saved Queries --

  router.get('/api/cloudwatch/saved-queries', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.query.repo_id ?? '');
    const list = state.db.listSavedQueries(repoId);
    return res.json({ queries: list });
  });

  router.post('/api/cloudwatch/saved-queries', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const body = req.body;
    const id = uuidv4();
    const query = state.db.createSavedQuery(
      id, body.repoId, body.logGroup, body.label,
      body.question, body.queryTemplate, body.keywords ?? '',
    );
    return res.json({ query });
  });

  router.delete('/api/cloudwatch/saved-queries/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    state.db.deleteSavedQuery(req.params.id as string);
    return res.json({ ok: true });
  });

  router.post('/api/cloudwatch/saved-queries/:id/run', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const savedId = req.params.id as string;
    const body = req.body;
    const saved = state.db.getSavedQuery(savedId);

    const timeRange = (body.timeRangeMinutes as number) ?? 60;
    const invId = uuidv4();

    const inv = state.db.createInvestigation(
      invId, body.repoId, body.accountId, saved.log_group,
      saved.question, timeRange,
    );

    state.db.incrementSavedQueryUseCount(savedId);

    const awsCfg = parseAccountConfig(state, body.accountId);

    startSavedQueryRun(state.db, {
      invId,
      logGroup: saved.log_group,
      queryTemplate: saved.query_template,
      timeRangeMinutes: timeRange,
      ...awsCfg,
    });

    return res.json({ id: inv.id, status: inv.status });
  });

  return router;
}
