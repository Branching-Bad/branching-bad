import type { StrictTasklistJson } from './types.js';
import { TASKLIST_JSON_MAX_BYTES } from './types.js';

// ---------------------------------------------------------------------------
// Tasklist validation
// ---------------------------------------------------------------------------

/**
 * Validates the shape of a raw value as a StrictTasklistJson object.
 * Throws if required fields are missing or have wrong types.
 */
export function parseAsStrictTasklistJson(value: any): StrictTasklistJson {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid tasklist_json payload');
  }
  if (
    typeof value.schema_version !== 'number' ||
    typeof value.issue_key !== 'string' ||
    typeof value.generated_from_plan_version !== 'number' ||
    !Array.isArray(value.phases)
  ) {
    throw new Error('invalid tasklist_json payload');
  }
  return value as StrictTasklistJson;
}

/**
 * Deep-validates a StrictTasklistJson against expected metadata and
 * structural rules. Auto-fixes invalid dependency references.
 */
export function validateTasklistJson(
  tasklist: StrictTasklistJson,
  expectedIssueKey: string,
  expectedPlanVersion: number,
): void {
  if (tasklist.schema_version !== 1) {
    throw new Error('tasklist_json.schema_version must be 1');
  }
  if (tasklist.issue_key !== expectedIssueKey) {
    throw new Error(
      `tasklist_json.issue_key must equal task issue key (expected ${expectedIssueKey}, got ${tasklist.issue_key})`,
    );
  }
  if (tasklist.generated_from_plan_version !== expectedPlanVersion) {
    throw new Error(
      `tasklist_json.generated_from_plan_version must be ${expectedPlanVersion}`,
    );
  }
  if (tasklist.phases.length === 0) {
    throw new Error('tasklist_json.phases must contain at least one phase');
  }

  const seenTaskIds = new Set<string>();
  const allTaskIds = new Set<string>();
  const seenPhaseIds = new Set<string>();

  for (const phase of tasklist.phases) {
    validatePhase(phase, seenPhaseIds, seenTaskIds, allTaskIds);
  }

  // Auto-fix: remove invalid dependency references instead of failing
  for (const phase of tasklist.phases) {
    for (const task of phase.tasks) {
      task.blocked_by = (task.blocked_by || []).filter((dep) => allTaskIds.has(dep));
      task.blocks = (task.blocks || []).filter((dep) => allTaskIds.has(dep));
    }
  }
}

/**
 * Convenience wrapper: parses a raw value as StrictTasklistJson, validates it,
 * and checks the byte-size limit.
 */
export function validateTasklistPayload(
  tasklistJson: any,
  expectedIssueKey: string,
  expectedPlanVersion: number,
): void {
  const parsed = parseAsStrictTasklistJson(tasklistJson);
  validateTasklistJson(parsed, expectedIssueKey, expectedPlanVersion);
  const serialized = JSON.stringify(tasklistJson);
  if (Buffer.byteLength(serialized, 'utf8') > TASKLIST_JSON_MAX_BYTES) {
    throw new Error(`tasklist json exceeds ${TASKLIST_JSON_MAX_BYTES} bytes limit`);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validatePhase(
  phase: any,
  seenPhaseIds: Set<string>,
  seenTaskIds: Set<string>,
  allTaskIds: Set<string>,
): void {
  if (!phase.id || !phase.id.trim()) {
    throw new Error('phase.id cannot be empty');
  }
  if (seenPhaseIds.has(phase.id)) {
    throw new Error(`duplicate phase.id detected: ${phase.id}`);
  }
  seenPhaseIds.add(phase.id);

  if (!phase.name || !phase.name.trim() || !phase.description || !phase.description.trim()) {
    throw new Error('phase.name and phase.description cannot be empty');
  }
  if (!phase.tasks || phase.tasks.length === 0) {
    throw new Error(`phase ${phase.id} must contain at least one task`);
  }

  for (const task of phase.tasks) {
    validateTask(task, seenTaskIds, allTaskIds);
  }
}

function validateTask(
  task: any,
  seenTaskIds: Set<string>,
  allTaskIds: Set<string>,
): void {
  if (!task.id || !task.id.trim()) {
    throw new Error('task id cannot be empty');
  }
  if (seenTaskIds.has(task.id)) {
    throw new Error(`duplicate task id detected: ${task.id}`);
  }
  seenTaskIds.add(task.id);

  if (!task.title || !task.title.trim() || !task.description || !task.description.trim()) {
    throw new Error(`task ${task.id} title/description cannot be empty`);
  }
  if (
    !task.acceptance_criteria ||
    task.acceptance_criteria.length === 0 ||
    task.acceptance_criteria.some((item: string) => !item.trim())
  ) {
    throw new Error(`task ${task.id} acceptance_criteria must contain non-empty entries`);
  }
  if (task.affected_files && task.affected_files.some((f: string) => !f.trim())) {
    throw new Error(`task ${task.id} affected_files cannot contain empty values`);
  }
  if (task.estimated_size != null) {
    if (task.estimated_size !== 'S' && task.estimated_size !== 'M' && task.estimated_size !== 'L') {
      throw new Error(`task ${task.id} estimated_size must be S, M, or L`);
    }
  }
  if (task.complexity != null) {
    if (task.complexity !== 'low' && task.complexity !== 'medium' && task.complexity !== 'high') {
      throw new Error(`task ${task.id} complexity must be low, medium, or high`);
    }
  }

  allTaskIds.add(task.id);
}
