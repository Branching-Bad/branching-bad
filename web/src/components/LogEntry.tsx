import { useState } from "react";

export function LogEntry({ type, data }: { type: string; data: string }) {
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
