import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { LogMsg } from '../msgStore.js';
import { invokeAgentCli } from '../planner/index.js';
import { buildPlanReviewPrompt } from '../services/planService.js';
import type { AppState } from '../state.js';
import { buildAgentCommand } from './shared.js';
import { streamSSE } from './sse.js';

interface ReviewPlanPayload {
  profileId: string;
}

export function planReviewRoutes(): Router {
  const router = Router();

  // POST /api/plans/:plan_id/review - AI plan review (SSE stream)
  router.post('/api/plans/:plan_id/review', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const planId = req.params.plan_id as string;
      const payload = req.body as ReviewPlanPayload;

      const plan = state.db.getPlanById(planId);
      if (!plan) {
        return ApiError.notFound('Plan not found.').toResponse(res);
      }

      const task = state.db.getTaskById(plan.task_id);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      const repo = state.db.getRepoById(task.repo_id);
      if (!repo) {
        return ApiError.badRequest('Task repo not found.').toResponse(res);
      }

      const profile = state.db.getAgentProfileById(payload.profileId);
      if (!profile) {
        return ApiError.badRequest('Agent profile not found.').toResponse(res);
      }

      const agentCommand = buildAgentCommand(profile);
      const prompt = buildPlanReviewPrompt(task, plan);

      return streamSSE(res, async (send) => {
        try {
          const output = await invokeAgentCli(
            agentCommand,
            prompt,
            repo.path,
            (msg: LogMsg) => {
              const text = formatLogMessage(msg);
              if (text !== null) {
                send(JSON.stringify({ type: 'log', text }));
              }
            },
            null,
          );
          send(JSON.stringify({ type: 'done', feedback: output.text }));
        } catch (err) {
          send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
        }
      });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}

function formatLogMessage(msg: LogMsg): string | null {
  switch (msg.type) {
    case 'agent_text':
    case 'thinking':
    case 'stdout':
    case 'stderr':
      return msg.data;
    case 'tool_use':
      return `[tool: ${msg.data}]`;
    case 'tool_result':
      return `[result: ${msg.data}]`;
    case 'finished':
      return `[finished: ${msg.data}]`;
    default:
      return null;
  }
}
