import { ChildProcess } from 'child_process';
import treeKill from 'tree-kill';
import type { Db } from './db/index.js';
import type { MsgStore } from './msgStore.js';
import { handleChildExit } from './exitHandler.js';

export { recoverOrphans } from './exitHandler.js';

const POLL_INTERVAL_MS = 250;
const KILL_ESCALATION_MS = 2000;

export class ProcessManager {
  private stores = new Map<string, MsgStore>();
  private children = new Map<string, ChildProcess>();
  private monitors = new Map<string, NodeJS.Timeout>();

  registerStore(runId: string, store: MsgStore): void {
    this.stores.set(runId, store);
  }

  attachChild(runId: string, child: ChildProcess): void {
    this.children.set(runId, child);
  }

  getStore(runId: string): MsgStore | undefined {
    return this.stores.get(runId);
  }

  killProcess(runId: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child || child.pid == null) {
      return Promise.resolve(false);
    }

    const pid = child.pid;

    // On Windows, signal escalation is meaningless — tree-kill maps
    // SIGTERM to `taskkill /pid /T /F` which forcefully kills the tree.
    if (process.platform === 'win32') {
      return new Promise<boolean>((resolve) => {
        treeKill(pid, 'SIGTERM', (err) => {
          resolve(!err);
        });
      });
    }

    return new Promise<boolean>((resolve) => {
      // Stage 1: SIGINT via tree-kill
      treeKill(pid, 'SIGINT', (err) => {
        if (err) {
          resolve(false);
          return;
        }

        setTimeout(() => {
          if (child.exitCode !== null) {
            resolve(true);
            return;
          }

          // Stage 2: SIGTERM via tree-kill
          treeKill(pid, 'SIGTERM', () => {
            setTimeout(() => {
              if (child.exitCode !== null) {
                resolve(true);
                return;
              }

              // Stage 3: SIGKILL via tree-kill
              treeKill(pid, 'SIGKILL', () => {
                resolve(true);
              });
            }, KILL_ESCALATION_MS);
          });
        }, KILL_ESCALATION_MS);
      });
    });
  }

  spawnExitMonitor(
    runId: string,
    taskId: string,
    _repoPath: string,
    workingDir: string,
    baseSha: string | null,
    db: Db,
  ): void {
    const child = this.children.get(runId);
    if (!child) return;

    const onExit = (exitCode: number | null) => {
      const timer = this.monitors.get(runId);
      if (timer) {
        clearInterval(timer);
        this.monitors.delete(runId);
      }

      handleChildExit(runId, taskId, workingDir, baseSha, exitCode, db, this.stores.get(runId));
      this.children.delete(runId);
    };

    // Listen for exit event directly
    child.on('exit', onExit);

    // Also poll as a fallback in case 'exit' is missed
    const timer = setInterval(() => {
      if (child.exitCode !== null) {
        child.removeListener('exit', onExit);
        clearInterval(timer);
        this.monitors.delete(runId);
        handleChildExit(
          runId, taskId, workingDir, baseSha, child.exitCode, db, this.stores.get(runId),
        );
        this.children.delete(runId);
      }
    }, POLL_INTERVAL_MS);

    this.monitors.set(runId, timer);
  }
}
