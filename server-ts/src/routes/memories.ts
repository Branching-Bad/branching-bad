import { Router, type Request, type Response } from 'express';
import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';

export function memoryRoutes(): Router {
  const router = Router();

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
        const sanitized = query.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!sanitized) return res.json({ memories: [], total: 0, page, limit });
        const memories = state.db.searchMemories(repoId, sanitized, limit);
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
