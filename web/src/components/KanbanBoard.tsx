import { useState } from "react";
import type { Task, LaneKey, AgentProfile, TaskRunState } from "../types";
import { api } from "../api";
import { IconPlus, IconGitBranch } from "./icons";
import { formatDate, laneMeta, laneFromStatus } from "./shared";

export function KanbanBoard({
  groupedTasks,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  selectedRepoId,
  statusFromLane,
  setTasks,
  onError,
  agentProfiles,
  taskRunStates,
}: {
  groupedTasks: Record<LaneKey, Task[]>;
  selectedTaskId: string;
  onSelectTask: (taskId: string) => void;
  onCreateTask: () => void;
  selectedRepoId: string;
  statusFromLane: (lane: LaneKey) => string;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onError: (msg: string) => void;
  agentProfiles: AgentProfile[];
  taskRunStates?: Record<string, TaskRunState>;
}) {
  const [dragOverLane, setDragOverLane] = useState<LaneKey | null>(null);
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, lane: LaneKey) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverLane(lane);
  }

  function handleDragLeave() {
    setDragOverLane(null);
  }

  async function handleDrop(e: React.DragEvent, lane: LaneKey) {
    e.preventDefault();
    setDragOverLane(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    const allTasks = Object.values(groupedTasks).flat();
    const task = allTasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentLane = laneFromStatus(task.status);
    if (currentLane === lane) return;

    if (lane === "archived" && currentLane !== "done") {
      onError("Only completed tasks can be archived.");
      return;
    }
    if (currentLane === "archived" && lane !== "todo") {
      onError("Archived tasks can only be restored to To Do.");
      return;
    }

    const newStatus = statusFromLane(lane);

    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus } : t));

    try {
      await api(`/api/tasks/${taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err) {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: task.status } : t));
      onError((err as Error).message);
    }
  }

  const tasks = Object.values(groupedTasks).flat();

  return (
    <section className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">Board</h2>
        <span className="text-xs text-text-muted">{tasks.length} tasks</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {laneMeta.filter((l) => l.key !== "archived").map((lane) => (
          <div
            key={lane.key}
            className={`min-h-[240px] rounded-2xl border p-3 transition-colors ${
              dragOverLane === lane.key
                ? "border-brand bg-brand-tint/30"
                : "border-border-default bg-surface-100"
            }`}
            onDragOver={(e) => handleDragOver(e, lane.key)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => void handleDrop(e, lane.key)}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${lane.dot}`} />
                <h3 className="text-xs font-medium text-text-secondary">{lane.title}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-surface-300 px-2 py-0.5 text-[11px] text-text-muted">
                  {groupedTasks[lane.key].length}
                </span>
                {selectedRepoId && lane.key === "todo" && (
                  <button
                    onClick={onCreateTask}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-300 hover:text-text-primary"
                    title="Add task"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {groupedTasks[lane.key].map((task) => (
                <button
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onClick={() => onSelectTask(task.id)}
                  className={`group w-full rounded-xl border p-3 text-left transition cursor-grab active:cursor-grabbing ${
                    task.id === selectedTaskId
                      ? "border-brand/50 bg-brand-tint"
                      : "border-border-default bg-surface-200 hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${task.id === selectedTaskId ? "text-brand" : "text-text-muted"}`}>
                      {task.jira_issue_key}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {task.agent_profile_id && (() => {
                        const p = agentProfiles.find((ap) => ap.id === task.agent_profile_id);
                        return p ? (
                          <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400" title={`${p.agent_name} / ${p.model}`}>
                            {p.agent_name}/{p.model}
                          </span>
                        ) : null;
                      })()}
                      {task.priority && (
                        <span className="text-[10px] text-text-muted">{task.priority}</span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-sm leading-snug text-text-primary">{task.title}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {task.pr_url && (
                      <a
                        href={task.pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400 hover:underline"
                        title={`PR #${task.pr_number}`}
                      >
                        PR #{task.pr_number}
                      </a>
                    )}
                    {(() => {
                      const trs = taskRunStates?.[task.id];
                      const branch = trs?.activeRun?.branch_name;
                      return branch ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-surface-300 px-1.5 py-0.5 text-[10px] text-text-muted" title={branch}>
                          <IconGitBranch className="h-2.5 w-2.5" />
                          <span className="max-w-[80px] truncate">{branch}</span>
                        </span>
                      ) : null;
                    })()}
                    <span className="text-[11px] text-text-muted">{formatDate(task.updated_at)}</span>
                  </div>
                </button>
              ))}
              {groupedTasks[lane.key].length === 0 && (
                <p className="py-4 text-center text-xs text-text-muted">No items</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Archive Lane */}
      <div
        className={`mt-4 rounded-2xl border p-3 transition-colors ${
          dragOverLane === "archived"
            ? "border-brand bg-brand-tint/30"
            : "border-border-default bg-surface-100"
        }`}
        onDragOver={(e) => handleDragOver(e, "archived")}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e, "archived")}
      >
        <button
          type="button"
          onClick={() => setArchiveExpanded((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-text-muted" />
            <h3 className="text-xs font-medium text-text-secondary">Archive</h3>
            <span className="rounded-full bg-surface-300 px-2 py-0.5 text-[11px] text-text-muted">
              {groupedTasks.archived.length}
            </span>
          </div>
          <svg className={`h-4 w-4 text-text-muted transition-transform ${archiveExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {archiveExpanded && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {groupedTasks.archived.map((task) => (
              <button
                key={task.id}
                draggable
                onDragStart={(e) => handleDragStart(e, task.id)}
                onClick={() => onSelectTask(task.id)}
                className={`group w-full rounded-xl border p-3 text-left transition cursor-grab active:cursor-grabbing opacity-60 ${
                  task.id === selectedTaskId
                    ? "border-brand/50 bg-brand-tint"
                    : "border-border-default bg-surface-200 hover:border-border-strong"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-medium ${task.id === selectedTaskId ? "text-brand" : "text-text-muted"}`}>
                    {task.jira_issue_key}
                  </span>
                  {task.priority && (
                    <span className="text-[10px] text-text-muted">{task.priority}</span>
                  )}
                </div>
                <p className="mt-1.5 text-sm leading-snug text-text-primary">{task.title}</p>
                <p className="mt-2 text-[11px] text-text-muted">{formatDate(task.updated_at)}</p>
              </button>
            ))}
            {groupedTasks.archived.length === 0 && (
              <p className="py-4 text-center text-xs text-text-muted col-span-full">No archived items</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
