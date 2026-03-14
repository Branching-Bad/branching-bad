import { Router, type Request, type Response } from 'express';
import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';

export function glossaryRoutes(): Router {
  const router = Router();

  // GET /api/glossary?repoId=...&q=...
  router.get('/api/glossary', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = String(req.query.repoId ?? '');
      if (!repoId) return ApiError.badRequest('repoId is required').toResponse(res);

      const query = String(req.query.q ?? '');
      if (query) {
        const sanitized = query.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!sanitized) return res.json({ terms: [] });
        const terms = state.db.searchGlossaryTerms(repoId, sanitized);
        return res.json({ terms });
      }

      const terms = state.db.listGlossaryTerms(repoId);
      return res.json({ terms });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/glossary
  router.post('/api/glossary', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const { repoId, term, description } = req.body as {
        repoId?: string; term?: string; description?: string;
      };
      if (!repoId?.trim()) return ApiError.badRequest('repoId is required').toResponse(res);
      if (!term?.trim()) return ApiError.badRequest('term is required').toResponse(res);
      if (!description?.trim()) return ApiError.badRequest('description is required').toResponse(res);

      const created = state.db.insertGlossaryTerm(repoId, term.trim(), description.trim());
      return res.status(201).json(created);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // PUT /api/glossary/:id
  router.put('/api/glossary/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const id = String(req.params.id);
      const { term, description } = req.body as { term?: string; description?: string };
      if (!term?.trim()) return ApiError.badRequest('term is required').toResponse(res);
      if (!description?.trim()) return ApiError.badRequest('description is required').toResponse(res);

      state.db.updateGlossaryTerm(id, term.trim(), description.trim());
      return res.json({ ok: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/glossary/export?repoId=...
  router.get('/api/glossary/export', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = String(req.query.repoId ?? '');
      if (!repoId) return ApiError.badRequest('repoId is required').toResponse(res);

      const terms = state.db.listGlossaryTerms(repoId);
      const payload = {
        type: 'glossary',
        version: 1,
        exportedAt: new Date().toISOString(),
        terms: terms.map((t) => ({ term: t.term, description: t.description })),
      };
      res.setHeader('Content-Disposition', 'attachment; filename="glossary.json"');
      return res.json(payload);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/glossary/import — body: { repoId, strategy: "skip"|"update", terms: [{term,description}] }
  router.post('/api/glossary/import', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const { repoId, strategy, terms } = req.body as {
        repoId?: string;
        strategy?: 'skip' | 'update';
        terms?: { term: string; description: string }[];
      };
      if (!repoId?.trim()) return ApiError.badRequest('repoId is required').toResponse(res);
      if (!Array.isArray(terms)) return ApiError.badRequest('terms array is required').toResponse(res);
      const mode = strategy === 'update' ? 'update' : 'skip';

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const entry of terms) {
        if (!entry.term?.trim() || !entry.description?.trim()) { skipped++; continue; }
        const existing = state.db.findGlossaryTermByName(repoId, entry.term.trim());
        if (existing) {
          if (mode === 'update') {
            state.db.updateGlossaryTerm(existing.id, entry.term.trim(), entry.description.trim());
            updated++;
          } else {
            skipped++;
          }
        } else {
          state.db.insertGlossaryTerm(repoId, entry.term.trim(), entry.description.trim());
          created++;
        }
      }

      return res.json({ created, updated, skipped });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/glossary/:id
  router.delete('/api/glossary/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      state.db.deleteGlossaryTerm(String(req.params.id));
      return res.json({ deleted: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
