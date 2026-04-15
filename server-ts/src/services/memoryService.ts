import type { Db } from '../db/index.js';
import type { TaskMemory } from '../db/memories.js';
import type { TaskWithPayload } from '../models.js';
import { invokeAgentCli } from '../planner/agent.js';

/**
 * Search for relevant memories and format as a prompt section.
 * Uses FTS5 full-text search first, then falls back to file-path overlap
 * matching (file paths are language-agnostic and work across all locales).
 */
export function buildMemoriesSection(db: Db, task: TaskWithPayload): string {
  const query = `${task.title} ${task.description ?? ''}`.trim();
  if (!query) return '';

  // Sanitize FTS5 query: remove special chars that break MATCH
  const sanitized = query.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  let memories: TaskMemory[] = [];

  // 1. Try FTS5 full-text search
  if (sanitized) {
    try {
      memories = db.searchMemories(task.repo_id, sanitized, 5);
    } catch {
      // FTS query may fail with certain character combinations
    }
  }

  // 2. If FTS found nothing, fall back to recent memories from same repo
  // (file-path overlap provides implicit relevance)
  if (memories.length === 0) {
    try {
      const recent = db.listMemories(task.repo_id, 10, 0);
      memories = recent.memories.slice(0, 5);
    } catch {
      // ignore
    }
  }

  if (memories.length === 0) return '';

  const items = memories.map((m, i) =>
    `${i + 1}. ${m.title}\n   ${m.summary.split('\n').join('\n   ')}`,
  );

  return `\nPast task memories (similar completed tasks in this repo — use as reference):\n${items.join('\n\n')}\n`;
}

/**
 * Search memories by a free-form query (not tied to a task). Falls back to
 * recent memories for the repo when FTS finds nothing. Returns a
 * prompt-ready section or empty string.
 */
export function buildMemoriesSectionForQuery(db: Db, repoId: string, query: string, limit = 5): string {
  const sanitized = (query ?? '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  let memories: TaskMemory[] = [];
  if (sanitized) {
    try { memories = db.searchMemories(repoId, sanitized, limit); } catch { /* ignore */ }
  }
  if (memories.length === 0) {
    try {
      const recent = db.listMemories(repoId, limit * 2, 0);
      memories = recent.memories.slice(0, limit);
    } catch { /* ignore */ }
  }
  if (memories.length === 0) return '';

  const items = memories.map((m, i) =>
    `${i + 1}. ${m.title}\n   ${m.summary.split('\n').join('\n   ')}`,
  );
  return `\nRelevant memories from this repo:\n${items.join('\n\n')}\n`;
}

/**
 * Build a task memory from completed run data.
 * Uses agent CLI (Haiku) to generate a meaningful summary.
 * Falls back to deterministic summary if agent call fails.
 */
export async function createMemoryFromRun(
  db: Db,
  taskId: string,
  runId: string,
  agentCommand: string,
  repoPath: string,
): Promise<void> {
  const task = db.getTaskById(taskId);
  if (!task) return;

  const diff = db.getRunDiff(runId);
  if (!diff || diff.length === 0) return;

  // Don't create duplicate memories for the same task
  if (db.hasMemoriesForTask(taskId)) return;

  const filesChanged = extractChangedFiles(diff);
  if (filesChanged.length === 0) return;

  const summary = await generateAgentSummary(agentCommand, repoPath, task, diff, filesChanged)
    ?? buildFallbackSummary(task.title, task.description, filesChanged, diff);

  db.insertTaskMemory(
    task.repo_id,
    taskId,
    runId,
    task.title,
    summary,
    filesChanged,
  );
}

async function generateAgentSummary(
  agentCommand: string,
  repoPath: string,
  task: TaskWithPayload,
  diff: string,
  filesChanged: string[],
): Promise<string | null> {
  // Truncate diff to keep prompt small
  const truncatedDiff = diff.length > 6000 ? diff.slice(0, 6000) + '\n... (truncated)' : diff;

  const prompt = `Summarize what was done in this coding task in 2-4 sentences. Focus on:
- What problem was solved and HOW (approach/pattern used)
- Key files and what changed in them
- Any important decisions or patterns applied

IMPORTANT: Write the summary in the SAME LANGUAGE as the task title and description below.
If the task is in Turkish, write the summary in Turkish. If in English, write in English.

Task: ${task.title}
Description: ${task.description ?? 'No description'}
Files changed: ${filesChanged.join(', ')}

Diff:
${truncatedDiff}

Return JSON only. No markdown fences. No extra text.
{"summary": "your 2-4 sentence summary here"}`;

  try {
    const output = await invokeAgentCli(agentCommand, prompt, repoPath, null, null);
    const parsed = extractSummaryJson(output.text);
    if (parsed && parsed.length > 10) return parsed;
  } catch {
    // Fall back to deterministic
  }

  return null;
}

function extractSummaryJson(text: string): string | null {
  try {
    const json = JSON.parse(text);
    if (typeof json.summary === 'string') return json.summary;
  } catch {
    // Try to extract from fenced JSON
    const match = text.match(/\{[\s\S]*"summary"\s*:\s*"([\s\S]*?)"\s*\}/);
    if (match) {
      try {
        const json = JSON.parse(match[0]);
        if (typeof json.summary === 'string') return json.summary;
      } catch { /* ignore */ }
    }
  }
  return null;
}

function extractChangedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const gitDiff = line.match(/^diff --git a\/(.+?) b\//);
    if (gitDiff) {
      files.add(gitDiff[1]);
      continue;
    }
    const plusFile = line.match(/^\+\+\+ b\/(.+)/);
    if (plusFile && plusFile[1] !== '/dev/null') {
      files.add(plusFile[1]);
    }
  }
  return [...files];
}

function buildFallbackSummary(
  title: string,
  description: string | null,
  filesChanged: string[],
  diff: string,
): string {
  const stats = diffStats(diff);
  const fileList = filesChanged.slice(0, 10).join(', ');
  const extra = filesChanged.length > 10 ? ` (+${filesChanged.length - 10} more)` : '';

  const parts = [
    `Task: ${title}`,
    description ? `Description: ${description.slice(0, 200)}` : '',
    `Files (${filesChanged.length}): ${fileList}${extra}`,
    `Changes: +${stats.additions} -${stats.deletions}`,
  ];

  return parts.filter(Boolean).join('\n');
}

function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}
