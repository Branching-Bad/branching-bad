import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import { dispatchNextQueuedChat, sendChatMessage } from '../services/chatService.js';
import type { AppState } from '../state.js';

interface SendChatPayload {
  content: string;
  profileId?: string;
}

export function chatRoutes(): Router {
  const router = Router();

  // POST /api/tasks/:task_id/chat - send chat message
  router.post('/api/tasks/:task_id/chat', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const payload = req.body as SendChatPayload;

      const content = payload.content.trim();
      if (!content) {
        return ApiError.badRequest('Message content is required.').toResponse(res);
      }

      const result = sendChatMessage(state, taskId, content, payload.profileId);
      return res.json(result);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/tasks/:task_id/chat - get chat messages
  router.get('/api/tasks/:task_id/chat', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const messages = state.db.getChatMessages(taskId);
      return res.json({ messages });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // DELETE /api/tasks/:task_id/chat/queued - cancel queued messages
  router.delete('/api/tasks/:task_id/chat/queued', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const deleted = state.db.deleteQueuedChatMessages(taskId);
      return res.json({ deleted });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // GET /api/tasks/:task_id/chat/queue-status - check queue status
  router.get('/api/tasks/:task_id/chat/queue-status', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const queuedCount = state.db.countQueuedChatMessages(taskId);
      const isRunning = state.db.hasRunningRunForTask(taskId);
      return res.json({ queuedCount, isRunning });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  // POST /api/tasks/:task_id/chat/dispatch-next - dispatch next queued message
  router.post('/api/tasks/:task_id/chat/dispatch-next', (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const taskId = req.params.task_id as string;
      const result = dispatchNextQueuedChat(state, taskId);
      return res.json(result);
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
