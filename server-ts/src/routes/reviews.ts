import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import {
  applyToMain,
  createPr,
  pushBranch,
  type ApplyToMainPayload,
} from '../services/mergeService.js';
import {
  submitReview,
  resendReview,
  type SubmitReviewPayload,
} from '../services/reviewService.js';
import type { AppState } from '../state.js';

export function reviewRoutes(): Router {
  const router = Router();

  // POST /api/tasks/:task_id/review - submit review
  router.post('/api/tasks/:task_id/review', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const payload = req.body as SubmitReviewPayload;
      const result = submitReview(state, taskId, payload);
      return res.status(202).json(result);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/tasks/:task_id/reviews - list review comments
  router.get('/api/tasks/:task_id/reviews', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const comments = state.db.listReviewComments(taskId);
      return res.json({ reviewComments: comments });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // PUT /api/tasks/:task_id/reviews/:id - edit review comment
  router.put('/api/tasks/:task_id/reviews/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const id = req.params.id as string;
      const { comment } = req.body as { comment?: string };
      if (!comment?.trim()) return ApiError.badRequest('Comment is required.').toResponse(res);

      const rc = state.db.getReviewCommentById(id);
      if (!rc) return ApiError.notFound('Review comment not found.').toResponse(res);
      if (rc.task_id !== taskId) return ApiError.badRequest('Comment does not belong to this task.').toResponse(res);
      if (rc.status === 'addressed') return ApiError.badRequest('Cannot edit an addressed comment.').toResponse(res);

      state.db.updateReviewCommentText(id, comment.trim());
      const updated = state.db.getReviewCommentById(id);
      return res.json({ reviewComment: updated });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/tasks/:task_id/reviews/:id - delete review comment
  router.delete('/api/tasks/:task_id/reviews/:id', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const id = req.params.id as string;

      const rc = state.db.getReviewCommentById(id);
      if (!rc) return ApiError.notFound('Review comment not found.').toResponse(res);
      if (rc.task_id !== taskId) return ApiError.badRequest('Comment does not belong to this task.').toResponse(res);
      if (rc.status === 'addressed') return ApiError.badRequest('Cannot delete an addressed comment.').toResponse(res);

      state.db.deleteReviewComment(id);
      return res.json({ deleted: true });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks/:task_id/reviews/:id/resend - re-send review comment
  router.post('/api/tasks/:task_id/reviews/:id/resend', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const id = req.params.id as string;
      const { profileId } = (req.body ?? {}) as { profileId?: string };
      const result = resendReview(state, taskId, id, profileId);
      return res.status(202).json(result);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks/:task_id/complete - mark task as done
  router.post('/api/tasks/:task_id/complete', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;

      const task = state.db.getTaskById(taskId);
      if (!task) {
        return ApiError.notFound('Task not found.').toResponse(res);
      }

      if (task.status !== 'IN_REVIEW') {
        return ApiError.badRequest('Task must be in IN_REVIEW status to complete.').toResponse(res);
      }

      state.db.updateTaskStatus(taskId, 'DONE');
      return res.json({ status: 'DONE', taskId });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks/:task_id/apply-to-main - apply changes to main branch
  router.post('/api/tasks/:task_id/apply-to-main', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const payload = (req.body ?? {}) as ApplyToMainPayload;
      const result = applyToMain(state, taskId, payload);

      if ('conflict' in result && result.conflict) {
        return res.status(409).json(result);
      }

      return res.json(result);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks/:task_id/push - push branch
  router.post('/api/tasks/:task_id/push', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const result = pushBranch(state, taskId);
      return res.json(result);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks/:task_id/create-pr - create pull request
  router.post('/api/tasks/:task_id/create-pr', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const result = createPr(state, taskId);
      return res.json(result);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
