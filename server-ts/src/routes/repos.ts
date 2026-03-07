import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { listBranches } from '../executor/index.js';
import type { AppState } from '../state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

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

      const body = req.body as { defaultBranch?: string; name?: string; buildCommand?: string | null };

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

      if (body.buildCommand !== undefined) {
        const cmd = body.buildCommand?.trim() || null;
        state.db.updateRepoBuildCommand(repo.id, cmd);
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

  // POST /api/system/update — git pull + npm install in project root
  router.post('/api/system/update', (_req: Request, res: Response) => {
    try {
      const pull = spawnSync('git', ['pull', '--ff-only'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 30_000,
        shell: process.platform === 'win32',
      });

      if (pull.status !== 0) {
        const err = (pull.stderr ?? pull.stdout ?? '').trim();
        return res.json({ success: false, message: `git pull failed: ${err}` });
      }

      const pullOutput = (pull.stdout ?? '').trim();

      // Run npm install if package-lock changed
      const install = spawnSync('npm', ['install', '--prefer-offline'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        shell: process.platform === 'win32',
      });

      const installOk = install.status === 0;
      const message = installOk
        ? `${pullOutput}\nDependencies updated. Restart the server to apply changes.`
        : `${pullOutput}\nnpm install warning: ${(install.stderr ?? '').slice(-500)}`;

      return res.json({ success: true, message });
    } catch (e) {
      return res.json({ success: false, message: String(e) });
    }
  });

  return router;
}
