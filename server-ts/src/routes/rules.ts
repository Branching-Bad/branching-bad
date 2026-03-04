import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { invokeAgentCli } from '../planner/index.js';
import type { AppState } from '../state.js';
import { buildAgentCommand } from './shared.js';

export function rulesRoutes(): Router {
  const router = Router();

  // GET /api/rules
  router.get('/api/rules', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const repoId = req.query.repoId as string;
      const rules = state.db.listRules(repoId || undefined);
      return res.json({ rules });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/rules
  router.post('/api/rules', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const body = req.body as { repoId?: string; content: string };
      const content = (body.content ?? '').trim();
      if (!content) {
        return ApiError.badRequest('Rule content is required.').toResponse(res);
      }

      const rule = state.db.createRule(body.repoId, content, 'manual');
      return res.status(201).json({ rule });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // PUT /api/rules/:rule_id
  router.put('/api/rules/:rule_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const ruleId = req.params.rule_id as string;
      const body = req.body as { content: string };
      const content = (body.content ?? '').trim();
      if (!content) {
        return ApiError.badRequest('Rule content is required.').toResponse(res);
      }

      state.db.updateRule(ruleId, content);
      return res.json({ updated: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/rules/:rule_id
  router.delete('/api/rules/:rule_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const ruleId = req.params.rule_id as string;
      state.db.deleteRule(ruleId);
      return res.json({ deleted: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/rules/from-comment/:comment_id
  router.post('/api/rules/from-comment/:comment_id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const commentId = req.params.comment_id as string;
      const body = req.body as { repoId?: string };

      const comment = state.db.getReviewCommentById(commentId);
      if (!comment) {
        return ApiError.notFound('Review comment not found.').toResponse(res);
      }

      const rule = state.db.createRule(body.repoId, comment.comment, 'review_comment', commentId);
      return res.status(201).json({ rule });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/rules/bulk-replace
  router.post('/api/rules/bulk-replace', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const body = req.body as { repoId?: string; contents: string[] };
      const rules = state.db.bulkReplaceRules(body.repoId, body.contents);
      return res.json({ rules });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/rules/optimize
  router.post('/api/rules/optimize', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const body = req.body as {
        repoId?: string;
        profileId: string;
        instruction?: string;
        scope?: string;
      };

      let allRules = state.db.listRules(body.repoId);

      const scope = body.scope ?? 'all';
      if (scope === 'global') {
        allRules = allRules.filter((r) => r.repo_id === null);
      } else if (scope === 'repo') {
        allRules = allRules.filter((r) => r.repo_id !== null);
      }

      if (allRules.length === 0) {
        return ApiError.badRequest('No rules to optimize.').toResponse(res);
      }

      const profile = state.db.getAgentProfileById(body.profileId);
      if (!profile) {
        return ApiError.badRequest('Agent profile not found.').toResponse(res);
      }

      const agentCommand = buildAgentCommand(profile);

      const rulesText = allRules
        .map((r, i) => `${i + 1}. ${r.content}`)
        .join('\n');

      const userInstruction = body.instruction?.trim()
        ? `\n\nAdditional user instruction:\n${body.instruction.trim()}`
        : '';

      const prompt =
        `You are optimizing a list of repository rules for a coding agent.\n\n` +
        `Current rules:\n${rulesText}\n\n` +
        `Instructions:\n` +
        `- Merge duplicate or overlapping rules\n` +
        `- Remove contradictory rules (keep the more specific one)\n` +
        `- Make each rule concise and actionable\n` +
        `- Preserve the intent of all rules\n` +
        `- Return ONLY a JSON array of strings, each string being an optimized rule\n` +
        `- Example: ["Always use snake_case for function names", "Never modify the auth module directly"]\n` +
        `- No markdown fences, no extra text. Just the JSON array.${userInstruction}`;

      let workingDir = '.';
      if (body.repoId) {
        const repo = state.db.getRepoById(body.repoId);
        if (repo) {
          workingDir = repo.path;
        }
      }

      const result = await invokeAgentCli(agentCommand, prompt, workingDir, null, null);

      const text = result.text.trim();
      let optimized: string[];

      try {
        optimized = JSON.parse(text);
      } catch {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
          try {
            optimized = JSON.parse(text.substring(start, end + 1));
          } catch (e2) {
            return ApiError.badRequest(`Failed to parse AI response: ${e2 instanceof Error ? e2.message : String(e2)}`).toResponse(res);
          }
        } else {
          return ApiError.badRequest('Could not parse optimized rules as JSON array').toResponse(res);
        }
      }

      return res.json({ optimized });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
