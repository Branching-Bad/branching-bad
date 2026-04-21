import { Router, type Request, type Response } from 'express';
import { ApiError } from '../errors.js';
import { sanitizeFtsQuery, buildFtsMatchExpr } from '../db/ftsQuery.js';
import type { AppState } from '../state.js';

export function memoryRoutes(): Router {
  const router = Router();

  // GET /api/memories/fts-test?repoId=...&q=... — FTS diagnostic: sanitized query + BM25-ranked results
  router.get('/api/memories/fts-test', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = String(req.query.repoId ?? '');
      if (!repoId) return ApiError.badRequest('repoId is required.').toResponse(res);
      const raw = String(req.query.q ?? '');
      const sanitized = sanitizeFtsQuery(raw);
      const matchExpr = buildFtsMatchExpr(sanitized);
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10));
      if (!matchExpr) return res.json({ raw, sanitized, matchExpr: '', results: [] });
      try {
        const results = state.db.searchMemoriesWithRank(repoId, matchExpr, limit);
        return res.json({ raw, sanitized, matchExpr, results });
      } catch (err) {
        return res.json({ raw, sanitized, matchExpr, results: [], error: err instanceof Error ? err.message : String(err) });
      }
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/memories?repoId=...&q=...&page=...&limit=... — search or list memories
  router.get('/api/memories', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = String(req.query.repoId ?? '');
      const query = String(req.query.q ?? '');
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
      if (!repoId) return ApiError.badRequest('repoId is required.').toResponse(res);

      if (query) {
        const matchExpr = buildFtsMatchExpr(sanitizeFtsQuery(query));
        if (!matchExpr) return res.json({ memories: [], total: 0, page, limit });
        const memories = state.db.searchMemories(repoId, matchExpr, limit);
        return res.json({ memories, total: memories.length, page: 1, limit });
      }

      // No query — paginated list
      const offset = (page - 1) * limit;
      const result = state.db.listMemories(repoId, limit, offset);
      return res.json({ memories: result.memories, total: result.total, page, limit });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/memories/export?repoId=...
  router.get('/api/memories/export', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = String(req.query.repoId ?? '');
      if (!repoId) return ApiError.badRequest('repoId is required.').toResponse(res);

      const result = state.db.listMemories(repoId, 10000, 0);
      const payload = {
        type: 'memories',
        version: 1,
        exportedAt: new Date().toISOString(),
        memories: result.memories.map((m) => ({
          title: m.title,
          summary: m.summary,
          files_changed: m.files_changed,
        })),
      };
      res.setHeader('Content-Disposition', 'attachment; filename="memories.json"');
      return res.json(payload);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/memories/import — body: { repoId, strategy: "skip"|"update", memories: [{title,summary,files_changed}] }
  router.post('/api/memories/import', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const { repoId, strategy, memories } = req.body as {
        repoId?: string;
        strategy?: 'skip' | 'update';
        memories?: { title: string; summary: string; files_changed?: string[] }[];
      };
      if (!repoId?.trim()) return ApiError.badRequest('repoId is required.').toResponse(res);
      if (!Array.isArray(memories)) return ApiError.badRequest('memories array is required.').toResponse(res);
      const mode = strategy === 'update' ? 'update' : 'skip';

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const entry of memories) {
        if (!entry.title?.trim() || !entry.summary?.trim()) { skipped++; continue; }
        const existing = state.db.findMemoryByTitle(repoId, entry.title.trim());
        if (existing) {
          if (mode === 'update') {
            state.db.updateMemorySummary(existing.id, entry.summary.trim(), entry.files_changed ?? []);
            updated++;
          } else {
            skipped++;
          }
        } else {
          state.db.insertTaskMemory(repoId, '', '', entry.title.trim(), entry.summary.trim(), entry.files_changed ?? []);
          created++;
        }
      }

      return res.json({ created, updated, skipped });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/memories/task/:taskId — get memories for a specific task
  router.get('/api/memories/task/:taskId', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const memories = state.db.getMemoriesByTask(String(req.params.taskId));
      return res.json({ memories });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/memories/:id — delete a memory
  router.delete('/api/memories/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      state.db.deleteMemory(String(req.params.id));
      return res.json({ deleted: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
