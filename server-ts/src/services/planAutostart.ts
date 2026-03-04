// ---------------------------------------------------------------------------
// Auto-approval and auto-start helpers for plan generation
// ---------------------------------------------------------------------------

import fs from 'fs';

import { ApiError } from '../errors.js';
import type { MsgStore } from '../msgStore.js';
import type { TaskWithPayload } from '../models.js';
import type { AppState } from '../state.js';
import { writePlanDebugLog } from './planService.js';

// ---------------------------------------------------------------------------
// Auto-approval
// ---------------------------------------------------------------------------

export function handleAutoApproval(
  state: AppState,
  store: MsgStore,
  logFile: fs.WriteStream | null,
  task: TaskWithPayload,
  plan: { id: string },
): void {
  try {
    state.db.addPlanAction(plan.id, 'approve', 'auto-approved by task setting', 'system:auto');
    state.db.updatePlanStatus(plan.id, 'approved');
    state.db.updateTaskStatus(task.id, 'PLAN_APPROVED');
  } catch {
    // Ignore auto-approve errors
  }
  store.push({ type: 'agent_text', data: 'Plan auto-approved by task settings.' });
  writePlanDebugLog(logFile, 'plan auto-approved by task settings');
}

// ---------------------------------------------------------------------------
// Auto-start
// ---------------------------------------------------------------------------

export async function handleAutoStart(
  state: AppState,
  store: MsgStore,
  logFile: fs.WriteStream | null,
  plan: { id: string },
  autostartJobId: string | undefined,
  task: TaskWithPayload,
): Promise<boolean> {
  if (!autostartJobId) {
    state.db.enqueueAutostartJob(task.id, 'auto_approve');
    store.push({ type: 'agent_text', data: 'Autostart job enqueued after auto-approval.' });
    writePlanDebugLog(logFile, 'autostart job enqueued after auto-approval');
    return false;
  }

  store.push({ type: 'agent_text', data: 'Starting run after auto-approval...' });
  writePlanDebugLog(logFile, 'starting run after auto-approval (inline)');

  try {
    const { startRunInternal } = await import('./runService.js');
    const runResult = await startRunInternal(state, {
      planId: plan.id,
      taskId: undefined,
      profileId: undefined,
      branchName: undefined,
    });

    const runId = runResult.run?.id;
    state.db.completeAutostartJob(autostartJobId, plan.id, runId);
    store.push({
      type: 'agent_text',
      data: `Run started successfully (run_id=${runId ?? '?'}).`,
    });
    writePlanDebugLog(logFile, `autostart job completed with run_id=${runId ?? '?'}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      state.db.requeueAutostartJob(
        autostartJobId,
        `conflict after auto-approve: ${error.message}`,
      );
      store.push({
        type: 'agent_text',
        data: `Run conflict, requeued: ${error.message}`,
      });
      writePlanDebugLog(logFile, `autostart requeued due to conflict: ${error.message}`);
    } else {
      const msg = `autostart run failed after auto-approve: ${error instanceof Error ? error.message : String(error)}`;
      state.db.failAutostartJob(autostartJobId, msg, plan.id);
      store.push({ type: 'agent_text', data: msg });
      writePlanDebugLog(logFile, msg);
    }
  }

  return true;
}
