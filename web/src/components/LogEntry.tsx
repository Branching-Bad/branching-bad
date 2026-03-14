import { useState } from "react";
import { hasAnsi } from "fancy-ansi";
import { AnsiHtml } from "fancy-ansi/react";

function AnsiText({ text, className }: { text: string; className?: string }) {
  if (hasAnsi(text)) {
    return <AnsiHtml text={text} className={className} />;
  }
  return <span className={className}>{text}</span>;
}

/* ── Tool helpers (matching AnalystChat style) ── */

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

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function summarizeTool(tool: string, input: string): string {
  const t = tool.toLowerCase();
  try {
    const inp = typeof input === "string" ? JSON.parse(input) : input;
    if (t === "read" && inp.file_path) return basename(inp.file_path);
    if (t === "edit" && inp.file_path) return basename(inp.file_path);
    if (t === "write" && inp.file_path) return basename(inp.file_path);
    if ((t === "grep" || t === "search") && inp.pattern) return `"${inp.pattern}"`;
    if (t === "glob" && inp.pattern) return inp.pattern;
    if (t === "bash" && inp.command) return inp.command.slice(0, 60);
  } catch { /* ignore */ }
  return "";
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  read: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>,
  edit: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>,
  write: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>,
  search: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>,
  terminal: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>,
  folder: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>,
  tool: <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743" /></svg>,
};

const CATEGORY_COLORS: Record<string, string> = {
  read: "text-blue-400",
  edit: "text-amber-400",
  write: "text-emerald-400",
  search: "text-purple-400",
  terminal: "text-cyan-400",
  folder: "text-orange-400",
  tool: "text-text-muted",
};

/* ── Main Component ── */

export function LogEntry({ type, data }: { type: string; data: string }) {
  const [expanded, setExpanded] = useState(false);

  if (type === "thinking") {
    const preview = data.slice(0, 120) + (data.length > 120 ? "..." : "");
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 text-left text-text-muted/70 hover:text-text-muted transition"
        >
          <svg className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          <span className="font-medium text-[11px]">Thinking</span>
          {!expanded && <span className="truncate text-text-muted/50 text-[10px]">{preview}</span>}
        </button>
        {expanded && (
          <pre className="mt-1 ml-4 pl-3 border-l-2 border-text-muted/20 whitespace-pre-wrap text-text-muted/60 text-[10px] max-h-[300px] overflow-y-auto">{data}</pre>
        )}
      </div>
    );
  }

  if (type === "agent_text") {
    return (
      <div className="whitespace-pre-wrap">
        <AnsiText text={data} className="text-text-primary" />
      </div>
    );
  }

  if (type === "tool_use") {
    let tool = data, input = "";
    try {
      const parsed = JSON.parse(data);
      tool = parsed.tool || "tool";
      input = typeof parsed.input === "string" ? parsed.input : JSON.stringify(parsed.input ?? "");
    } catch { /* raw string */ }

    const cat = categorize(tool);
    const summary = summarizeTool(tool, input);
    const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.tool;

    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        <span className={color}>{TOOL_ICONS[cat] ?? TOOL_ICONS.tool}</span>
        <span className={`font-medium text-[11px] ${color}`}>{tool}</span>
        {summary && <span className="text-[10px] text-text-muted truncate">{summary}</span>}
      </div>
    );
  }

  if (type === "tool_result") {
    let tool = "", output = data;
    try {
      const parsed = JSON.parse(data);
      tool = parsed.tool || "";
      output = parsed.output || "";
    } catch { /* raw string */ }

    const lines = output.split("\n");
    const isLong = lines.length > 3;
    const previewText = isLong ? lines.slice(0, 3).join("\n") : output;
    const cat = tool ? categorize(tool) : "tool";
    const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.tool;

    return (
      <div className="ml-5 pl-3 border-l-2 border-border-strong py-0.5">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          {tool && <span className={`font-medium text-[10px] ${color}`}>{tool}</span>}
          <span className="text-[10px] text-text-muted/50">result</span>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-text-muted/50 hover:text-text-muted transition"
            >
              {expanded ? "collapse" : `+${lines.length - 3} lines`}
            </button>
          )}
        </div>
        {output && (
          <pre className={`mt-0.5 whitespace-pre-wrap font-mono text-[10px] text-text-muted/70 ${expanded ? "max-h-[400px] overflow-y-auto" : ""}`}>
            {expanded ? output : previewText}
            {!expanded && isLong ? "\n..." : ""}
          </pre>
        )}
      </div>
    );
  }

  if (type === "stderr") {
    return (
      <div className="font-mono whitespace-pre-wrap">
        <AnsiText text={data} className="text-status-danger" />
      </div>
    );
  }

  if (type === "stdout") {
    return (
      <div className="font-mono whitespace-pre-wrap">
        <AnsiText text={data} className="text-status-success" />
      </div>
    );
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
      <div className="flex items-center gap-2 py-0.5 text-text-muted/60">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-muted/30 shrink-0" />
        <span className="text-[10px] uppercase tracking-wider font-medium">{eventType}</span>
        <span className="text-[10px] truncate">{detail}</span>
      </div>
    );
  }

  if (type === "user_message") {
    return (
      <div className="flex items-start gap-2 bg-brand/5 border border-brand/15 rounded-lg px-3 py-2 my-1">
        <svg className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
        <span className="text-text-primary text-[11px] whitespace-pre-wrap">{data}</span>
      </div>
    );
  }

  if (type === "turn_separator") {
    return (
      <div className="flex items-center gap-2 my-2">
        <div className="flex-1 border-t border-border-strong/50" />
        <span className="text-[10px] text-text-muted/50 font-medium">Follow-up</span>
        <div className="flex-1 border-t border-border-strong/50" />
      </div>
    );
  }

  // other
  return <div className="text-text-muted/60 text-[10px]">{data}</div>;
}
