import { EventEmitter } from 'events';

const MAX_HISTORY_BYTES = 50 * 1024 * 1024; // 50 MB

export type LogMsg =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'thinking'; data: string }
  | { type: 'agent_text'; data: string }
  | { type: 'tool_use'; data: string }
  | { type: 'tool_result'; data: string }
  | { type: 'finished'; data: string }
  | { type: 'user_message'; data: string }
  | { type: 'turn_separator'; data: '' };

export class MsgStore {
  private history: LogMsg[] = [];
  private historyBytes = 0;
  private emitter = new EventEmitter();
  private _sessionId: string | null = null;
  private _lastActivityAt: number = Date.now();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  push(msg: LogMsg): void {
    const size = msgByteSize(msg);
    while (this.historyBytes + size > MAX_HISTORY_BYTES && this.history.length > 0) {
      const old = this.history.shift()!;
      this.historyBytes -= msgByteSize(old);
    }
    this.historyBytes += size;
    this.history.push(msg);
    this._lastActivityAt = Date.now();
    this.emitter.emit('msg', msg);
  }

  pushStdout(line: string): void {
    this.push({ type: 'stdout', data: line });
  }

  pushStderr(line: string): void {
    this.push({ type: 'stderr', data: line });
  }

  pushFinished(exitCode: number | null, status: string): void {
    this.push({ type: 'finished', data: JSON.stringify({ exitCode, status }) });
  }

  setSessionId(id: string): void {
    this._sessionId = id;
  }

  getSessionId(): string | null {
    return this._sessionId;
  }

  getLastActivityAt(): number {
    return this._lastActivityAt;
  }

  getHistory(): LogMsg[] {
    return [...this.history];
  }

  subscribe(callback: (msg: LogMsg) => void): () => void {
    this.emitter.on('msg', callback);
    return () => {
      this.emitter.off('msg', callback);
    };
  }

  toJson(msg: LogMsg): string {
    return JSON.stringify(msg);
  }
}

function msgByteSize(msg: LogMsg): number {
  return msg.data.length + msg.type.length;
}
