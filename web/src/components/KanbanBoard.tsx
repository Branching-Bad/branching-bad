import { useState } from "react";
import type { Task, LaneKey, AgentProfile, TaskRunState } from "../types";
import { api } from "../api";
import { IconPlus, IconGitBranch } from "./icons";
import { formatDate, laneMeta, laneFromStatus } from "./shared";

/* ── Lane visual config ── */
const laneStyle: Record<string, { accent: string; accentSoft: string; dotBg: string; badgeBg: string; badgeText: string }> = {
  todo:       { accent: "text-text-muted",   accentSoft: "rgba(137,137,137,0.06)", dotBg: "bg-text-muted",   badgeBg: "bg-surface-300",        badgeText: "text-text-muted" },
  inprogress: { accent: "text-brand",        accentSoft: "rgba(62,207,142,0.06)",  dotBg: "bg-brand",        badgeBg: "bg-brand/10",           badgeText: "text-brand" },
  inreview:   { accent: "text-info-text",    accentSoft: "rgba(96,165,250,0.06)",  dotBg: "bg-info-text",    badgeBg: "bg-info-text/10",       badgeText: "text-info-text" },
  done:       { accent: "text-brand",        accentSoft: "rgba(62,207,142,0.06)",  dotBg: "bg-brand",        badgeBg: "bg-brand/10",           badgeText: "text-brand" },
  archived:   { accent: "text-text-muted",   accentSoft: "rgba(137,137,137,0.06)", dotBg: "bg-text-muted",   badgeBg: "bg-surface-300",        badgeText: "text-text-muted" },
};

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

  const activeLanes = laneMeta.filter((l) => l.key !== "archived");

  return (
    <section className="space-y-5">
      {/* ── Kanban columns ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {activeLanes.map((lane) => {
          const style = laneStyle[lane.key] ?? laneStyle.todo;
          const isDragOver = dragOverLane === lane.key;
          return (
            <div
              key={lane.key}
              className={`group/lane relative min-h-[260px] rounded-[22px] border p-3.5 transition-all duration-200 ${
                isDragOver
                  ? "border-brand/60 bg-brand/5 shadow-[0_0_24px_rgba(62,207,142,0.08)]"
                  : "border-border-default bg-surface-100/60 backdrop-blur-sm"
              }`}
              onDragOver={(e) => handleDragOver(e, lane.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => void handleDrop(e, lane.key)}
            >
              {/* Lane header */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${style.dotBg} ring-2 ring-surface-100/80`} />
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${style.accent}`}>{lane.title}</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-[11px] font-bold tabular-nums ${style.badgeBg} ${style.badgeText}`}>
                    {groupedTasks[lane.key].length}
                  </span>
                  {selectedRepoId && lane.key === "todo" && (
                    <button
                      onClick={onCreateTask}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-border-default text-text-muted transition-all hover:border-brand/40 hover:bg-brand/10 hover:text-brand"
                      title="Add task"
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Task cards */}
              <div className="space-y-2">
                {groupedTasks[lane.key].map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    selected={task.id === selectedTaskId}
                    agentProfiles={agentProfiles}
                    taskRunState={taskRunStates?.[task.id]}
                    onSelect={() => onSelectTask(task.id)}
                    onDragStart={(e) => handleDragStart(e, task.id)}
                  />
                ))}
                {groupedTasks[lane.key].length === 0 && (
                  <div className="flex min-h-[100px] items-center justify-center rounded-2xl border border-dashed border-border-default">
                    <p className="text-xs text-text-muted">No items</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Archive lane ── */}
      <div
        className={`rounded-[22px] border p-3.5 transition-all duration-200 ${
          dragOverLane === "archived"
            ? "border-brand/60 bg-brand/5"
            : "border-border-default bg-surface-100/60 backdrop-blur-sm"
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
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-text-muted ring-2 ring-surface-100/80" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Archive</h3>
            <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-surface-300 px-2 text-[11px] font-bold tabular-nums text-text-muted">
              {groupedTasks.archived.length}
            </span>
          </div>
          <svg className={`h-4 w-4 text-text-muted transition-transform duration-200 ${archiveExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {archiveExpanded && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {groupedTasks.archived.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId}
                agentProfiles={agentProfiles}
                taskRunState={taskRunStates?.[task.id]}
                onSelect={() => onSelectTask(task.id)}
                onDragStart={(e) => handleDragStart(e, task.id)}
                dimmed
              />
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

/* ── Task Card ── */
function TaskCard({
  task, selected, agentProfiles, taskRunState, onSelect, onDragStart, dimmed,
}: {
  task: Task;
  selected: boolean;
  agentProfiles: AgentProfile[];
  taskRunState?: TaskRunState;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  dimmed?: boolean;
}) {
  const profile = task.agent_profile_id ? agentProfiles.find((ap) => ap.id === task.agent_profile_id) : null;
  const branch = taskRunState?.activeRun?.branch_name;
  const isRunning = !!taskRunState?.activeRun;

  return (
    <button
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      className={`group relative w-full rounded-2xl border p-3.5 text-left transition-all duration-150 cursor-grab active:cursor-grabbing ${dimmed ? "opacity-50" : ""} ${
        selected
          ? "border-brand/40 bg-brand/8 shadow-[0_0_0_1px_rgba(62,207,142,0.15),0_4px_16px_rgba(62,207,142,0.06)]"
          : "border-border-default bg-surface-200/80 hover:border-border-strong hover:bg-surface-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
      }`}
    >
      {/* Running indicator pulse */}
      {isRunning && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-50" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
        </span>
      )}

      {/* Header row */}
      <div className="flex items-center gap-2">
        {task.jira_issue_key && (
          <span className={`text-[11px] font-semibold tracking-wide ${selected ? "text-brand" : "text-text-muted"}`}>
            {task.jira_issue_key}
          </span>
        )}
        {task.priority && (
          <span className="rounded-full bg-surface-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
            {task.priority}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="mt-1.5 text-[13px] font-medium leading-snug text-text-primary line-clamp-2">{task.title}</p>

      {/* Footer badges */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {profile && (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-400" title={`${profile.agent_name} / ${profile.model}`}>
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            {profile.agent_name}
          </span>
        )}
        {task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-full bg-status-info-soft px-2 py-0.5 text-[10px] font-medium text-status-info transition hover:bg-status-info/20"
            title={`PR #${task.pr_number}`}
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="currentColor"><path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" /></svg>
            #{task.pr_number}
          </a>
        )}
        {branch && (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-300/80 px-2 py-0.5 text-[10px] text-text-muted" title={branch}>
            <IconGitBranch className="h-2.5 w-2.5" />
            <span className="max-w-[72px] truncate">{branch}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-text-muted">{formatDate(task.updated_at)}</span>
      </div>
    </button>
  );
}
