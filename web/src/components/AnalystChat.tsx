import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { marked } from "marked";
import type { RunLogEntry } from "../types";

// Configure marked for safe HTML output
marked.setOptions({ breaks: true, gfm: true });

// --- Types ---

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  textParts: string[];
  thinkingParts: string[];
  toolSteps: ToolStep[];
};

type ToolStep = {
  tool: string;
  input: string;
  output: string;
  status: "done" | "running";
};

// --- Grouping logic ---

function groupLogsIntoTurns(logs: RunLogEntry[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;

  const pushCurrent = () => {
    if (current && (current.textParts.length || current.thinkingParts.length || current.toolSteps.length)) {
      turns.push(current);
    }
  };

  for (const log of logs) {
    if (log.type === "user_message") {
      pushCurrent();
      turns.push({ id: `user-${turns.length}`, role: "user", textParts: [log.data], thinkingParts: [], toolSteps: [] });
      current = null;
      continue;
    }

    if (log.type === "turn_separator") {
      pushCurrent();
      current = null;
      continue;
    }

    // Everything else is assistant
    if (!current || current.role !== "assistant") {
      pushCurrent();
      current = { id: `asst-${turns.length}`, role: "assistant", textParts: [], thinkingParts: [], toolSteps: [] };
    }

    if (log.type === "agent_text") {
      current.textParts.push(log.data);
    } else if (log.type === "thinking") {
      current.thinkingParts.push(log.data);
    } else if (log.type === "tool_use") {
      let tool = "tool", input = "";
      try {
        const p = JSON.parse(log.data);
        tool = p.tool || "tool";
        input = typeof p.input === "string" ? p.input : JSON.stringify(p.input ?? "");
      } catch { /* raw */ }
      current.toolSteps.push({ tool, input, output: "", status: "running" });
    } else if (log.type === "tool_result") {
      let output = log.data;
      try {
        const p = JSON.parse(log.data);
        output = p.output || log.data;
      } catch { /* raw */ }
      // Attach to last running tool step
      const lastRunning = [...current.toolSteps].reverse().find((s) => s.status === "running");
      if (lastRunning) {
        lastRunning.output = output;
        lastRunning.status = "done";
      }
    }
  }
  pushCurrent();
  return turns;
}

function categorize(tool: string): string {
  const t = tool.toLowerCase();
  if (t === "read") return "read";
  if (t === "edit" || t === "apply_patch") return "edit";
  if (t === "write") return "write";
  if (t === "grep" || t === "glob" || t === "search") return "search";
  if (t === "bash") return "terminal";
  if (t === "list" || t === "list_files" || t === "ls") return "folder";
  return "tool";
}

function summarizeTool(step: ToolStep): string {
  const t = step.tool.toLowerCase();
  try {
    const inp = typeof step.input === "string" ? JSON.parse(step.input) : step.input;
    if (t === "read" && inp.file_path) return `Read ${basename(inp.file_path)}`;
    if (t === "edit" && inp.file_path) return `Edit ${basename(inp.file_path)}`;
    if (t === "write" && inp.file_path) return `Write ${basename(inp.file_path)}`;
    if ((t === "grep" || t === "search") && inp.pattern) return `Search "${inp.pattern}"`;
    if (t === "glob" && inp.pattern) return `Glob ${inp.pattern}`;
    if (t === "bash" && inp.command) return `Run ${inp.command.slice(0, 40)}`;
  } catch { /* ignore */ }
  return step.tool;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

// --- Markdown rendering ---

function renderMarkdown(text: string): string {
  // Strip TASK_OUTPUT markers for display
  const cleaned = text
    .replace(/---TASK_OUTPUT_START---/g, "")
    .replace(/---TASK_OUTPUT_END---/g, "")
    .trim();
  if (!cleaned) return "";
  try {
    return marked.parse(cleaned) as string;
  } catch {
    return cleaned;
  }
}

// --- Components ---

function ToolIcon({ category }: { category: string }) {
  const icons: Record<string, React.ReactNode> = {
    read: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>,
    edit: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>,
    write: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>,
    search: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>,
    terminal: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>,
    folder: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>,
    tool: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743" /></svg>,
  };
  return icons[category] || icons.tool;
}

function StatusDot({ status }: { status: "done" | "running" }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
      status === "running" ? "bg-blue-400 animate-pulse" : "bg-green-500"
    }`} />
  );
}

function ToolTimeline({ steps }: { steps: ToolStep[] }) {
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 0) return null;

  const hasRunning = steps.some((s) => s.status === "running");
  const label = hasRunning ? "Working" : `${steps.length} step${steps.length === 1 ? "" : "s"}`;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1 text-[13px] text-text-muted hover:text-text-secondary transition"
      >
        <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        <span className="font-medium inline-flex items-center gap-1.5">
          {hasRunning && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
          {label}
        </span>
        {!expanded && steps.length > 0 && (
          <span className="text-[11px] text-text-muted/70 truncate max-w-[300px]">
            {summarizeTool(steps[steps.length - 1])}
          </span>
        )}
      </button>
      {expanded && (
        <div className="ml-1 mt-1 pl-3 border-l-2 border-border-strong space-y-0.5">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 min-h-[22px]">
              <StatusDot status={step.status} />
              <ToolIcon category={categorize(step.tool)} />
              <span className="text-[12px] text-text-secondary font-medium truncate max-w-[180px]">{step.tool}</span>
              <span className="text-[11px] text-text-muted truncate min-w-0">{summarizeTool(step)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ parts }: { parts: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (parts.length === 0) return null;

  const combined = parts.join("\n\n");
  const preview = combined.slice(0, 100) + (combined.length > 100 ? "..." : "");

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[12px] text-text-muted/70 hover:text-text-muted transition"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        <span className="font-medium">Thinking</span>
        {!expanded && <span className="truncate max-w-[250px] text-[11px]">{preview}</span>}
      </button>
      {expanded && (
        <pre className="mt-1 ml-4 pl-3 border-l-2 border-text-muted/20 text-[11px] text-text-muted/70 whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {combined}
        </pre>
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-brand/10 border border-brand/20 px-4 py-2.5 text-[14px] leading-relaxed text-text-primary">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ turn, isStreaming }: { turn: ChatTurn; isStreaming: boolean }) {
  const fullText = turn.textParts.join("");
  const html = useMemo(() => renderMarkdown(fullText), [fullText]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[650px] w-full">
        {html && (
          <div
            className="analyst-markdown text-[14px] leading-[1.65] text-text-primary antialiased"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {!html && isStreaming && (
          <div className="flex items-center gap-1.5 py-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-muted animate-pulse" />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-muted animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-muted animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        <ThinkingBlock parts={turn.thinkingParts} />
        <ToolTimeline steps={turn.toolSteps} />
      </div>
    </div>
  );
}

// --- Main Component ---

export function AnalystChat({
  logs,
  className = "",
  isStreaming = false,
}: {
  logs: RunLogEntry[];
  className?: string;
  isStreaming?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const turns = useMemo(() => groupLogsIntoTurns(logs), [logs]);

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (atBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [turns, atBottom]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 60;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
    }
  }, []);

  if (turns.length === 0) return null;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-6 py-4 space-y-5"
      >
        {turns.map((turn) =>
          turn.role === "user" ? (
            <UserBubble key={turn.id} text={turn.textParts.join("")} />
          ) : (
            <AssistantMessage key={turn.id} turn={turn} isStreaming={isStreaming && turn === turns[turns.length - 1]} />
          ),
        )}
      </div>

      {!atBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-300/90 px-3 py-1.5 text-[11px] font-medium text-text-secondary shadow-lg backdrop-blur-sm transition hover:bg-surface-400 hover:text-text-primary"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
          </svg>
        </button>
      )}
    </div>
  );
}
