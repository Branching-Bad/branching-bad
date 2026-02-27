import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { FormEvent } from "react";

/* ─── Types ─── */
type Repo = { id: string; name: string; path: string };
type JiraAccount = { id: string; base_url: string; email: string };
type JiraBoard = { id: string; board_id: string; name: string };
type AgentProfile = {
  id: string; provider: string; agent_name: string;
  model: string; command: string; source: string; discovery_kind: string;
};
type Task = {
  id: string; jira_issue_key: string; title: string;
  description: string | null; status: string; priority: string | null;
  require_plan: boolean;
  auto_start: boolean;
  auto_approve_plan: boolean;
  last_pipeline_error?: string | null;
  last_pipeline_at?: string | null;
  source?: string; updated_at: string;
};
type Plan = {
  id: string; version: number;
  status: "drafted" | "revise_requested" | "approved" | "rejected";
  plan_markdown: string;
  plan: unknown;
  tasklist: unknown;
  tasklist_schema_version: number;
  generation_mode: "manual" | "auto_pipeline" | "revise" | "direct_execution" | string;
  validation_errors?: unknown;
  created_by: string;
  created_at: string;
};
type RunEvent = { id: string; type: string; payload: unknown; created_at: string };
type RunAgent = {
  id: string;
  provider: string;
  agent_name: string;
  model: string;
};
type ActiveRun = {
  id: string;
  status: string;
  branch_name: string;
  agent?: RunAgent;
};
type RunLogEntry = { type: string; data: string };
type RunResponse = {
  run: ActiveRun;
  events: RunEvent[]; artifactPath: string;
};
type PlanJob = {
  id: string;
  task_id: string;
  mode: string;
  status: "pending" | "running" | "done" | "failed" | string;
  revision_comment?: string | null;
  plan_id?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};
type TaskRunState = {
  activeRun: ActiveRun | null;
  runLogs: RunLogEntry[];
  runFinished: boolean;
  runResult: RunResponse | null;
};
type TaskPlanState = {
  activeJob: PlanJob | null;
  planLogs: RunLogEntry[];
  planFinished: boolean;
};
type ReviewComment = {
  id: string;
  task_id: string;
  run_id: string;
  comment: string;
  status: "pending" | "processing" | "addressed";
  result_run_id: string | null;
  addressed_at: string | null;
  created_at: string;
};
type LaneKey = "todo" | "inprogress" | "inreview" | "done" | "archived";

const EMPTY_TASK_RUN_STATE: TaskRunState = {
  activeRun: null,
  runLogs: [],
  runFinished: false,
  runResult: null,
};
const EMPTY_TASK_PLAN_STATE: TaskPlanState = {
  activeJob: null,
  planLogs: [],
  planFinished: false,
};

/* ─── Helpers ─── */
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Backend is not reachable. Is the server running?");
  }
  const text = await response.text();
  if (!text) throw new Error("Empty response from server.");
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new Error("Invalid JSON response from server."); }
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? "Unexpected API error");
  return payload as T;
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function laneFromStatus(status: string): LaneKey {
  const upper = status.toUpperCase();
  if (upper === "ARCHIVED") return "archived";
  if (upper === "DONE") return "done";
  if (upper === "IN_PROGRESS") return "inprogress";
  if (upper === "FAILED") return "todo";
  if (upper === "CANCELLED") return "todo";
  if (upper === "PLAN_GENERATING" || upper === "PLAN_DRAFTED" || upper === "PLAN_APPROVED" || upper === "PLAN_REVISE_REQUESTED") return "todo";
  // Legacy / Jira status fallback
  const n = status.toLowerCase();
  if (n.includes("done")) return "done";
  if (n.includes("review")) return "inreview";
  if (n.includes("progress")) return "inprogress";
  return "todo";
}

const laneMeta: Array<{ key: LaneKey; title: string; dot: string }> = [
  { key: "todo", title: "To Do", dot: "bg-text-muted" },
  { key: "inprogress", title: "In Progress", dot: "bg-brand" },
  { key: "inreview", title: "In Review", dot: "bg-info-text" },
  { key: "done", title: "Done", dot: "bg-brand" },
  { key: "archived", title: "Archive", dot: "bg-text-muted" },
];

/* ─── Shared class constants ─── */
const inputClass =
  "w-full rounded-md border border-border-strong bg-surface-300 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none transition-colors";
const selectClass =
  "w-full rounded-md border border-border-strong bg-surface-300 px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none transition-colors appearance-none";
const btnPrimary =
  "rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-text-primary border border-brand-glow transition hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed";
const btnSecondary =
  "rounded-md bg-surface-300 px-4 py-2 text-sm font-medium text-text-primary border border-border-strong transition hover:bg-surface-200 hover:border-border-strong disabled:opacity-40 disabled:cursor-not-allowed";

/* ─── Icons (inline SVG) ─── */
function IconSettings({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.212-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconX({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function IconRefresh({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.183" />
    </svg>
  );
}

function IconPlay({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
    </svg>
  );
}

function IconPlus({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

/* ─── Folder Picker ─── */
type FsDir = { name: string; path: string; isGit: boolean };
type FsListResponse = { path: string; parent: string | null; dirs: FsDir[] };

function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<FsDir[]>([]);
  const [loading, setLoading] = useState(false);
  const [fsError, setFsError] = useState("");

  const loadDir = useCallback(async (path?: string) => {
    setLoading(true);
    setFsError("");
    try {
      const qs = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await api<FsListResponse>(`/api/fs/list${qs}`);
      setCurrentPath(res.path);
      setParentPath(res.parent);
      setDirs(res.dirs);
    } catch (e) {
      setFsError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
    void loadDir(value || undefined);
  }, [value, loadDir]);

  const handleSelect = useCallback((path: string) => {
    onChange(path);
    setOpen(false);
  }, [onChange]);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="w-full rounded-md border border-border-strong bg-surface-300 px-3 py-2 text-left text-sm transition hover:border-brand focus:border-brand focus:outline-none"
      >
        {value ? (
          <span className="flex items-center gap-2">
            <IconFolder className="h-4 w-4 shrink-0 text-brand" />
            <span className="truncate text-text-primary">{value}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-text-muted">
            <IconFolder className="h-4 w-4 shrink-0" />
            Choose folder…
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[480px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
              <h3 className="text-sm font-medium text-text-primary">Select Folder</h3>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
                <IconX className="h-4 w-4" />
              </button>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 border-b border-border-default px-5 py-2">
              <code className="truncate text-xs text-text-secondary">{currentPath}</code>
            </div>

            {/* Error */}
            {fsError && (
              <div className="mx-5 mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
                {fsError}
              </div>
            )}

            {/* Dir listing */}
            <div className="max-h-[320px] overflow-y-auto px-2 py-2">
              {/* Go up */}
              {parentPath && (
                <button
                  onClick={() => void loadDir(parentPath)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-text-secondary transition hover:bg-surface-300"
                >
                  <IconChevronUp className="h-4 w-4 shrink-0 text-text-muted" />
                  <span>..</span>
                </button>
              )}

              {loading ? (
                <div className="py-8 text-center text-xs text-text-muted">Loading…</div>
              ) : dirs.length === 0 ? (
                <div className="py-8 text-center text-xs text-text-muted">No subdirectories</div>
              ) : (
                dirs.map((dir) => (
                  <div key={dir.path} className="group flex items-center rounded-lg transition hover:bg-surface-300">
                    <button
                      onClick={() => void loadDir(dir.path)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left"
                    >
                      <IconFolder className={`h-4 w-4 shrink-0 ${dir.isGit ? "text-brand" : "text-text-muted"}`} />
                      <span className="truncate text-sm text-text-primary">{dir.name}</span>
                      {dir.isGit && (
                        <span className="ml-auto shrink-0 rounded-full border border-brand/30 bg-brand-tint px-1.5 py-0.5 text-[10px] text-brand">
                          git
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => handleSelect(dir.path)}
                      className="mr-2 shrink-0 rounded-md border border-brand-glow bg-brand-dark px-2 py-1 text-[11px] font-medium text-brand opacity-0 transition group-hover:opacity-100"
                    >
                      Select
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Footer: select current dir */}
            <div className="flex items-center justify-between border-t border-border-default px-5 py-3">
              <span className="truncate text-xs text-text-muted">{currentPath}</span>
              <button
                onClick={() => handleSelect(currentPath)}
                className={`${btnPrimary} !py-1.5 !px-3 text-xs`}
              >
                Select This Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function IconFolder({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  );
}

function IconChevronUp({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}

/* ─── Log Entry Component ─── */
function LogEntry({ type, data }: { type: string; data: string }) {
  const [expanded, setExpanded] = useState(false);

  if (type === "thinking") {
    return (
      <div className="group">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 text-left text-purple-400/80 hover:text-purple-300 transition"
        >
          <svg className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          <span className="font-medium text-[11px] uppercase tracking-wide">Thinking</span>
          {!expanded && <span className="truncate text-purple-400/50 font-mono">{data.slice(0, 120)}{data.length > 120 ? "..." : ""}</span>}
        </button>
        {expanded && (
          <pre className="mt-1 ml-4.5 whitespace-pre-wrap text-purple-300/70 font-mono border-l-2 border-purple-500/20 pl-3">{data}</pre>
        )}
      </div>
    );
  }

  if (type === "agent_text") {
    return (
      <div className="text-blue-300 font-mono whitespace-pre-wrap">{data}</div>
    );
  }

  if (type === "tool_use") {
    let tool = data, input = "";
    try {
      const parsed = JSON.parse(data);
      tool = parsed.tool || "tool";
      input = parsed.input || "";
    } catch { /* raw string */ }
    return (
      <div className="flex items-start gap-2 text-amber-400/90">
        <svg className="h-3.5 w-3.5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743" />
        </svg>
        <div className="min-w-0">
          <span className="font-semibold">{tool}</span>
          {input && <pre className="mt-0.5 text-amber-400/50 truncate max-w-full">{input.slice(0, 200)}</pre>}
        </div>
      </div>
    );
  }

  if (type === "tool_result") {
    let tool = "result", output = data;
    try {
      const parsed = JSON.parse(data);
      tool = parsed.tool || "result";
      output = parsed.output || "";
    } catch { /* raw string */ }
    return (
      <div className="text-emerald-400/70 ml-5">
        <span className="text-[10px] uppercase tracking-wider text-emerald-500/50">{tool} result</span>
        {output && <pre className="whitespace-pre-wrap truncate max-h-[80px] overflow-hidden font-mono">{output.slice(0, 300)}</pre>}
      </div>
    );
  }

  if (type === "stderr") {
    return <div className="text-red-400 font-mono whitespace-pre-wrap">{data}</div>;
  }

  if (type === "stdout") {
    return <div className="text-green-400 font-mono whitespace-pre-wrap">{data}</div>;
  }

  if (type === "db_event") {
    let eventType = "event";
    let detail = data;
    try {
      const parsed = JSON.parse(data) as { type?: string; payload?: unknown };
      eventType = parsed.type ?? "event";
      if (
        parsed.payload &&
        typeof parsed.payload === "object" &&
        "message" in (parsed.payload as Record<string, unknown>) &&
        typeof (parsed.payload as Record<string, unknown>).message === "string"
      ) {
        detail = String((parsed.payload as Record<string, unknown>).message);
      } else if (parsed.payload !== undefined) {
        detail = JSON.stringify(parsed.payload);
      }
    } catch {
      // fallback to raw event text
    }
    return (
      <div className="text-slate-400 font-mono whitespace-pre-wrap">
        <span className="text-slate-500 uppercase text-[10px] tracking-wider mr-2">{eventType}</span>
        {detail}
      </div>
    );
  }

  // other
  return <div className="text-gray-500 font-mono">{data}</div>;
}

/* ─── Settings Modal ─── */
function SettingsModal({
  open, onClose, repos, accounts, boards, agentProfiles,
  selectedRepoId, setSelectedRepoId, selectedAccountId, setSelectedAccountId,
  selectedBoardId, setSelectedBoardId, selectedProfileId, setSelectedProfileId,
  selectedProfile, busy, error: extError, info: extInfo,
  onRepoSubmit, onConnectJira, bindBoard, discoverAgents, saveAgentSelection,
  repoPath, setRepoPath, repoName, setRepoName,
  jiraBaseUrl, setJiraBaseUrl, jiraEmail, setJiraEmail, jiraToken, setJiraToken,
}: {
  open: boolean; onClose: () => void;
  repos: Repo[]; accounts: JiraAccount[]; boards: JiraBoard[]; agentProfiles: AgentProfile[];
  selectedRepoId: string; setSelectedRepoId: (v: string) => void;
  selectedAccountId: string; setSelectedAccountId: (v: string) => void;
  selectedBoardId: string; setSelectedBoardId: (v: string) => void;
  selectedProfileId: string; setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean; error: string; info: string;
  onRepoSubmit: (e: FormEvent) => void;
  onConnectJira: (e: FormEvent) => void;
  bindBoard: () => void;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
  repoPath: string; setRepoPath: (v: string) => void;
  repoName: string; setRepoName: (v: string) => void;
  jiraBaseUrl: string; setJiraBaseUrl: (v: string) => void;
  jiraEmail: string; setJiraEmail: (v: string) => void;
  jiraToken: string; setJiraToken: (v: string) => void;
}) {
  const [tab, setTab] = useState<"repo" | "jira" | "agent">("repo");

  if (!open) return null;

  const tabs = [
    { key: "repo" as const, label: "Repository" },
    { key: "jira" as const, label: "Jira" },
    { key: "agent" as const, label: "AI Agent" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-[560px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h2 className="text-base font-medium text-text-primary">Settings</h2>
          <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-default px-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative px-4 py-3 text-sm font-medium transition ${
                tab === t.key
                  ? "text-brand"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t.label}
              {tab === t.key && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />
              )}
            </button>
          ))}
        </div>

        {/* Alerts */}
        <div className="px-6 pt-4">
          {extError && (
            <div className="mb-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error-text">
              {extError}
            </div>
          )}
          {extInfo && (
            <div className="mb-3 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">
              {extInfo}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="max-h-[420px] overflow-y-auto px-6 pb-6">
          {tab === "repo" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Active Repository</label>
                <select className={selectClass} value={selectedRepoId} onChange={(e) => setSelectedRepoId(e.target.value)}>
                  <option value="">Select repo</option>
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.id}>{repo.name}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl border border-border-default bg-surface-200 p-4">
                <h3 className="mb-3 text-sm font-medium text-text-secondary">Add New Repository</h3>
                <form onSubmit={onRepoSubmit} className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs text-text-muted">Folder</label>
                    <FolderPicker value={repoPath} onChange={setRepoPath} />
                  </div>
                  <input className={inputClass} placeholder="Label (optional)" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
                  <button type="submit" disabled={busy || !repoPath} className={btnPrimary}>Save Repository</button>
                </form>
              </div>
            </div>
          )}

          {tab === "jira" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border-default bg-surface-200 p-4">
                <h3 className="mb-3 text-sm font-medium text-text-secondary">Connect Jira Account</h3>
                <form onSubmit={onConnectJira} className="space-y-3">
                  <input className={inputClass} placeholder="https://company.atlassian.net" value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} />
                  <input className={inputClass} placeholder="email@company.com" value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} />
                  <input className={inputClass} placeholder="API token" type="password" value={jiraToken} onChange={(e) => setJiraToken(e.target.value)} />
                  <button type="submit" disabled={busy} className={btnPrimary}>Connect</button>
                </form>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Account</label>
                <select className={selectClass} value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)}>
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Board</label>
                <select className={selectClass} value={selectedBoardId} onChange={(e) => setSelectedBoardId(e.target.value)}>
                  <option value="">Select board</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <button onClick={bindBoard} disabled={busy} className={btnPrimary}>
                Bind Repo to Board
              </button>
            </div>
          )}

          {tab === "agent" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Agent / Model</label>
                <select className={selectClass} value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                  <option value="">Select agent/model</option>
                  {agentProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{`${p.agent_name} \u00B7 ${p.model}`}</option>
                  ))}
                </select>
                {selectedProfile && (
                  <p className="mt-2 text-xs text-text-muted">
                    {selectedProfile.provider} &middot; <code className="text-text-secondary">{selectedProfile.command}</code>
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={saveAgentSelection} disabled={busy} className={btnPrimary}>Save for Repo</button>
                <button onClick={discoverAgents} disabled={busy} className={btnSecondary}>
                  <span className="flex items-center gap-1.5">
                    <IconRefresh className="h-3.5 w-3.5" />
                    Discover
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateTaskModal({
  open,
  onClose,
  busy,
  title,
  setTitle,
  description,
  setDescription,
  priority,
  setPriority,
  requirePlan,
  setRequirePlan,
  autoApprovePlan,
  setAutoApprovePlan,
  autoStart,
  setAutoStart,
  onCreate,
  repoName,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  priority: string;
  setPriority: (v: string) => void;
  requirePlan: boolean;
  setRequirePlan: (v: boolean) => void;
  autoApprovePlan: boolean;
  setAutoApprovePlan: (v: boolean) => void;
  autoStart: boolean;
  setAutoStart: (v: boolean) => void;
  onCreate: () => void;
  repoName: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[520px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <div>
            <h3 className="text-base font-medium text-text-primary">Create Task</h3>
            <p className="mt-1 text-xs text-text-muted">This task will be added to To Do in {repoName}.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void onCreate(); }}
          className="space-y-3 px-6 py-5"
        >
          <input
            autoFocus
            className={inputClass}
            placeholder="Task title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className={`${inputClass} min-h-[92px] resize-none`}
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select
            className={selectClass}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Priority (optional)</option>
            <option value="Highest">Highest</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
            <option value="Lowest">Lowest</option>
          </select>

          <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={requirePlan}
              onChange={(e) => setRequirePlan(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
            />
            Require plan approval before execution
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={autoApprovePlan}
              onChange={(e) => setAutoApprovePlan(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
            />
            Auto Approve Plan
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
            />
            {requirePlan
              ? (autoApprovePlan
                  ? "Autostart (auto approve + run)"
                  : "Autostart (generate plan+tasklist, wait for approval)")
              : "Autostart (direct run)"}
          </label>

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>
              Create in To Do
            </button>
            <button type="button" onClick={onClose} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditTaskModal({
  open,
  onClose,
  busy,
  title,
  setTitle,
  description,
  setDescription,
  priority,
  setPriority,
  requirePlan,
  setRequirePlan,
  autoApprovePlan,
  setAutoApprovePlan,
  autoStart,
  setAutoStart,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  priority: string;
  setPriority: (v: string) => void;
  requirePlan: boolean;
  setRequirePlan: (v: boolean) => void;
  autoApprovePlan: boolean;
  setAutoApprovePlan: (v: boolean) => void;
  autoStart: boolean;
  setAutoStart: (v: boolean) => void;
  onSave: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[520px] rounded-2xl border border-border-default bg-surface-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h3 className="text-base font-medium text-text-primary">Edit Task</h3>
          <button onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void onSave(); }}
          className="space-y-3 px-6 py-5"
        >
          <input
            autoFocus
            className={inputClass}
            placeholder="Task title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className={`${inputClass} min-h-[92px] resize-none`}
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select
            className={selectClass}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Priority (optional)</option>
            <option value="Highest">Highest</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
            <option value="Lowest">Lowest</option>
          </select>
          <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={requirePlan}
              onChange={(e) => setRequirePlan(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
            />
            Require plan approval before execution
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={autoApprovePlan}
              onChange={(e) => setAutoApprovePlan(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
            />
            Auto Approve Plan
          </label>
          <label className="flex items-center gap-2 rounded-md border border-border-default bg-surface-200 px-3 py-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface-300 accent-brand"
            />
            {requirePlan
              ? (autoApprovePlan
                  ? "Autostart (auto approve + run)"
                  : "Autostart (generate plan+tasklist, wait for approval)")
              : "Autostart (direct run)"}
          </label>

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>
              Save
            </button>
            <button type="button" onClick={onClose} className={btnSecondary}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Main App
   ═══════════════════════════════════════════════ */
export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [accounts, setAccounts] = useState<JiraAccount[]>([]);
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");

  const [repoPath, setRepoPath] = useState("");
  const [repoName, setRepoName] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [planComment, setPlanComment] = useState("");

  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskRunStates, setTaskRunStates] = useState<Record<string, TaskRunState>>({});
  const [taskPlanStates, setTaskPlanStates] = useState<Record<string, TaskPlanState>>({});
  const logContainerRef = useRef<HTMLDivElement>(null);
  const planLogContainerRef = useRef<HTMLDivElement>(null);
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const planEventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const runTaskIndexRef = useRef<Map<string, string>>(new Map());
  const planJobTaskIndexRef = useRef<Map<string, string>>(new Map());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTab, setDetailsTab] = useState<"plan" | "tasklist" | "run" | "review">("plan");
  const [createTaskModalOpen, setCreateTaskModalOpen] = useState(false);
  const [editTaskModalOpen, setEditTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("");
  const [newTaskRequirePlan, setNewTaskRequirePlan] = useState(true);
  const [newTaskAutoApprovePlan, setNewTaskAutoApprovePlan] = useState(false);
  const [newTaskAutoStart, setNewTaskAutoStart] = useState(false);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState("");
  const [editTaskRequirePlan, setEditTaskRequirePlan] = useState(true);
  const [editTaskAutoApprovePlan, setEditTaskAutoApprovePlan] = useState(false);
  const [editTaskAutoStart, setEditTaskAutoStart] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [manualPlanMarkdown, setManualPlanMarkdown] = useState("");
  const [manualPlanJsonText, setManualPlanJsonText] = useState("");
  const [manualTasklistJsonText, setManualTasklistJsonText] = useState("");
  const [tasklistValidationError, setTasklistValidationError] = useState("");

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedTaskId) ?? null, [tasks, selectedTaskId]);
  const latestPlan = plans[0] ?? null;
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? latestPlan,
    [plans, selectedPlanId, latestPlan],
  );
  const approvedPlan = useMemo(
    () => plans.find((plan) => plan.status === "approved") ?? null,
    [plans],
  );
  const taskRequiresPlan = selectedTask?.require_plan ?? true;
  const selectedTaskRunState = selectedTaskId
    ? (taskRunStates[selectedTaskId] ?? EMPTY_TASK_RUN_STATE)
    : EMPTY_TASK_RUN_STATE;
  const selectedTaskPlanState = selectedTaskId
    ? (taskPlanStates[selectedTaskId] ?? EMPTY_TASK_PLAN_STATE)
    : EMPTY_TASK_PLAN_STATE;
  const activeRun = selectedTaskRunState.activeRun;
  const runLogs = selectedTaskRunState.runLogs;
  const runFinished = selectedTaskRunState.runFinished;
  const runResult = selectedTaskRunState.runResult;
  const activePlanJob = selectedTaskPlanState.activeJob;
  const planLogs = selectedTaskPlanState.planLogs;
  const planFinished = selectedTaskPlanState.planFinished;
  const groupedTasks = useMemo(
    () => tasks.reduce<Record<LaneKey, Task[]>>(
      (acc, task) => { acc[laneFromStatus(task.status)].push(task); return acc; },
      { todo: [], inprogress: [], inreview: [], done: [], archived: [] },
    ),
    [tasks],
  );
  const selectedProfile = useMemo(
    () => agentProfiles.find((p) => p.id === selectedProfileId) ?? null,
    [agentProfiles, selectedProfileId],
  );
  const selectedRepo = useMemo(() => repos.find((r) => r.id === selectedRepoId) ?? null, [repos, selectedRepoId]);

  const updateTaskRunState = useCallback(
    (taskId: string, updater: (current: TaskRunState) => TaskRunState) => {
      setTaskRunStates((prev) => {
        const current = prev[taskId] ?? EMPTY_TASK_RUN_STATE;
        return { ...prev, [taskId]: updater(current) };
      });
    },
    [],
  );

  const updateTaskPlanState = useCallback(
    (taskId: string, updater: (current: TaskPlanState) => TaskPlanState) => {
      setTaskPlanStates((prev) => {
        const current = prev[taskId] ?? EMPTY_TASK_PLAN_STATE;
        return { ...prev, [taskId]: updater(current) };
      });
    },
    [],
  );

  const closeAllRunStreams = useCallback(() => {
    for (const source of eventSourcesRef.current.values()) {
      source.close();
    }
    eventSourcesRef.current.clear();
    runTaskIndexRef.current.clear();
  }, []);

  const closeAllPlanStreams = useCallback(() => {
    for (const source of planEventSourcesRef.current.values()) {
      source.close();
    }
    planEventSourcesRef.current.clear();
    planJobTaskIndexRef.current.clear();
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const payload = await api<{ repos: Repo[]; jiraAccounts: JiraAccount[]; agentProfiles: AgentProfile[] }>("/api/bootstrap");
      setRepos(payload.repos);
      setAccounts(payload.jiraAccounts);
      setAgentProfiles(payload.agentProfiles ?? []);
      if (!selectedRepoId && payload.repos.length > 0) setSelectedRepoId(payload.repos[0].id);
      if (!selectedAccountId && payload.jiraAccounts.length > 0) setSelectedAccountId(payload.jiraAccounts[0].id);
    } catch (e) { setError((e as Error).message); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    closeAllRunStreams();
    closeAllPlanStreams();
    setTaskRunStates({});
    setTaskPlanStates({});
    if (!selectedRepoId) { setTasks([]); setSelectedTaskId(""); setSelectedProfileId(""); return; }
    void (async () => {
      try {
        const [taskPayload, bindingPayload, selectionPayload] = await Promise.all([
          api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`),
          api<{ binding: { jira_account_id: string; jira_board_id: string } | null }>(`/api/jira/binding?repoId=${encodeURIComponent(selectedRepoId)}`),
          api<{ selection: { agent_profile_id: string } | null }>(`/api/agents/selection?repoId=${encodeURIComponent(selectedRepoId)}`),
        ]);
        setTasks(taskPayload.tasks);
        setSelectedTaskId(taskPayload.tasks[0]?.id ?? "");
        if (bindingPayload.binding) {
          setSelectedAccountId(bindingPayload.binding.jira_account_id);
          setSelectedBoardId(bindingPayload.binding.jira_board_id);
        } else { setSelectedBoardId(""); }
        setSelectedProfileId(selectionPayload.selection?.agent_profile_id ?? "");
      } catch (e) { setError((e as Error).message); }
    })();
  }, [selectedRepoId, closeAllRunStreams, closeAllPlanStreams]);

  useEffect(() => {
    if (!selectedAccountId) { setBoards([]); return; }
    void (async () => {
      try {
        const payload = await api<{ boards: JiraBoard[] }>(`/api/jira/boards?accountId=${encodeURIComponent(selectedAccountId)}`);
        setBoards(payload.boards);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedTaskId) {
      setPlans([]);
      setSelectedPlanId("");
      setManualPlanMarkdown("");
      setManualPlanJsonText("");
      setManualTasklistJsonText("");
      setTasklistValidationError("");
      setReviewComments([]);
      return;
    }
    void (async () => {
      try {
        const [planPayload, reviewPayload] = await Promise.all([
          api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`),
          api<{ reviewComments: ReviewComment[] }>(`/api/tasks/${encodeURIComponent(selectedTaskId)}/reviews`),
        ]);
        setPlans(planPayload.plans);
        const latest = planPayload.plans[0] ?? null;
        setSelectedPlanId(latest?.id ?? "");
        setManualPlanMarkdown(latest?.plan_markdown ?? "");
        setManualPlanJsonText(latest ? JSON.stringify(latest.plan ?? {}, null, 2) : "{}");
        setManualTasklistJsonText(latest ? JSON.stringify(latest.tasklist ?? {}, null, 2) : "{}");
        setTasklistValidationError("");
        setReviewComments(reviewPayload.reviewComments);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedRepoId) return;
    const interval = window.setInterval(() => {
      api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`)
        .then((payload) => setTasks(payload.tasks))
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(interval);
  }, [selectedRepoId]);

  useEffect(() => {
    if (!detailsOpen || !selectedTaskId) return;
    const interval = window.setInterval(() => {
      api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`)
        .then((payload) => setPlans(payload.plans))
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(interval);
  }, [detailsOpen, selectedTaskId]);

  async function onRepoSubmit(event: FormEvent) {
    event.preventDefault(); setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/repos", { method: "POST", body: JSON.stringify({ path: repoPath, name: repoName || undefined }) });
      setRepoPath(""); setRepoName("");
      setInfo("Repository saved.");
      await bootstrap();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function onConnectJira(event: FormEvent) {
    event.preventDefault(); setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/jira/connect", { method: "POST", body: JSON.stringify({ baseUrl: jiraBaseUrl, email: jiraEmail, apiToken: jiraToken }) });
      setJiraToken("");
      setInfo("Jira connected. Token stored locally in plaintext.");
      await bootstrap();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function bindBoard() {
    if (!selectedRepoId || !selectedAccountId || !selectedBoardId) { setError("Repo, account, and board selection required."); return; }
    setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/jira/bind", { method: "POST", body: JSON.stringify({ repoId: selectedRepoId, accountId: selectedAccountId, boardId: selectedBoardId }) });
      setInfo("Repo-board binding saved.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function discoverAgents() {
    setError(""); setInfo(""); setBusy(true);
    try {
      const payload = await api<{ profiles: AgentProfile[]; synced: number }>("/api/agents/discover");
      setAgentProfiles(payload.profiles);
      setInfo(`${payload.synced} agent profiles updated.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function saveAgentSelection() {
    if (!selectedRepoId || !selectedProfileId) { setError("Repo and agent profile required."); return; }
    setError(""); setInfo(""); setBusy(true);
    try {
      await api("/api/agents/select", { method: "POST", body: JSON.stringify({ repoId: selectedRepoId, profileId: selectedProfileId }) });
      setInfo("Agent profile saved for repo.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function syncTasks() {
    if (!selectedRepoId) { setError("Select a repo first."); return; }
    setError(""); setInfo(""); setBusy(true);
    try {
      const payload = await api<{ tasks: Task[]; synced: number }>("/api/tasks/sync", { method: "POST", body: JSON.stringify({ repoId: selectedRepoId }) });
      setTasks(payload.tasks);
      setSelectedTaskId(payload.tasks[0]?.id ?? "");
      setInfo(`${payload.synced} tasks synced.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function createPlan(revisionComment?: string) {
    if (!selectedTaskId) { setError("Select a task first."); return; }
    setBusy(true); setError("");
    try {
      const payload = await api<{ job: PlanJob }>("/api/plans/create", {
        method: "POST",
        body: JSON.stringify({ taskId: selectedTaskId, revisionComment }),
      });
      const job = payload.job;
      updateTaskPlanState(selectedTaskId, (prev) => ({
        activeJob: job,
        planLogs: prev.activeJob?.id === job.id ? prev.planLogs : [],
        planFinished: job.status !== "running" && job.status !== "pending",
      }));
      setInfo("Plan pipeline started. Live output is streaming.");
      if (job.status === "running" || job.status === "pending") {
        attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
      }
      setPlanComment("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function planAction(action: "approve" | "reject" | "revise") {
    if (!latestPlan) { setError("Generate a plan first."); return; }
    setBusy(true); setError("");
    try {
      await api(`/api/plans/${latestPlan.id}/action`, { method: "POST", body: JSON.stringify({ action, comment: planComment || undefined }) });
      const payload = await api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`);
      setPlans(payload.plans);
      const latest = payload.plans[0] ?? null;
      setSelectedPlanId(latest?.id ?? "");
      if (latest) {
        setManualPlanMarkdown(latest.plan_markdown ?? "");
        setManualPlanJsonText(JSON.stringify(latest.plan ?? {}, null, 2));
        setManualTasklistJsonText(JSON.stringify(latest.tasklist ?? {}, null, 2));
      }
      // Re-fetch tasks so kanban reflects updated status
      if (selectedRepoId) {
        const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
        setTasks(t.tasks);
      }
      setInfo(`Plan action: ${action}`);
      if (action !== "revise") setPlanComment("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function validateTasklistDraft(): { ok: true; planJson: unknown; tasklistJson: unknown } | { ok: false; error: string } {
    let planJson: unknown;
    let tasklistJson: unknown;
    try {
      planJson = JSON.parse(manualPlanJsonText);
    } catch {
      return { ok: false, error: "Plan JSON is invalid." };
    }
    try {
      tasklistJson = JSON.parse(manualTasklistJsonText);
    } catch {
      return { ok: false, error: "Tasklist JSON is invalid." };
    }

    if (!tasklistJson || typeof tasklistJson !== "object") {
      return { ok: false, error: "Tasklist JSON must be an object." };
    }
    const phases = (tasklistJson as { phases?: unknown }).phases;
    if (!Array.isArray(phases)) {
      return { ok: false, error: "Tasklist JSON must include `phases` array." };
    }

    return { ok: true, planJson, tasklistJson };
  }

  async function saveManualRevision() {
    if (!selectedPlan) {
      setError("Select a plan version first.");
      return;
    }
    const parsed = validateTasklistDraft();
    if (!parsed.ok) {
      setTasklistValidationError(parsed.error);
      return;
    }

    setTasklistValidationError("");
    setBusy(true);
    setError("");
    try {
      await api<{ plan: Plan }>(`/api/plans/${selectedPlan.id}/manual-revision`, {
        method: "POST",
        body: JSON.stringify({
          planMarkdown: manualPlanMarkdown,
          planJson: parsed.planJson,
          tasklistJson: parsed.tasklistJson,
          comment: "Manual revision from UI",
        }),
      });
      const payload = await api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(selectedTaskId)}`);
      setPlans(payload.plans);
      const latest = payload.plans[0] ?? null;
      setSelectedPlanId(latest?.id ?? "");
      if (latest) {
        setManualPlanMarkdown(latest.plan_markdown ?? "");
        setManualPlanJsonText(JSON.stringify(latest.plan ?? {}, null, 2));
        setManualTasklistJsonText(JSON.stringify(latest.tasklist ?? {}, null, 2));
      }
      setInfo("Manual revision saved as a new plan version.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const attachRunLogStream = useCallback(
    (runId: string, taskId: string, repoIdForRefresh: string) => {
      if (eventSourcesRef.current.has(runId)) return;

      const es = new EventSource(`/api/runs/${runId}/logs`);
      eventSourcesRef.current.set(runId, es);
      runTaskIndexRef.current.set(runId, taskId);

      for (const evtType of ["stdout", "stderr", "thinking", "agent_text", "tool_use", "tool_result", "db_event"] as const) {
        es.addEventListener(evtType, (event) => {
          const data = (event as MessageEvent).data;
          updateTaskRunState(taskId, (prev) => ({
            ...prev,
            runLogs: [...prev.runLogs, { type: evtType, data }],
          }));
        });
      }

      es.addEventListener("finished", (event) => {
        let finishedStatus = "done";
        try {
          const data = JSON.parse((event as MessageEvent).data) as { status?: string };
          if (data.status) finishedStatus = data.status;
        } catch { /* ignore */ }

        updateTaskRunState(taskId, (prev) => ({
          ...prev,
          runFinished: true,
          activeRun: prev.activeRun ? { ...prev.activeRun, status: finishedStatus } : prev.activeRun,
        }));

        es.close();
        eventSourcesRef.current.delete(runId);
        runTaskIndexRef.current.delete(runId);

        if (repoIdForRefresh) {
          api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`)
            .then((tasksPayload) => setTasks(tasksPayload.tasks))
            .catch(() => {});
        }

        api<{ run: RunResponse["run"]; events: RunEvent[] }>(`/api/runs/${runId}`)
          .then((runPayload) => {
            updateTaskRunState(taskId, (prev) => ({
              ...prev,
              activeRun: runPayload.run,
              runResult: { run: runPayload.run, events: runPayload.events, artifactPath: "" },
              runFinished: runPayload.run.status !== "running",
            }));
          })
          .catch(() => {});

        // Refresh review comments when run finishes
        api<{ reviewComments: ReviewComment[] }>(`/api/tasks/${encodeURIComponent(taskId)}/reviews`)
          .then((payload) => setReviewComments(payload.reviewComments))
          .catch(() => {});

        setInfo("Run finished.");
      });

      es.onerror = () => {
        updateTaskRunState(taskId, (prev) => ({ ...prev, runFinished: true }));
        es.close();
        eventSourcesRef.current.delete(runId);
        runTaskIndexRef.current.delete(runId);
      };
    },
    [updateTaskRunState],
  );

  const attachPlanLogStream = useCallback(
    (jobId: string, taskId: string, repoIdForRefresh: string) => {
      if (planEventSourcesRef.current.has(jobId)) return;

      const es = new EventSource(`/api/plans/jobs/${jobId}/logs`);
      planEventSourcesRef.current.set(jobId, es);
      planJobTaskIndexRef.current.set(jobId, taskId);

      for (const evtType of ["stdout", "stderr", "thinking", "agent_text", "tool_use", "tool_result", "db_event"] as const) {
        es.addEventListener(evtType, (event) => {
          const data = (event as MessageEvent).data;
          updateTaskPlanState(taskId, (prev) => ({
            ...prev,
            planLogs: [...prev.planLogs, { type: evtType, data }],
          }));
        });
      }

      es.addEventListener("finished", (event) => {
        let finishedStatus = "done";
        try {
          const data = JSON.parse((event as MessageEvent).data) as { status?: string };
          if (data.status) finishedStatus = data.status;
        } catch {
          // ignore parse errors
        }

        updateTaskPlanState(taskId, (prev) => ({
          ...prev,
          planFinished: true,
          activeJob: prev.activeJob ? { ...prev.activeJob, status: finishedStatus } : prev.activeJob,
        }));

        es.close();
        planEventSourcesRef.current.delete(jobId);
        planJobTaskIndexRef.current.delete(jobId);

        api<{ job: PlanJob }>(`/api/plans/jobs/${jobId}`)
          .then((payload) => {
            updateTaskPlanState(taskId, (prev) => ({
              ...prev,
              activeJob: payload.job,
              planFinished: payload.job.status !== "running" && payload.job.status !== "pending",
            }));
          })
          .catch(() => {});

        if (taskId === selectedTaskId) {
          api<{ plans: Plan[] }>(`/api/plans?taskId=${encodeURIComponent(taskId)}`)
            .then((payload) => setPlans(payload.plans))
            .catch(() => {});
        }

        if (repoIdForRefresh) {
          api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`)
            .then((payload) => setTasks(payload.tasks))
            .catch(() => {});
        }

        // After plan finishes, check if an auto-started run exists and attach its log stream
        if (finishedStatus === "done") {
          const pollForRun = (attempt: number) => {
            if (attempt > 5) return;
            setTimeout(() => {
              api<{ run: ActiveRun | null; events: RunEvent[] }>(
                `/api/runs/latest?taskId=${encodeURIComponent(taskId)}`,
              )
                .then((payload) => {
                  const run = payload.run;
                  if (!run) {
                    pollForRun(attempt + 1);
                    return;
                  }
                  updateTaskRunState(taskId, (prev) => ({
                    ...prev,
                    activeRun: run,
                    runLogs: [],
                    runResult: {
                      run,
                      events: payload.events,
                      artifactPath: "",
                    },
                    runFinished: run.status !== "running",
                  }));
                  if (run.status === "running") {
                    attachRunLogStream(run.id, taskId, repoIdForRefresh);
                  }
                })
                .catch(() => pollForRun(attempt + 1));
            }, attempt === 0 ? 500 : 2000);
          };
          pollForRun(0);
        }
      });

      es.onerror = () => {
        updateTaskPlanState(taskId, (prev) => ({ ...prev, planFinished: true }));
        es.close();
        planEventSourcesRef.current.delete(jobId);
        planJobTaskIndexRef.current.delete(jobId);
      };
    },
    [selectedTaskId, updateTaskPlanState, updateTaskRunState, attachRunLogStream],
  );

  useEffect(() => {
    if (!selectedTaskId) return;
    void (async () => {
      try {
        const payload = await api<{ job: PlanJob | null }>(
          `/api/plans/jobs/latest?taskId=${encodeURIComponent(selectedTaskId)}`,
        );
        const job = payload.job;
        if (!job) {
          updateTaskPlanState(selectedTaskId, (prev) => ({
            ...prev,
            activeJob: null,
            planFinished: true,
          }));
          return;
        }

        updateTaskPlanState(selectedTaskId, (prev) => ({
          ...prev,
          activeJob: job,
          planFinished: job.status !== "running" && job.status !== "pending",
        }));

        if (job.status === "running" || job.status === "pending") {
          attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
        }
      } catch {
        // keep UI resilient; plan visibility is best-effort
      }
    })();
  }, [selectedTaskId, selectedRepoId, updateTaskPlanState, attachPlanLogStream]);

  useEffect(() => {
    if (!detailsOpen || !selectedTaskId) return;
    const interval = window.setInterval(() => {
      api<{ job: PlanJob | null }>(`/api/plans/jobs/latest?taskId=${encodeURIComponent(selectedTaskId)}`)
        .then((payload) => {
          const job = payload.job;
          if (!job) return;
          updateTaskPlanState(selectedTaskId, (prev) => ({
            ...prev,
            activeJob: job,
            planFinished: job.status !== "running" && job.status !== "pending",
          }));
          if (job.status === "running" || job.status === "pending") {
            attachPlanLogStream(job.id, selectedTaskId, selectedRepoId);
          }
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(interval);
  }, [detailsOpen, selectedTaskId, selectedRepoId, updateTaskPlanState, attachPlanLogStream]);

  useEffect(() => {
    if (!selectedTaskId || !selectedRepoId) return;
    void (async () => {
      try {
        const payload = await api<{ run: ActiveRun | null; events: RunEvent[] }>(
          `/api/runs/latest?taskId=${encodeURIComponent(selectedTaskId)}`,
        );
        const run = payload.run;
        if (!run) return;

        updateTaskRunState(selectedTaskId, (prev) => ({
          ...prev,
          activeRun: run,
          runResult: {
            run,
            events: payload.events,
            artifactPath: "",
          },
          runFinished: run.status !== "running",
        }));

        if (run.status === "running") {
          attachRunLogStream(run.id, selectedTaskId, selectedRepoId);
        }
      } catch {
        // keep UI resilient; run visibility is best-effort
      }
    })();
  }, [selectedTaskId, selectedRepoId, updateTaskRunState, attachRunLogStream]);

  async function startRun() {
    if (!selectedTaskId || !selectedTask) { setError("Select a task first."); return; }
    if (!selectedProfileId) { setError("Select an agent/model for this repo first."); return; }
    if (selectedTask.require_plan && !approvedPlan) {
      setError("Plan must be approved to start a run for this task.");
      return;
    }

    const taskId = selectedTaskId;
    const repoIdForRefresh = selectedRepoId;
    const body: Record<string, string> = { profileId: selectedProfileId };
    if (approvedPlan) body.planId = approvedPlan.id;
    if (!approvedPlan) body.taskId = taskId;

    setBusy(true); setError("");
    updateTaskRunState(taskId, (prev) => ({
      ...prev,
      runLogs: [],
      runFinished: false,
      runResult: null,
    }));
    try {
      const payload = await api<{ run: { id: string; status: string; branch_name: string; agent?: RunAgent } }>("/api/runs/start", {
        method: "POST",
        body: JSON.stringify(body),
      });
      updateTaskRunState(taskId, (prev) => ({
        ...prev,
        activeRun: payload.run,
      }));
      setBusy(false);
      setInfo("Run started. Streaming logs...");

      // Re-fetch tasks so kanban shows IN_PROGRESS
      if (repoIdForRefresh) {
        try {
          const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`);
          setTasks(t.tasks);
        } catch { /* ignore */ }
      }

      attachRunLogStream(payload.run.id, taskId, repoIdForRefresh);
    } catch (e) {
      if (repoIdForRefresh) {
        try {
          const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(repoIdForRefresh)}`);
          setTasks(t.tasks);
        } catch { /* ignore */ }
      }
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function stopRun() {
    if (!selectedTaskId || !activeRun) return;
    try {
      await api(`/api/runs/${activeRun.id}/stop`, { method: "POST" });
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev,
        activeRun: prev.activeRun ? { ...prev.activeRun, status: "cancelled" } : prev.activeRun,
        runFinished: true,
      }));
      const source = eventSourcesRef.current.get(activeRun.id);
      if (source) {
        source.close();
        eventSourcesRef.current.delete(activeRun.id);
        runTaskIndexRef.current.delete(activeRun.id);
      }
      if (selectedRepoId) {
        const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
        setTasks(t.tasks);
      }
      setInfo("Run cancelled.");
    } catch (e) { setError((e as Error).message); }
  }

  async function submitReview() {
    if (!selectedTaskId || !reviewText.trim()) return;
    setError(""); setBusy(true);
    try {
      const payload = await api<{ reviewComment: ReviewComment; run: { id: string; status: string } }>(
        `/api/tasks/${encodeURIComponent(selectedTaskId)}/review`,
        { method: "POST", body: JSON.stringify({ comment: reviewText.trim() }) },
      );
      setReviewComments((prev) => [...prev, { ...payload.reviewComment, status: "processing", result_run_id: payload.run.id }]);
      setReviewText("");

      // Attach to the new review run's SSE stream
      const reviewRunId = payload.run.id;
      updateTaskRunState(selectedTaskId, (prev) => ({
        ...prev,
        activeRun: { id: reviewRunId, status: "running", branch_name: prev.activeRun?.branch_name ?? "" },
        runLogs: [],
        runFinished: false,
        runResult: null,
      }));
      setDetailsTab("run");

      // Poll for run to be available then attach stream
      const pollForReviewRun = async () => {
        for (let i = 0; i < 20; i++) {
          try {
            const runData = await api<{ run: { id: string; status: string } }>(`/api/runs/${reviewRunId}`);
            if (runData.run) {
              attachRunLogStream(reviewRunId, selectedTaskId, selectedRepoId);
              return;
            }
          } catch { /* not ready yet */ }
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      void pollForReviewRun();
      setInfo("Review feedback submitted. Agent is processing...");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function markTaskDone() {
    if (!selectedTaskId) return;
    setError(""); setBusy(true);
    try {
      await api(`/api/tasks/${encodeURIComponent(selectedTaskId)}/complete`, { method: "POST" });
      if (selectedRepoId) {
        const t = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
        setTasks(t.tasks);
      }
      setInfo("Task marked as done.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [runLogs]);

  useEffect(() => {
    if (planLogContainerRef.current) {
      planLogContainerRef.current.scrollTop = planLogContainerRef.current.scrollHeight;
    }
  }, [planLogs]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      closeAllRunStreams();
      closeAllPlanStreams();
    };
  }, [closeAllRunStreams, closeAllPlanStreams]);

  useEffect(() => {
    if (!selectedTask) setDetailsOpen(false);
  }, [selectedTask]);

  // Auto-switch to review tab only when task ID changes (not on every poll)
  const prevSelectedTaskIdRef = useRef("");
  useEffect(() => {
    if (selectedTaskId === prevSelectedTaskIdRef.current) return;
    prevSelectedTaskIdRef.current = selectedTaskId;
    if (!selectedTaskId) return;
    const task = tasks.find((t) => t.id === selectedTaskId);
    if (task?.status === "IN_REVIEW") setDetailsTab("review");
    else if (detailsTab === "review") setDetailsTab("run");
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!selectedPlan) return;
    setManualPlanMarkdown(selectedPlan.plan_markdown ?? "");
    setManualPlanJsonText(JSON.stringify(selectedPlan.plan ?? {}, null, 2));
    setManualTasklistJsonText(JSON.stringify(selectedPlan.tasklist ?? {}, null, 2));
    setTasklistValidationError("");
  }, [selectedPlan?.id]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsOpen]);

  const statusFromLane = (lane: LaneKey): string => {
    switch (lane) {
      case "todo": return "To Do";
      case "inprogress": return "In Progress";
      case "inreview": return "In Review";
      case "done": return "Done";
      case "archived": return "ARCHIVED";
    }
  };

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

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentLane = laneFromStatus(task.status);
    if (currentLane === lane) return;

    // Archive lane: only accept tasks from done lane
    if (lane === "archived" && currentLane !== "done") {
      setError("Only completed tasks can be archived.");
      return;
    }
    // From archive: only allow restoring to todo
    if (currentLane === "archived" && lane !== "todo") {
      setError("Archived tasks can only be restored to To Do.");
      return;
    }

    const newStatus = statusFromLane(lane);

    // Optimistic update
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus } : t));

    try {
      await api(`/api/tasks/${taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (err) {
      // Revert on error
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: task.status } : t));
      setError((err as Error).message);
    }
  }

  function openEditTaskModal() {
    if (!selectedTask) return;
    setEditTaskTitle(selectedTask.title);
    setEditTaskDesc(selectedTask.description ?? "");
    setEditTaskPriority(selectedTask.priority ?? "");
    setEditTaskRequirePlan(selectedTask.require_plan);
    setEditTaskAutoApprovePlan(selectedTask.auto_approve_plan);
    setEditTaskAutoStart(selectedTask.auto_start);
    setEditTaskModalOpen(true);
  }

  async function saveTaskEdits() {
    if (!selectedTask || !editTaskTitle.trim()) return;
    setBusy(true); setError("");
    try {
      const payload = await api<{ task: Task }>(`/api/tasks/${selectedTask.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTaskTitle.trim(),
          description: editTaskDesc.trim() || null,
          priority: editTaskPriority || null,
          requirePlan: editTaskRequirePlan,
          autoApprovePlan: editTaskAutoApprovePlan,
          autoStart: editTaskAutoStart,
        }),
      });
      setTasks((prev) => prev.map((t) => t.id === payload.task.id ? payload.task : t));
      setEditTaskModalOpen(false);
      setInfo("Task updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requeueAutostart() {
    if (!selectedTask) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/tasks/${selectedTask.id}/autostart/requeue`, { method: "POST" });
      setInfo("Task requeued for autostart pipeline.");
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearTaskPipeline() {
    if (!selectedTask) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ cleared: boolean; plan_jobs_failed: number; autostart_jobs_failed: number; task_reset: boolean }>(
        `/api/tasks/${selectedTask.id}/pipeline/clear`,
        { method: "POST" },
      );
      const parts: string[] = [];
      if (result.plan_jobs_failed > 0) parts.push(`${result.plan_jobs_failed} plan job`);
      if (result.autostart_jobs_failed > 0) parts.push(`${result.autostart_jobs_failed} autostart job`);
      if (result.task_reset) parts.push("task status reset");
      setInfo(parts.length > 0 ? `Pipeline temizlendi: ${parts.join(", ")}` : "Temizlenecek bir şey yoktu.");
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearAllPipelines() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ cleared: boolean; plan_jobs_failed: number; autostart_jobs_failed: number; task_reset: boolean }>(
        "/api/pipeline/clear-all",
        { method: "POST" },
      );
      const parts: string[] = [];
      if (result.plan_jobs_failed > 0) parts.push(`${result.plan_jobs_failed} plan job`);
      if (result.autostart_jobs_failed > 0) parts.push(`${result.autostart_jobs_failed} autostart job`);
      if (result.task_reset) parts.push("task status reset");
      setInfo(parts.length > 0 ? `Tüm pipeline temizlendi: ${parts.join(", ")}` : "Temizlenecek bir şey yoktu.");
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createManualTask() {
    if (!selectedRepoId || !newTaskTitle.trim()) return;
    setBusy(true); setError("");
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          repoId: selectedRepoId,
          title: newTaskTitle.trim(),
          description: newTaskDesc.trim() || undefined,
          status: "To Do",
          priority: newTaskPriority || undefined,
          requirePlan: newTaskRequirePlan,
          autoApprovePlan: newTaskAutoApprovePlan,
          autoStart: newTaskAutoStart,
        }),
      });
      const payload = await api<{ tasks: Task[] }>(`/api/tasks?repoId=${encodeURIComponent(selectedRepoId)}`);
      setTasks(payload.tasks);
      setNewTaskTitle("");
      setNewTaskDesc("");
      setNewTaskPriority("");
      setNewTaskRequirePlan(true);
      setNewTaskAutoApprovePlan(false);
      setNewTaskAutoStart(false);
      setCreateTaskModalOpen(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const planStatusColor = (status: string) => {
    switch (status) {
      case "approved": return "border-brand/40 bg-brand-tint text-brand";
      case "rejected": return "border-error-border bg-error-bg text-error-text";
      case "drafted": return "border-border-strong bg-surface-300 text-text-secondary";
      case "revise_requested": return "border-yellow-800 bg-yellow-950/40 text-yellow-400";
      default: return "border-border-strong bg-surface-300 text-text-muted";
    }
  };

  const runStatusColor = (status: string) => {
    const normalized = status.toLowerCase();
    if (normalized.includes("done") || normalized.includes("success")) return "border-brand/40 bg-brand-tint text-brand";
    if (normalized.includes("cancel")) return "border-yellow-700 bg-yellow-950/40 text-yellow-400";
    if (normalized.includes("fail") || normalized.includes("error")) return "border-error-border bg-error-bg text-error-text";
    return "border-border-strong bg-surface-300 text-text-secondary";
  };

  return (
    <div className={`min-h-screen bg-surface-0 text-text-primary transition-[padding] duration-200 ${detailsOpen ? "lg:pr-[540px]" : ""}`}>
      {/* ─── Top Nav ─── */}
      <nav className="sticky top-0 z-40 border-b border-border-default bg-surface-0/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-dark border border-brand-glow">
              <span className="text-sm font-bold text-brand">A</span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-text-primary">Local Agent</h1>
              {selectedRepo && (
                <>
                  <span className="text-text-muted">/</span>
                  <span className="text-sm text-text-secondary">{selectedRepo.name}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={syncTasks}
              disabled={busy || !selectedRepoId}
              className={`${btnSecondary} flex items-center gap-1.5 !px-3 !py-1.5 text-xs`}
            >
              <IconRefresh className="h-3.5 w-3.5" />
              Sync
            </button>
            <button
              onClick={() => void clearAllPipelines()}
              disabled={busy}
              className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
              title="Tüm takılmış pipeline'ları temizle"
            >
              Clear Queue
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border-strong bg-surface-300 text-text-muted transition hover:text-text-primary hover:border-border-strong"
            >
              <IconSettings />
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Alerts ─── */}
      <div className="mx-auto max-w-7xl px-5">
        {error && !settingsOpen && (
          <div className="mt-4 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-text">
            {error}
          </div>
        )}
        {info && !settingsOpen && (
          <div className="mt-4 rounded-lg border border-info-border bg-info-bg px-4 py-3 text-sm text-info-text">
            {info}
          </div>
        )}
      </div>

      {/* ─── Main Content ─── */}
      <main className="mx-auto max-w-7xl px-5 py-6">
        {/* Kanban Board */}
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
                onDrop={(e) => handleDrop(e, lane.key)}
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
                        onClick={() => {
                          setNewTaskTitle("");
                          setNewTaskDesc("");
                          setNewTaskPriority("");
                          setNewTaskRequirePlan(true);
                          setNewTaskAutoApprovePlan(false);
                          setNewTaskAutoStart(false);
                          setCreateTaskModalOpen(true);
                        }}
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
                      onClick={() => {
                        setSelectedTaskId(task.id);
                        setDetailsOpen(true);
                        setDetailsTab("plan");
                      }}
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
                        {task.priority && (
                          <span className="text-[10px] text-text-muted">{task.priority}</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm leading-snug text-text-primary">{task.title}</p>
                      <p className="mt-2 text-[11px] text-text-muted">{formatDate(task.updated_at)}</p>
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
            onDrop={(e) => handleDrop(e, "archived")}
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
                    onClick={() => {
                      setSelectedTaskId(task.id);
                      setDetailsOpen(true);
                      setDetailsTab("plan");
                    }}
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

      </main>

      {detailsOpen && selectedTask && (
        <>
          <button
            type="button"
            aria-label="Close details"
            onClick={() => setDetailsOpen(false)}
            className="fixed inset-0 z-[41] bg-black/50 backdrop-blur-[1px] lg:hidden"
          />

          <aside className="fixed inset-y-0 right-0 z-[42] w-full max-w-[540px] border-l border-border-default bg-surface-100 shadow-2xl">
            <div className="flex h-full flex-col">
              <div className="border-b border-border-default px-5 py-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-brand">{selectedTask.jira_issue_key}</p>
                    <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-text-primary">{selectedTask.title}</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={openEditTaskModal}
                      className="rounded-md border border-border-strong bg-surface-300 px-2 py-1 text-[11px] font-medium text-text-secondary transition hover:text-text-primary"
                    >
                      Edit
                    </button>
                    {laneFromStatus(selectedTask.status) === "todo" && (
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete task "${selectedTask.jira_issue_key} - ${selectedTask.title}"? This cannot be undone.`)) return;
                          try {
                            await api(`/api/tasks/${selectedTask.id}`, { method: "DELETE" });
                            setDetailsOpen(false);
                            setSelectedTaskId(null);
                            setTasks((prev) => prev.filter((t) => t.id !== selectedTask.id));
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                        className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      onClick={() => setDetailsOpen(false)}
                      className="rounded-md p-1 text-text-muted transition hover:bg-surface-300 hover:text-text-primary"
                    >
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="rounded-full border border-border-strong bg-surface-300 px-2 py-0.5 text-text-secondary">
                    {selectedTask.status}
                  </span>
                  {selectedTask.priority && (
                    <span className="rounded-full border border-border-strong bg-surface-300 px-2 py-0.5 text-text-muted">
                      {selectedTask.priority}
                    </span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 ${
                    selectedTask.require_plan
                      ? "border-border-strong bg-surface-300 text-text-secondary"
                      : "border-brand/40 bg-brand-tint text-brand"
                  }`}>
                    {selectedTask.require_plan ? "Require Plan" : "Direct Run"}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 ${
                    selectedTask.auto_approve_plan
                      ? "border-brand/40 bg-brand-tint text-brand"
                      : "border-border-strong bg-surface-300 text-text-muted"
                  }`}>
                    {selectedTask.auto_approve_plan ? "Auto Approve: On" : "Auto Approve: Off"}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 ${
                    selectedTask.auto_start
                      ? "border-brand/40 bg-brand-tint text-brand"
                      : "border-border-strong bg-surface-300 text-text-muted"
                  }`}>
                    {selectedTask.auto_start ? "Autostart: On" : "Autostart: Off"}
                  </span>
                  <span className="text-text-muted">{formatDate(selectedTask.updated_at)}</span>
                </div>
                {selectedTask.description && (
                  <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-text-secondary">{selectedTask.description}</p>
                )}
                {selectedTask.last_pipeline_error && (
                  <div className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-[11px] text-error-text">
                    <p className="font-medium">Pipeline Error</p>
                    <p className="mt-1 whitespace-pre-wrap">{selectedTask.last_pipeline_error}</p>
                    {selectedTask.last_pipeline_at && (
                      <p className="mt-1 text-[10px] opacity-70">{formatDate(selectedTask.last_pipeline_at)}</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      {laneFromStatus(selectedTask.status) === "todo" && (
                        <button
                          onClick={() => void requeueAutostart()}
                          disabled={busy}
                          className="rounded-md border border-error-border bg-error-bg px-2.5 py-1 text-[11px] font-medium text-error-text transition hover:brightness-110 disabled:opacity-40"
                        >
                          Requeue Pipeline
                        </button>
                      )}
                      <button
                        onClick={() => void clearTaskPipeline()}
                        disabled={busy}
                        className="rounded-md border border-border-default bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:brightness-110 disabled:opacity-40"
                        title="Takılmış plan job ve autostart job'ları temizle, task'ı TODO'ya döndür"
                      >
                        Clear Pipeline
                      </button>
                    </div>
                  </div>
                )}
                {!selectedTask.last_pipeline_error && ["PLAN_GENERATING", "PLAN_DRAFTED", "PLAN_APPROVED"].includes(selectedTask.status.trim().toUpperCase()) && (
                  <div className="mt-3">
                    <button
                      onClick={() => void clearTaskPipeline()}
                      disabled={busy}
                      className="rounded-md border border-border-default bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:brightness-110 disabled:opacity-40"
                      title="Takılmış pipeline'ı temizle, task'ı TODO'ya döndür"
                    >
                      Clear Pipeline
                    </button>
                  </div>
                )}
              </div>

              <div className="flex border-b border-border-default px-3">
                <button
                  onClick={() => setDetailsTab("plan")}
                  className={`relative px-3 py-2.5 text-sm font-medium transition ${
                    detailsTab === "plan" ? "text-brand" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Plan
                  {detailsTab === "plan" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
                </button>
                <button
                  onClick={() => setDetailsTab("tasklist")}
                  className={`relative px-3 py-2.5 text-sm font-medium transition ${
                    detailsTab === "tasklist" ? "text-brand" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Tasklist
                  {detailsTab === "tasklist" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
                </button>
                <button
                  onClick={() => setDetailsTab("run")}
                  className={`relative px-3 py-2.5 text-sm font-medium transition ${
                    detailsTab === "run" ? "text-brand" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  Run Output
                  {detailsTab === "run" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
                </button>
                {selectedTask?.status === "IN_REVIEW" && (
                  <button
                    onClick={() => setDetailsTab("review")}
                    className={`relative px-3 py-2.5 text-sm font-medium transition ${
                      detailsTab === "review" ? "text-brand" : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    Review
                    {reviewComments.length > 0 && (
                      <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand/20 px-1 text-[10px] font-semibold text-brand">
                        {reviewComments.length}
                      </span>
                    )}
                    {detailsTab === "review" && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand" />}
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {detailsTab === "plan" && (
                  <>
                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-text-secondary">Plan Status</p>
                          {latestPlan ? (
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${planStatusColor(latestPlan.status)}`}>
                                {latestPlan.status}
                              </span>
                              <span className="text-[11px] text-text-muted">v{latestPlan.version}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-text-muted">No plan generated</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {plans.length > 0 && (
                            <select
                              value={selectedPlanId}
                              onChange={(e) => setSelectedPlanId(e.target.value)}
                              className={`${selectClass} !w-[140px] !py-1.5 !text-xs`}
                            >
                              {plans.map((plan) => (
                                <option key={plan.id} value={plan.id}>
                                  v{plan.version} · {plan.status}
                                </option>
                              ))}
                            </select>
                          )}
                          <button
                            onClick={() => void createPlan()}
                            disabled={busy || activePlanJob?.status === "running" || activePlanJob?.status === "pending"}
                            className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                          >
                            {activePlanJob?.status === "running" || activePlanJob?.status === "pending"
                              ? "Planning..."
                              : (latestPlan ? "Regenerate" : "Generate Plan")}
                          </button>
                        </div>
                      </div>
                      {!taskRequiresPlan && (
                        <p className="mt-2 text-[11px] text-text-muted">
                          Plan is optional for this task. You can run directly from the Run tab.
                        </p>
                      )}
                      {activePlanJob && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className={`rounded-full border px-2 py-0.5 font-medium ${
                            activePlanJob.status === "done"
                              ? "border-brand/40 bg-brand-tint text-brand"
                              : activePlanJob.status === "failed"
                                ? "border-error-border bg-error-bg text-error-text"
                                : "border-border-strong bg-surface-300 text-text-secondary"
                          }`}>
                            plan job: {activePlanJob.status}
                          </span>
                          <span className="text-text-muted">{activePlanJob.mode}</span>
                          <span className="text-text-muted">{formatDate(activePlanJob.updated_at)}</span>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-xs font-medium text-text-secondary">Live Plan Output</h4>
                        {activePlanJob && (
                          <span className="text-[11px] text-text-muted">job {activePlanJob.id.slice(0, 8)}</span>
                        )}
                      </div>
                      <div
                        ref={planLogContainerRef}
                        className="max-h-[480px] overflow-y-auto rounded-lg border border-border-strong bg-[#0f0f0f] px-3 py-2 text-[11px] leading-relaxed"
                      >
                        {planLogs.length === 0 ? (
                          <p className="py-6 text-center text-text-muted">
                            {activePlanJob
                              ? (planFinished ? "Plan output stream finished." : "Waiting for plan output...")
                              : "No active plan job."}
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {planLogs.map((entry, index) => (
                              <LogEntry key={`plan-${index}-${entry.type}`} type={entry.type} data={entry.data} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <label className="mb-1.5 block text-xs font-medium text-text-muted">Review Comment</label>
                      <textarea
                        value={planComment}
                        onChange={(e) => setPlanComment(e.target.value)}
                        className={`${inputClass} min-h-[84px] resize-y`}
                        placeholder="Add approval/revision note..."
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => void planAction("approve")}
                          disabled={busy || !latestPlan}
                          className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => void planAction("revise")}
                          disabled={busy || !latestPlan}
                          className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                        >
                          Request Revision
                        </button>
                        <button
                          onClick={() => void planAction("reject")}
                          disabled={busy || !latestPlan}
                          className="rounded-md border border-error-border bg-error-bg px-3 py-1.5 text-xs font-medium text-error-text transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-xs font-medium text-text-secondary">Plan Draft</h4>
                        {selectedPlan && (
                          <span className="text-[11px] text-text-muted">{formatDate(selectedPlan.created_at)}</span>
                        )}
                      </div>
                      {selectedPlan ? (
                        <textarea
                          value={manualPlanMarkdown}
                          onChange={(e) => setManualPlanMarkdown(e.target.value)}
                          className={`${inputClass} min-h-[220px] resize-y font-mono text-[12px] leading-relaxed`}
                          placeholder="Plan markdown..."
                        />
                      ) : (
                        <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
                          Select a task and generate a plan to see details.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {detailsTab === "tasklist" && (
                  <>
                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-xs font-medium text-text-secondary">Plan JSON</h4>
                        {selectedPlan && (
                          <span className="text-[11px] text-text-muted">
                            v{selectedPlan.version} · {selectedPlan.generation_mode}
                          </span>
                        )}
                      </div>
                      <textarea
                        value={manualPlanJsonText}
                        onChange={(e) => setManualPlanJsonText(e.target.value)}
                        className={`${inputClass} min-h-[180px] resize-y font-mono text-[12px]`}
                        placeholder="{}"
                      />
                    </div>

                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-xs font-medium text-text-secondary">Tasklist JSON</h4>
                        {selectedPlan && (
                          <span className="text-[11px] text-text-muted">
                            schema v{selectedPlan.tasklist_schema_version}
                          </span>
                        )}
                      </div>
                      <textarea
                        value={manualTasklistJsonText}
                        onChange={(e) => setManualTasklistJsonText(e.target.value)}
                        className={`${inputClass} min-h-[260px] resize-y font-mono text-[12px]`}
                        placeholder="{}"
                      />
                      {tasklistValidationError && (
                        <div className="mt-3 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-xs text-error-text">
                          {tasklistValidationError}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            const result = validateTasklistDraft();
                            if (result.ok) {
                              setTasklistValidationError("");
                              setInfo("Tasklist JSON is valid.");
                            } else {
                              setTasklistValidationError(result.error);
                            }
                          }}
                          className={`${btnSecondary} !px-3 !py-1.5 text-xs`}
                        >
                          Validate
                        </button>
                        <button
                          onClick={() => void saveManualRevision()}
                          disabled={busy || !selectedPlan}
                          className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                        >
                          Save as New Version
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {detailsTab === "run" && (
                  <>
                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-text-secondary">Execution</p>
                          {selectedProfile ? (
                            <p className="mt-1 text-[11px] text-text-muted">
                              {selectedProfile.agent_name} · {selectedProfile.model}
                            </p>
                          ) : (
                            <p className="mt-1 text-[11px] text-text-muted">Agent/model not selected for repo</p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setDetailsTab("run");
                            void startRun();
                          }}
                          disabled={busy || !selectedProfileId || (taskRequiresPlan && !approvedPlan)}
                          className={`${btnPrimary} !px-3 !py-1.5 text-xs`}
                        >
                          <span className="flex items-center gap-1.5">
                            <IconPlay className="h-3.5 w-3.5" />
                            Start Run
                          </span>
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        {taskRequiresPlan && !approvedPlan && (
                          <span className="rounded-full border border-yellow-700 bg-yellow-950/40 px-2 py-0.5 text-yellow-400">
                            Plan approval required
                          </span>
                        )}
                        {!taskRequiresPlan && (
                          <span className="rounded-full border border-brand/40 bg-brand-tint px-2 py-0.5 text-brand">
                            Direct run enabled
                          </span>
                        )}
                        {activeRun && (
                          <>
                            <span className={`rounded-full border px-2 py-0.5 font-medium ${runStatusColor(activeRun.status)}`}>
                              {activeRun.status}
                            </span>
                            <span className="rounded-full border border-border-strong bg-surface-300 px-2 py-0.5 text-text-secondary">
                              {activeRun.branch_name}
                            </span>
                          </>
                        )}
                      </div>
                      {activeRun && !runFinished && (
                        <button
                          onClick={() => void stopRun()}
                          className="mt-3 rounded-md border border-error-border bg-error-bg px-3 py-1.5 text-xs font-medium text-error-text transition hover:brightness-110"
                        >
                          Cancel Run
                        </button>
                      )}
                    </div>

                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <h4 className="mb-2 text-xs font-medium text-text-secondary">Live Logs</h4>
                      <div
                        ref={logContainerRef}
                        className="max-h-[360px] overflow-y-auto rounded-lg border border-border-strong bg-[#0f0f0f] px-3 py-2 text-[11px] leading-relaxed"
                      >
                        {runLogs.length === 0 ? (
                          <p className="py-8 text-center text-text-muted">No output yet.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {runLogs.map((entry, index) => (
                              <LogEntry key={`${index}-${entry.type}`} type={entry.type} data={entry.data} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <h4 className="mb-2 text-xs font-medium text-text-secondary">Run Events</h4>
                      {!runResult ? (
                        <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
                          Run event summary will appear after completion.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {runResult.events.length === 0 && (
                            <p className="text-xs text-text-muted">No events recorded.</p>
                          )}
                          {runResult.events.map((event) => (
                            <div key={event.id} className="rounded-lg border border-border-strong bg-surface-100 px-3 py-2">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] font-medium text-text-secondary">{event.type}</span>
                                <span className="text-[10px] text-text-muted">{formatDate(event.created_at)}</span>
                              </div>
                              <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap text-[11px] text-text-muted">
                                {typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload, null, 2)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </>
                )}

                {detailsTab === "review" && (
                  <>
                    <div className="rounded-xl border border-border-default bg-surface-200 p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-xs font-medium text-text-secondary">Review Feedback</h4>
                        <button
                          onClick={() => void markTaskDone()}
                          disabled={busy}
                          className="rounded-md border border-brand/40 bg-brand-tint px-3 py-1 text-xs font-medium text-brand transition hover:brightness-110"
                        >
                          Mark as Done
                        </button>
                      </div>

                      {reviewComments.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {reviewComments.map((rc) => (
                            <div key={rc.id} className="rounded-lg border border-border-strong bg-surface-100 px-3 py-2">
                              <div className="mb-1 flex items-center gap-2">
                                {rc.status === "processing" && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-400">
                                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                                    Processing
                                  </span>
                                )}
                                {rc.status === "addressed" && (
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] font-medium text-green-400"
                                    title={rc.addressed_at ? `Addressed at ${new Date(rc.addressed_at).toLocaleString()}` : "Addressed"}
                                  >
                                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Addressed
                                  </span>
                                )}
                                {rc.status === "pending" && (
                                  <span className="text-[10px] font-medium text-text-muted">Pending</span>
                                )}
                                <span className="text-[10px] text-text-muted">{formatDate(rc.created_at)}</span>
                              </div>
                              <p className="text-[11px] text-text-secondary">{rc.comment}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {reviewComments.length === 0 && (
                        <p className="mb-3 rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-text-muted">
                          No review comments yet. Submit feedback below to request changes.
                        </p>
                      )}

                      <textarea
                        value={reviewText}
                        onChange={(e) => setReviewText(e.target.value)}
                        placeholder="Describe what needs to be changed..."
                        rows={3}
                        className="w-full rounded-lg border border-border-strong bg-surface-100 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none"
                      />
                      <button
                        onClick={() => void submitReview()}
                        disabled={busy || !reviewText.trim()}
                        className="mt-2 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                      >
                        Submit Feedback
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </aside>
        </>
      )}

      {/* ─── Settings Modal ─── */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        repos={repos} accounts={accounts} boards={boards} agentProfiles={agentProfiles}
        selectedRepoId={selectedRepoId} setSelectedRepoId={setSelectedRepoId}
        selectedAccountId={selectedAccountId} setSelectedAccountId={setSelectedAccountId}
        selectedBoardId={selectedBoardId} setSelectedBoardId={setSelectedBoardId}
        selectedProfileId={selectedProfileId} setSelectedProfileId={setSelectedProfileId}
        selectedProfile={selectedProfile}
        busy={busy} error={error} info={info}
        onRepoSubmit={onRepoSubmit} onConnectJira={onConnectJira}
        bindBoard={bindBoard} discoverAgents={discoverAgents} saveAgentSelection={saveAgentSelection}
        repoPath={repoPath} setRepoPath={setRepoPath}
        repoName={repoName} setRepoName={setRepoName}
        jiraBaseUrl={jiraBaseUrl} setJiraBaseUrl={setJiraBaseUrl}
        jiraEmail={jiraEmail} setJiraEmail={setJiraEmail}
        jiraToken={jiraToken} setJiraToken={setJiraToken}
      />

      <CreateTaskModal
        open={createTaskModalOpen}
        onClose={() => setCreateTaskModalOpen(false)}
        busy={busy}
        title={newTaskTitle}
        setTitle={setNewTaskTitle}
        description={newTaskDesc}
        setDescription={setNewTaskDesc}
        priority={newTaskPriority}
        setPriority={setNewTaskPriority}
        requirePlan={newTaskRequirePlan}
        setRequirePlan={setNewTaskRequirePlan}
        autoApprovePlan={newTaskAutoApprovePlan}
        setAutoApprovePlan={setNewTaskAutoApprovePlan}
        autoStart={newTaskAutoStart}
        setAutoStart={setNewTaskAutoStart}
        onCreate={createManualTask}
        repoName={selectedRepo?.name ?? "selected repo"}
      />

      <EditTaskModal
        open={editTaskModalOpen}
        onClose={() => setEditTaskModalOpen(false)}
        busy={busy}
        title={editTaskTitle}
        setTitle={setEditTaskTitle}
        description={editTaskDesc}
        setDescription={setEditTaskDesc}
        priority={editTaskPriority}
        setPriority={setEditTaskPriority}
        requirePlan={editTaskRequirePlan}
        setRequirePlan={setEditTaskRequirePlan}
        autoApprovePlan={editTaskAutoApprovePlan}
        setAutoApprovePlan={setEditTaskAutoApprovePlan}
        autoStart={editTaskAutoStart}
        setAutoStart={setEditTaskAutoStart}
        onSave={saveTaskEdits}
      />
    </div>
  );
}
