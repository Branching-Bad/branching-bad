import { useState } from "react";
import { hasAnsi } from "fancy-ansi";
import { AnsiHtml } from "fancy-ansi/react";

function AnsiText({ text, className }: { text: string; className?: string }) {
  if (hasAnsi(text)) {
    return <AnsiHtml text={text} className={className} />;
  }
  return <span className={className}>{text}</span>;
}

export function LogEntry({ type, data }: { type: string; data: string }) {
  const [expanded, setExpanded] = useState(false);

  if (type === "thinking") {
    return (
      <div className="group">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 text-left text-status-info/80 hover:text-status-info transition"
        >
          <svg className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          <span className="font-medium text-[11px] uppercase tracking-wide">Thinking</span>
          {!expanded && <span className="truncate text-status-info/50 font-mono">{data.slice(0, 120)}{data.length > 120 ? "..." : ""}</span>}
        </button>
        {expanded && (
          <pre className="mt-1 ml-4.5 whitespace-pre-wrap text-status-info/70 font-mono border-l-2 border-status-info/20 pl-3">{data}</pre>
        )}
      </div>
    );
  }

  if (type === "agent_text") {
    return (
      <div className="font-mono whitespace-pre-wrap">
        <AnsiText text={data} className="text-text-primary" />
      </div>
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
      <div className="flex items-start gap-2 text-status-warning/90">
        <svg className="h-3.5 w-3.5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743" />
        </svg>
        <div className="min-w-0">
          <span className="font-semibold">{tool}</span>
          {input && <pre className="mt-0.5 text-status-warning/50 truncate max-w-full">{input.slice(0, 200)}</pre>}
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

    const lines = output.split("\n");
    const isLong = lines.length > 3;
    const previewText = isLong ? lines.slice(0, 3).join("\n") : output;

    return (
      <div className="text-status-success/70 ml-5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-status-success/50">{tool} result</span>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-status-success/50 hover:text-status-success transition"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
        {output && (
          <pre className={`whitespace-pre-wrap font-mono ${expanded ? "max-h-[400px] overflow-y-auto" : ""}`}>
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
      <div className="text-text-muted font-mono whitespace-pre-wrap">
        <span className="text-text-muted/60 uppercase text-[10px] tracking-wider mr-2">{eventType}</span>
        {detail}
      </div>
    );
  }

  if (type === "user_message") {
    return (
      <div className="flex items-start gap-2 bg-status-info-soft border border-status-info/20 rounded-lg p-3 my-2">
        <svg className="w-4 h-4 text-status-info mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
        <span className="text-text-primary text-sm whitespace-pre-wrap">{data}</span>
      </div>
    );
  }

  if (type === "turn_separator") {
    return (
      <div className="flex items-center gap-2 my-3">
        <div className="flex-1 border-t border-border-strong" />
        <span className="text-xs text-text-muted">Follow-up</span>
        <div className="flex-1 border-t border-border-strong" />
      </div>
    );
  }

  // other
  return <div className="text-text-muted font-mono">{data}</div>;
}
