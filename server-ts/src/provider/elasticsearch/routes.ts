// ---------------------------------------------------------------------------
// Elasticsearch investigation routes
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { AppState } from '../../state.js';
import { ApiError } from '../../errors.js';
import { invokeAgentCli } from '../../planner/index.js';
import {
  EsClient,
  buildTaskDescription,
  runAnalysis,
  runPhase1,
} from './index.js';
import type { InvestigationResult } from './index.js';
import { elasticsearchSavedQueryRoutes } from './saved-query-routes.js';

export function elasticsearchRoutes(): Router {
  const router = Router();

  router.post('/api/elasticsearch/investigate', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const body = req.body;
    const repoId = body.repoId as string;
    const accountId = body.accountId as string;
    const indexPattern = body.indexPattern as string;
    const question = body.question as string;
    const timeRange = (body.timeRangeMinutes as number) ?? 60;

    const id = uuidv4();
    const inv = state.db.createEsInvestigation(
      id, repoId, accountId, indexPattern, question, timeRange,
    );

    const repo = state.db.getRepoById(repoId);
    if (!repo) throw ApiError.notFound('Repo not found');

    const account = state.db.getProviderAccount(accountId);
    if (!account) throw ApiError.notFound('Provider account not found');
    const config = JSON.parse(account.config_json);

    const db = state.db;
    setImmediate(async () => {
      try {
        const es = EsClient.fromConfig(config);
        const req = {
          question,
          indexPattern,
          timeRangeMinutes: timeRange,
          repoPath: repo.path,
          agentCommand: '',
        };

        const result = await runPhase1(req, es, invokeAgentCli);
        const status = result.errorLogs.length === 0 ? 'no_results' : 'logs_ready';
        const queryStr = JSON.stringify(result.phase1Query);
        db.updateEsInvestigationStatus(id, status, result, queryStr, undefined);
      } catch (e: any) {
        db.updateEsInvestigationStatus(id, 'failed', undefined, undefined, e.message);
      }
    });

    return res.json({ id: inv.id, status: inv.status });
  });

  router.get('/api/elasticsearch/investigations/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const inv = state.db.getEsInvestigation(req.params.id as string);
    return res.json({ investigation: inv });
  });

  router.get('/api/elasticsearch/investigations', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.query.repo_id ?? '');
    const list = state.db.listEsInvestigations(repoId);
    return res.json({ investigations: list });
  });

  router.post('/api/elasticsearch/investigations/:id/analyze', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const id = req.params.id as string;
    const inv = state.db.getEsInvestigation(id);

    if (inv.status !== 'logs_ready') {
      throw ApiError.badRequest(
        `Investigation status is '${inv.status}', expected 'logs_ready'`,
      );
    }

    state.db.updateEsInvestigationStatus(id, 'analyzing', undefined, undefined, undefined);

    const repo = state.db.getRepoById(inv.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    const db = state.db;
    setImmediate(async () => {
      try {
        const invResult = inv.result_json as InvestigationResult;
        const analysis = await runAnalysis(
          inv.question, invResult, '', repo.path, invokeAgentCli,
        );
        const updated = { ...invResult, analysis };
        db.updateEsInvestigationStatus(id, 'completed', updated, undefined, undefined);
      } catch (e: any) {
        db.updateEsInvestigationStatus(id, 'failed', undefined, undefined, e.message);
      }
    });

    return res.json({ status: 'analyzing' });
  });

  router.post('/api/elasticsearch/investigations/:id/regenerate', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const id = req.params.id as string;
    const inv = state.db.getEsInvestigation(id);

    state.db.updateEsInvestigationStatus(id, 'running', {}, undefined, undefined);

    const repo = state.db.getRepoById(inv.repo_id);
    if (!repo) throw ApiError.notFound('Repo not found');

    const account = state.db.getProviderAccount(inv.provider_account_id);
    if (!account) throw ApiError.notFound('Provider account not found');
    const config = JSON.parse(account.config_json);

    const db = state.db;
    setImmediate(async () => {
      try {
        const es = EsClient.fromConfig(config);
        const req = {
          question: inv.question,
          indexPattern: inv.index_pattern,
          timeRangeMinutes: inv.time_range_minutes,
          repoPath: repo.path,
          agentCommand: '',
        };

        const result = await runPhase1(req, es, invokeAgentCli);
        const status = result.errorLogs.length === 0 ? 'no_results' : 'logs_ready';
        const queryStr = JSON.stringify(result.phase1Query);
        db.updateEsInvestigationStatus(id, status, result, queryStr, undefined);
      } catch (e: any) {
        db.updateEsInvestigationStatus(id, 'failed', undefined, undefined, e.message);
      }
    });

    return res.json({ status: 'running' });
  });

  router.post('/api/elasticsearch/investigations/:id/create-task', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const id = req.params.id as string;
    const inv = state.db.getEsInvestigation(id);
    const invResult = inv.result_json as InvestigationResult;

    const description = buildTaskDescription(inv.question, invResult);
    const title =
      inv.question.length > 60
        ? `[ES] ${inv.question.slice(0, 60)}...`
        : `[ES] ${inv.question}`;

    const task = state.db.createManualTask({
      repoId: inv.repo_id,
      title,
      description,
      priority: 'high',
      requirePlan: true,
      autoStart: false,
    });

    state.db.setEsInvestigationLinkedTask(id, task.id);
    return res.json({ task: { id: task.id, title: task.title } });
  });

  // Mount saved query routes
  router.use(elasticsearchSavedQueryRoutes());

  return router;
}
