import type { TaskWithPayload } from '../models.js';
import { buildSentryPromptSection } from './helpers.js';
import { collectRepoContext } from './context.js';

// ---------------------------------------------------------------------------
// Prompt builders for plan generation
// ---------------------------------------------------------------------------

export function buildPlanPrompt(
  repoPath: string,
  task: TaskWithPayload,
  revisionComment: string | null,
  rulesSection: string,
  memoriesSection = '',
): string {
  const context = collectRepoContext(repoPath, task);
  const fileList = context.candidateFiles.map((f) => `- ${f}`).join('\n');
  const repoStructure = `Directories: ${
    context.topLevelDirs.length === 0 ? '(none)' : context.topLevelDirs.join(', ')
  }\nFiles: ${
    context.topLevelFiles.length === 0 ? '(none)' : context.topLevelFiles.join(', ')
  }`;

  const revisionSection = revisionComment
    ? `\nRevision request from user:\n${revisionComment}\n`
    : '';

  const sentrySection = task.source === 'sentry'
    ? buildSentryPromptSection()
    : '';

  return `You are planning implementation for a coding task.

CRITICAL: This is a READ-ONLY planning task. Do NOT modify, edit, create, or delete any files. Do NOT run any commands that change state. Do NOT take any action to implement the plan. Your ONLY job is to analyze the codebase and produce a plan document. Nothing else.

Return JSON only. No markdown fences. No extra text.

Output schema (exact keys, no extra keys):
{
  "schema_version": 1,
  "plan_markdown": "string"
}

Task:
- issue_key: ${task.jira_issue_key}
- title: ${task.title}
- description: ${task.description ?? 'No description provided.'}
${revisionSection}${sentrySection}${rulesSection}
Repository context:
${repoStructure}

Likely affected files:
${fileList}

Constraints:
- \`plan_markdown\` must be concise, actionable, and <= 64KB.
- Include sections for: Goal, Summary, Scope, Risks, Verification, Acceptance Criteria.
- IMPLEMENTATION-READY: The plan must contain enough detail (exact file paths, function names, logic descriptions) so the executing agent can start coding immediately without any discovery or exploration phase. You are doing the discovery now — the executor should not need to.
- NO DISCOVERY TASKS: Do NOT include tasks like "explore codebase", "analyze architecture", "investigate existing patterns", "review current implementation". All discovery happens during this planning phase.
- NO TEST WRITING: Do NOT include tasks for writing unit tests, integration tests, or test files unless the user explicitly requested tests in the task description. The executor will only verify the build compiles successfully.
- Verification section should focus on build verification (\`npm run build\`, \`tsc --noEmit\`, etc.), not on writing new tests.
- Never output keys outside the schema.
${memoriesSection}`;
}

export function buildTasklistPrompt(
  task: TaskWithPayload,
  planMarkdown: string,
  targetPlanVersion: number,
): string {
  return `You are decomposing an approved implementation plan into a strict tasklist.

Return JSON only. No markdown fences. No extra text.

Output schema (exact keys, no extra keys, no null values):
{
  "schema_version": 1,
  "tasklist_json": {
    "schema_version": 1,
    "issue_key": "${task.jira_issue_key}",
    "generated_from_plan_version": ${targetPlanVersion},
    "phases": [
      {
        "id": "string",
        "name": "string",
        "description": "string",
        "order": 1,
        "tasks": [
          {
            "id": "string",
            "title": "string",
            "description": "string",
            "blocked_by": ["task-id"],
            "blocks": ["task-id"],
            "affected_files": ["path/file.ext"],
            "acceptance_criteria": ["string"],
            "suggested_subagent": "string",
            "estimated_size": "S|M|L",
            "complexity": "low|medium|high",
            "suggested_model": "opus|sonnet|haiku"
          }
        ]
      }
    ]
  }
}

Task context:
- issue_key: ${task.jira_issue_key}
- title: ${task.title}
- description: ${task.description ?? 'No description provided.'}

Plan markdown:
${planMarkdown}

Constraints:
- All task IDs must be unique across all phases.
- \`blocked_by\` and \`blocks\` references must point to existing task IDs.
- At least one phase and one task required.
- \`tasklist_json\` serialized size must stay <= 256KB.
- \`complexity\` is REQUIRED for every task. Assess based on scope, number of files, and risk:
  - "low": single-file edit, config change, simple addition
  - "medium": multi-file changes, moderate logic, standard patterns
  - "high": cross-cutting changes, complex logic, architectural decisions, risky refactors
- \`suggested_model\` is REQUIRED for every task. Choose based on complexity:
  - "haiku": low complexity tasks (simple edits, config changes)
  - "sonnet": medium complexity tasks (standard feature work, multi-file changes)
  - "opus": high complexity tasks (architecture, complex logic, critical code)
- IMPLEMENTATION-ONLY TASKS: Every task must be a concrete implementation action (create file, modify function, add route, update config, etc.). Do NOT create tasks for discovery, exploration, analysis, investigation, or reviewing existing code. The plan already contains all the context needed.
- NO TEST TASKS: Do NOT create tasks for writing tests unless the original task description explicitly requests tests. The final task should be build verification only.
- Include a final task for build verification (e.g. "Run type check and build") — not for writing tests.

CRITICAL: This is a READ-ONLY planning task. Do NOT modify, edit, create, or delete any files. Do NOT run any commands that change state. Do NOT take any action to implement the plan. Your ONLY job is to decompose the plan into a structured tasklist. Nothing else.
`;
}
