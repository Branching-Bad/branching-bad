import { v4 as uuidv4 } from 'uuid';
import type {
  JiraIssueForTask,
  UpsertTasksResult,
  UpsertTaskTransition,
} from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    upsertTasks(
      repoId: string,
      jiraAccountId: string,
      jiraBoardId: string,
      tasks: JiraIssueForTask[],
    ): UpsertTasksResult;
  }
}

Db.prototype.upsertTasks = function (
  repoId: string,
  jiraAccountId: string,
  jiraBoardId: string,
  tasks: JiraIssueForTask[],
): UpsertTasksResult {
  if (tasks.length === 0) {
    return { synced: 0, transitions: [] };
  }
  const db = this.connect();
    const transitions: UpsertTaskTransition[] = [];
    const ts = nowIso();

    const tx = this.transaction(() => {
      for (const task of tasks) {
        const existing = db
          .prepare(
            'SELECT id, status FROM tasks WHERE jira_account_id = ? AND jira_issue_key = ?',
          )
          .get(jiraAccountId, task.jira_issue_key) as
          | { id: string; status: string }
          | undefined;

        const taskId = existing ? existing.id : uuidv4();

        db.prepare(
          `INSERT INTO tasks (
             id, repo_id, jira_account_id, jira_board_id, jira_issue_key, title,
             description, assignee, status, priority, source, require_plan, auto_start,
             auto_approve_plan, last_pipeline_error, last_pipeline_at, payload_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'jira', 1, 0, 0, NULL, NULL, ?, ?, ?)
           ON CONFLICT(jira_account_id, jira_issue_key)
           DO UPDATE SET
             repo_id = excluded.repo_id,
             jira_board_id = excluded.jira_board_id,
             title = excluded.title,
             description = excluded.description,
             assignee = excluded.assignee,
             priority = excluded.priority,
             source = excluded.source,
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`,
        ).run(
          taskId,
          repoId,
          jiraAccountId,
          jiraBoardId,
          task.jira_issue_key,
          task.title,
          task.description ?? null,
          task.assignee ?? null,
          task.status,
          task.priority ?? null,
          JSON.stringify(task.payload ?? {}),
          ts,
          ts,
        );

        transitions.push({
          task_id: taskId,
          is_new: !existing,
          previous_status: existing ? existing.status : null,
          current_status: existing ? existing.status : task.status,
        });
      }
    });
    tx();

    return { synced: tasks.length, transitions };
};
