import type { LogMsg } from '../msgStore.js';
import type { ProgressCallback } from './types.js';

// ---------------------------------------------------------------------------
// Progress emission helpers
// ---------------------------------------------------------------------------

export function emitProgress(progress: ProgressCallback | null, msg: LogMsg): void {
  if (progress) {
    progress(msg);
  }
}

export function emitProgressText(progress: ProgressCallback | null, message: string): void {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  emitProgress(progress, { type: 'agent_text', data: trimmed });
}

// ---------------------------------------------------------------------------
// Prompt template sections
// ---------------------------------------------------------------------------

export function buildSentryPromptSection(): string {
  return `
## Bug Fix Instructions (Sentry Error)

This task was created from a Sentry error report. The description above contains the full error details and stack trace.

Instructions:
- ONLY fix the bug. Do NOT change any behavior beyond fixing the error.
- Include a "Root Cause" section in plan_markdown explaining why this error occurs.
- Include an "Error Description" section with the full error details.
- If the task title starts with "[SENTRY]" and the description mentions regression,
  note whether a previous fix may not have been deployed to all environments.
- Focus on minimal, targeted changes. No refactoring.
- The plan_markdown MUST contain these sections:
  1. Root Cause
  2. Error Description
  3. Fix Strategy
  4. Files to Change
`;
}
