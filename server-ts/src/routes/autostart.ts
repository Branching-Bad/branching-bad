import type { AppState } from '../state.js';
import { processAutostartJob, sleep } from './autostartWorker.js';

const POLL_INTERVAL_MS = 700;
const ERROR_BACKOFF_MS = 2000;

export function spawnAutostartWorker(state: AppState): void {
  async function loop(): Promise<void> {
    while (true) {
      try {
        const job = state.db.claimNextPendingAutostartJob();
        if (!job) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        try {
          await processAutostartJob(state, job);
        } catch (error) {
          const msg = `worker internal error: ${error instanceof Error ? error.message : String(error)}`;
          try {
            state.db.failAutostartJob(job.id, msg);
          } catch {
            // Ignore
          }
          console.error(`autostart worker error: ${msg}`);
        }
      } catch (error) {
        console.error(`autostart queue poll failed: ${error}`);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  setImmediate(() => {
    loop().catch((err) => console.error('autostart worker crashed:', err));
  });
}
