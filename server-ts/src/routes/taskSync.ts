import { Router, type Request, type Response } from 'express';

import { ApiError } from '../errors.js';
import type { AppState } from '../state.js';
import { enqueueAutostartIfEnabled, isTodoLaneStatus } from './shared.js';

interface SyncTasksPayload {
  repoId: string;
}

export function taskSyncRoutes(): Router {
  const router = Router();

  // POST /api/tasks/sync - sync Jira tasks
  router.post('/api/tasks/sync', async (req: Request, res: Response) => {
    const state = req.app.locals.state as AppState;
    try {
      const payload = req.body as SyncTasksPayload;

      const bindings = state.db.listProviderBindingsForRepo(payload.repoId);
      const binding = bindings.find((b) => b.provider_id === 'jira');
      if (!binding) {
        return ApiError.badRequest('Repo is not bound to a Jira board.').toResponse(res);
      }

      const account = state.db.getProviderAccount(binding.provider_account_id);
      if (!account) {
        return ApiError.badRequest('Invalid binding account.').toResponse(res);
      }

      const resource = state.db.getProviderResource(binding.provider_resource_id);
      if (!resource) {
        return ApiError.badRequest('Invalid binding resource.').toResponse(res);
      }

      const config = JSON.parse(account.config_json || '{}');
      const baseUrl = config.base_url ?? '';
      const email = config.email ?? '';
      const apiToken = config.api_token ?? '';

      const jiraProvider = state.registry.get('jira');
      if (!jiraProvider) {
        return ApiError.badRequest('Jira provider not registered.').toResponse(res);
      }

      const { JiraClient } = await import('../provider/jira/index.js');
      const client = new JiraClient(baseUrl, email, apiToken);

      const hadJiraTasksBefore = state.db
        .listTasksByRepo(payload.repoId)
        .some((task) => task.source === 'jira');

      const rawIssues = await client.fetchAssignedBoardIssues(resource.external_id);
      const issues = rawIssues.map((i) => ({
        jira_issue_key: i.jiraIssueKey,
        title: i.title,
        description: i.description,
        assignee: i.assignee,
        status: i.status,
        priority: i.priority,
        payload: i.payload,
      }));
      const syncResult = state.db.upsertTasks(
        payload.repoId,
        account.id,
        resource.id,
        issues,
      );

      const tasks = state.db.listTasksByRepo(payload.repoId);
      const taskIndex = new Map(tasks.map((t) => [t.id, t]));

      for (const transition of syncResult.transitions) {
        const task = taskIndex.get(transition.task_id);
        if (!task) {
          continue;
        }

        if (hadJiraTasksBefore && transition.is_new && isTodoLaneStatus(transition.current_status)) {
          enqueueAutostartIfEnabled(state, task, 'jira_sync_new');
          continue;
        }

        if (transition.previous_status !== null) {
          if (!isTodoLaneStatus(transition.previous_status) && isTodoLaneStatus(transition.current_status)) {
            enqueueAutostartIfEnabled(state, task, 'jira_sync_todo_transition');
          }
        }
      }

      return res.json({ synced: syncResult.synced, tasks });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse(res);
      return ApiError.internal(e).toResponse(res);
    }
  });

  return router;
}
