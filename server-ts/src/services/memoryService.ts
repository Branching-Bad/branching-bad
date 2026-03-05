import type { Db } from '../db/index.js';
import type { TaskWithPayload } from '../models.js';
import { invokeAgentCli } from '../planner/agent.js';

/**
 * Search for relevant memories and format as a prompt section.
 */
export function buildMemoriesSection(db: Db, task: TaskWithPayload): string {
  const query = `${task.title} ${task.description ?? ''}`.trim();
  if (!query) return '';

  // Sanitize FTS5 query: remove special chars that break MATCH
  const sanitized = query.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!sanitized) return '';

  let memories;
  try {
    memories = db.searchMemories(task.repo_id, sanitized, 5);
  } catch {
    return '';
  }

  if (memories.length === 0) return '';

  const items = memories.map((m, i) =>
    `${i + 1}. ${m.title}\n   ${m.summary.split('\n').join('\n   ')}`,
  );

  return `\nPast task memories (similar completed tasks in this repo — use as reference):\n${items.join('\n\n')}\n`;
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
  const existing = db.getMemoriesByTask(taskId);
  if (existing.length > 0) return;

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
