import fs from 'fs';
import path from 'path';

import type { TaskWithPayload } from '../models.js';
import type { RepoContext } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.idea',
  '.vscode',
  'coverage',
  'target',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function walkFiles(repoPath: string, limit: number): string[] {
  const files: string[] = [];
  walkRecursive(repoPath, repoPath, files, limit);
  return files;
}

export function collectRepoContext(repoPath: string, task: TaskWithPayload): RepoContext {
  const topLevelDirs: string[] = [];
  const topLevelFiles: string[] = [];

  try {
    const entries = fs.readdirSync(repoPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') {
        continue;
      }
      if (entry.isDirectory()) {
        topLevelDirs.push(entry.name);
      } else if (entry.isFile()) {
        topLevelFiles.push(entry.name);
      }
    }
  } catch {
    // Directory may not be readable
  }

  topLevelDirs.sort();
  topLevelFiles.sort();
  topLevelDirs.splice(12);
  topLevelFiles.splice(12);

  const allFiles = walkFiles(repoPath, 400);
  const tokens = keywordTokens(`${task.title} ${task.description ?? ''}`);

  const scored = allFiles
    .map((file) => {
      const lower = file.toLowerCase();
      const score = tokens.filter((t) => lower.includes(t)).length;
      return { file, score };
    })
    .filter(({ score }) => score > 0);

  scored.sort((a, b) => b.score - a.score);

  let candidateFiles: string[];
  if (scored.length === 0) {
    candidateFiles = allFiles.slice(0, 8);
  } else {
    candidateFiles = scored.slice(0, 8).map(({ file }) => file);
  }

  return { topLevelDirs, topLevelFiles, candidateFiles };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function walkRecursive(
  rootPath: string,
  currentPath: string,
  files: string[],
  limit: number,
): void {
  if (files.length >= limit) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= limit) {
      return;
    }

    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      walkRecursive(rootPath, fullPath, files, limit);
    } else if (entry.isFile()) {
      const relative = path.relative(rootPath, fullPath).split(path.sep).join('/');
      files.push(relative);
    }
  }
}

function keywordTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-/ ]/g, ' ');
  return normalized
    .split(/\s+/)
    .filter((part) => part.length >= 4);
}
