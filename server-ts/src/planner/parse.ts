import type { TaskWithPayload } from '../models.js';
import type { PlanGenerationEnvelope, TasklistEnvelope } from './types.js';
import {
  PLAN_MARKDOWN_MAX_BYTES,
  TASKLIST_JSON_MAX_BYTES,
} from './types.js';
import { extractJsonPayload } from './extract.js';
import { validateTasklistJson } from './validate.js';

// ---------------------------------------------------------------------------
// High-level response parsers — turn raw agent output into validated data
// ---------------------------------------------------------------------------

export function parseStrictPlanResponse(raw: string): { markdown: string } {
  const jsonValue = extractJsonPayload(raw);
  const envelope = jsonValue as PlanGenerationEnvelope;

  if (typeof envelope.schema_version !== 'number' || typeof envelope.plan_markdown !== 'string') {
    throw new Error('invalid strict plan envelope json');
  }

  if (envelope.schema_version !== 1) {
    throw new Error('plan envelope schema_version must be 1');
  }

  const markdown = envelope.plan_markdown.trim();
  if (!markdown) {
    throw new Error('plan_markdown must not be empty');
  }
  if (Buffer.byteLength(markdown, 'utf8') > PLAN_MARKDOWN_MAX_BYTES) {
    throw new Error(`plan_markdown exceeds ${PLAN_MARKDOWN_MAX_BYTES} bytes limit`);
  }

  return { markdown };
}

export function parseStrictTasklistResponse(
  raw: string,
  task: TaskWithPayload,
  targetPlanVersion: number,
): any {
  const jsonValue = extractJsonPayload(raw);
  const envelope = jsonValue as TasklistEnvelope;

  if (typeof envelope.schema_version !== 'number' || !envelope.tasklist_json) {
    throw new Error('invalid strict tasklist envelope json');
  }

  if (envelope.schema_version !== 1) {
    throw new Error('tasklist envelope schema_version must be 1');
  }

  validateTasklistJson(
    envelope.tasklist_json,
    task.jira_issue_key,
    targetPlanVersion,
  );

  const serialized = JSON.stringify(envelope.tasklist_json);
  if (Buffer.byteLength(serialized, 'utf8') > TASKLIST_JSON_MAX_BYTES) {
    throw new Error(`tasklist json exceeds ${TASKLIST_JSON_MAX_BYTES} bytes limit`);
  }

  return envelope.tasklist_json;
}
