// ---------------------------------------------------------------------------
// Elasticsearch saved query routes
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { AppState } from '../../state.js';
import { ApiError } from '../../errors.js';
import { EsClient, logEntryFromHit } from './index.js';
import type { InvestigationResult, LogEntry } from './index.js';

export function elasticsearchSavedQueryRoutes(): Router {
  const router = Router();

  router.get('/api/elasticsearch/saved-queries', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const repoId = String(req.query.repo_id ?? '');
    const list = state.db.listEsSavedQueries(repoId);
    return res.json({ queries: list });
  });

  router.post('/api/elasticsearch/saved-queries', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const body = req.body;
    const id = uuidv4();
    const query = state.db.createEsSavedQuery(
      id, body.repoId, body.indexPattern, body.label,
      body.question, body.queryTemplate, body.keywords ?? '',
    );
    return res.json({ query });
  });

  router.delete('/api/elasticsearch/saved-queries/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    state.db.deleteEsSavedQuery(req.params.id as string);
    return res.json({ ok: true });
  });

  router.post('/api/elasticsearch/saved-queries/:id/run', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    const savedId = req.params.id as string;
    const body = req.body;
    const saved = state.db.getEsSavedQuery(savedId);

    const timeRange = (body.timeRangeMinutes as number) ?? 60;
    const invId = uuidv4();

    const inv = state.db.createEsInvestigation(
      invId, body.repoId, body.accountId, saved.index_pattern,
      saved.question, timeRange,
    );

    state.db.incrementEsSavedQueryUseCount(savedId);

    const account = state.db.getProviderAccount(body.accountId);
    if (!account) throw ApiError.notFound('Provider account not found');
    const config = JSON.parse(account.config_json);

    const db = state.db;
    const queryTemplate = saved.query_template;
    const indexPattern = saved.index_pattern;

    setImmediate(async () => {
      try {
        const es = EsClient.fromConfig(config);
        const queryDsl = JSON.parse(queryTemplate);
        const result = await es.search(indexPattern, queryDsl, 200);

        const errorLogs: LogEntry[] = result.hits.map(logEntryFromHit);

        const invResult: InvestigationResult = {
          phase1Query: queryDsl,
          phase1Reasoning: 'Saved query (agent skipped)',
          relevantFiles: [],
          correlationIdField: '',
          errorLogs,
          correlationIds: [],
          traceLogs: {},
        };

        const status = errorLogs.length === 0 ? 'no_results' : 'logs_ready';
        db.updateEsInvestigationStatus(invId, status, invResult, queryTemplate, undefined);
      } catch (e: any) {
        db.updateEsInvestigationStatus(invId, 'failed', undefined, undefined, e.message);
      }
    });

    return res.json({ id: inv.id, status: inv.status });
  });

  return router;
}
