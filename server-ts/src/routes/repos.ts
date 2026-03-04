import fs from 'fs';
import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { listBranches } from '../executor/index.js';
import type { AppState } from '../state.js';

export function repoRoutes(): Router {
  const router = Router();

  // GET /api/repos
  router.get('/api/repos', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repos = state.db.listRepos();
      return res.json({ repos });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/repos
  router.post('/api/repos', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const body = req.body as { path: string; name?: string };
      const rawPath = (body.path ?? '').trim();

      if (!rawPath) {
        return ApiError.badRequest('Repository path is required.').toResponse(res);
      }

      let repoPath: string;
      try {
        repoPath = fs.realpathSync(rawPath);
      } catch {
        return ApiError.badRequest('Repository path does not exist.').toResponse(res);
      }

      const stat = fs.statSync(repoPath);
      if (!stat.isDirectory()) {
        return ApiError.badRequest('Repository path does not point to a directory.').toResponse(res);
      }

      const repo = state.db.createOrUpdateRepo(repoPath, body.name?.trim());
      return res.json({ repo });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // PATCH /api/repos/:repo_id
  router.patch('/api/repos/:repo_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.params.repo_id as string;
      const repo = state.db.getRepoById(repoId);
      if (!repo) {
        return ApiError.notFound('Repo not found.').toResponse(res);
      }

      const body = req.body as { defaultBranch?: string; name?: string };

      if (body.defaultBranch) {
        const branch = body.defaultBranch.trim();
        if (branch) {
          state.db.updateRepoDefaultBranch(repo.id, branch);
        }
      }

      if (body.name) {
        const name = body.name.trim();
        if (name) {
          state.db.createOrUpdateRepo(repo.path, name);
        }
      }

      const updated = state.db.getRepoById(repoId);
      if (!updated) {
        return ApiError.notFound('Repo not found.').toResponse(res);
      }
      return res.json({ repo: updated });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/repos/:repo_id/branches
  router.get('/api/repos/:repo_id/branches', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.params.repo_id as string;
      const repo = state.db.getRepoById(repoId);
      if (!repo) {
        return ApiError.notFound('Repo not found.').toResponse(res);
      }

      const branches = listBranches(repo.path);
      return res.json({ branches, default: repo.default_branch });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
