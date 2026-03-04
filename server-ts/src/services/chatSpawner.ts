import { MsgStore } from '../msgStore.js';
import type { AppState } from '../state.js';
import { spawnResumeRun } from './agentSpawner.js';

interface SpawnChatParams {
  agentCommand: string;
  prompt: string;
  displayContent: string;
  agentWorkingDir: string;
  sessionId: string | null;
  baseSha: string | null;
  runId: string;
  taskId: string;
  repoPath: string;
  startMessage: string;
}

export function spawnChatFollowUp(state: AppState, params: SpawnChatParams): void {
  const store = new MsgStore();
  state.processManager.registerStore(params.runId, store);

  setImmediate(async () => {
    store.push({ type: 'turn_separator', data: '' });
    store.push({ type: 'user_message', data: params.displayContent });
    store.push({ type: 'agent_text', data: params.startMessage });
    await spawnResumeRun(
      params.agentCommand,
      params.prompt,
      params.agentWorkingDir,
      params.sessionId,
      params.runId,
      params.taskId,
      params.repoPath,
      params.baseSha,
      state.db,
      state.processManager,
      store,
      { command: params.agentCommand, isChatFollowUp: true },
    );
  });
}
