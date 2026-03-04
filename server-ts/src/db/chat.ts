import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage } from '../models.js';
import { Db, nowIso } from './index.js';

declare module './index.js' {
  interface Db {
    insertChatMessage(
      taskId: string,
      role: string,
      content: string,
      status: string,
    ): ChatMessage;
    getChatMessages(taskId: string): ChatMessage[];
    getNextQueuedChatMessage(taskId: string): ChatMessage | null;
    updateChatMessageStatus(
      id: string,
      status: string,
      resultRunId?: string,
    ): void;
    deleteQueuedChatMessages(taskId: string): number;
    countQueuedChatMessages(taskId: string): number;
  }
}

const CHAT_COLS = 'id, task_id, role, content, result_run_id, status, created_at';

function rowToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    task_id: row.task_id,
    role: row.role,
    content: row.content,
    result_run_id: row.result_run_id,
    status: row.status,
    created_at: row.created_at,
  };
}

Db.prototype.insertChatMessage = function (
  taskId: string,
  role: string,
  content: string,
  status: string,
): ChatMessage {
  const db = this.connect();
    const id = uuidv4();
    const ts = nowIso();
    db.prepare(
      'INSERT INTO chat_messages (id, task_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, taskId, role, content, status, ts);
    return {
      id,
      task_id: taskId,
      role,
      content,
      result_run_id: null,
      status,
      created_at: ts,
    };
};

Db.prototype.getChatMessages = function (taskId: string): ChatMessage[] {
  const db = this.connect();
    const rows = db
      .prepare(
        `SELECT ${CHAT_COLS} FROM chat_messages WHERE task_id = ? ORDER BY created_at ASC`,
      )
      .all(taskId) as any[];
    return rows.map(rowToChatMessage);
};

Db.prototype.getNextQueuedChatMessage = function (
  taskId: string,
): ChatMessage | null {
  const db = this.connect();
    const row = db
      .prepare(
        `SELECT ${CHAT_COLS} FROM chat_messages WHERE task_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      )
      .get(taskId) as any | undefined;
    return row ? rowToChatMessage(row) : null;
};

Db.prototype.updateChatMessageStatus = function (
  id: string,
  status: string,
  resultRunId?: string,
): void {
  const db = this.connect();
    db.prepare(
      'UPDATE chat_messages SET status = ?, result_run_id = ? WHERE id = ?',
    ).run(status, resultRunId ?? null, id);
};

Db.prototype.deleteQueuedChatMessages = function (taskId: string): number {
  const db = this.connect();
    const result = db
      .prepare("DELETE FROM chat_messages WHERE task_id = ? AND status = 'queued'")
      .run(taskId);
    return result.changes;
};

Db.prototype.countQueuedChatMessages = function (taskId: string): number {
  const db = this.connect();
    const row = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM chat_messages WHERE task_id = ? AND status = 'queued'",
      )
      .get(taskId) as { cnt: number };
    return row.cnt;
};
