import fsNode from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { homeDir } from './shared.js';

interface DirEntry {
  name: string;
  path: string;
  isGit: boolean;
}

interface DriveInfo {
  letter: string;
  path: string;
}

/** List available drive letters on Windows (e.g. C:\, D:\). */
function listWindowsDrives(): DriveInfo[] {
  try {
    const raw = execSync(
      'wmic logicaldisk get name',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[A-Z]:$/.test(l))
      .map((letter) => ({ letter, path: letter + '\\' }));
  } catch {
    return [{ letter: 'C:', path: 'C:\\' }];
  }
}

/** Check if canonical path is a filesystem root. */
function isRootPath(canonical: string): boolean {
  if (process.platform === 'win32') {
    // C:\ or C:
    return /^[A-Za-z]:[/\\]?$/.test(canonical);
  }
  return canonical === '/';
}

export function fsRoutes(): Router {
  const router = Router();

  router.get('/api/fs/list', (req: Request, res: Response) => {
    try {
      const queryPath = (req.query.path as string)?.trim();
      const base = queryPath || homeDir();

      let canonical: string;
      try {
        canonical = fsNode.realpathSync(base);
      } catch {
        return ApiError.badRequest('Cannot resolve path.').toResponse(res);
      }

      const stat = fsNode.statSync(canonical);
      if (!stat.isDirectory()) {
        return ApiError.badRequest('Path is not a directory.').toResponse(res);
      }

      let entries: fsNode.Dirent[];
      try {
        entries = fsNode.readdirSync(canonical, { withFileTypes: true });
      } catch (e) {
        return ApiError.badRequest(
          `Cannot read directory: ${e instanceof Error ? e.message : String(e)}`,
        ).toResponse(res);
      }

      const dirs: DirEntry[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(canonical, entry.name);
        const isGit = fsNode.existsSync(path.join(fullPath, '.git'));
        dirs.push({ name: entry.name, path: fullPath, isGit });
      }

      dirs.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      );

      const parentDir = path.dirname(canonical);
      const atRoot = isRootPath(canonical);

      // On Windows at a drive root, include sibling drives for navigation
      const drives =
        process.platform === 'win32' && atRoot
          ? listWindowsDrives()
          : undefined;

      return res.json({
        path: canonical,
        parent: atRoot ? null : parentDir,
        dirs,
        ...(drives ? { drives } : {}),
      });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
