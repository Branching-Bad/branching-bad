import cron, { type ScheduledTask } from 'node-cron';
import type { AppState } from '../state.js';
import { startWorkflowRun } from './orchestrator.js';

export class WorkflowScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private running = new Set<string>();

  constructor(private readonly state: AppState) {}

  init(): void {
    const all = this.state.db.listCronEnabledWorkflows();
    for (const wf of all) this.register(wf.id);
  }

  refresh(workflowId: string): void {
    this.unregister(workflowId);
    const wf = this.state.db.getWorkflow(workflowId);
    if (!wf) return;
    if (wf.cron_enabled && wf.cron) this.register(workflowId);
  }

  private register(workflowId: string): void {
    const wf = this.state.db.getWorkflow(workflowId);
    if (!wf || !wf.cron) return;
    if (!cron.validate(wf.cron)) {
      console.warn(`[workflow] invalid cron for ${workflowId}: ${wf.cron}`);
      return;
    }
    const task = cron.schedule(wf.cron, async () => {
      if (this.running.has(workflowId)) {
        console.warn(`[workflow] cron tick skipped, previous run still active: ${workflowId}`);
        return;
      }
      this.running.add(workflowId);
      try {
        await startWorkflowRun(this.state, { workflowId, trigger: 'cron' });
      } catch (err) {
        console.error(`[workflow] cron run failed for ${workflowId}:`, err);
      } finally {
        this.running.delete(workflowId);
      }
    });
    this.tasks.set(workflowId, task);
  }

  private unregister(workflowId: string): void {
    const t = this.tasks.get(workflowId);
    if (t) { t.stop(); this.tasks.delete(workflowId); }
  }

  stopAll(): void {
    for (const t of this.tasks.values()) t.stop();
    this.tasks.clear();
  }
}
