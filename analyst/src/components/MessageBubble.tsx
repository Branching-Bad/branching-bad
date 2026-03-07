import { useState } from "react";
import type { RunLogEntry } from "../types";
import { IconChevronRight, IconChevronDown } from "./Icons";

interface Props {
  entry: RunLogEntry;
}

export default function MessageBubble({ entry }: Props) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (entry.type === "user_message") {
    return (
      <div className="flex justify-end animate-slide-up">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-brand/10 border border-brand/15 text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
          {entry.data}
        </div>
      </div>
    );
  }

  if (entry.type === "thinking") {
    return (
      <div className="flex justify-start animate-slide-in-left">
        <div className="max-w-[85%]">
          <button
            onClick={() => setThinkingOpen(!thinkingOpen)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors py-1 group"
          >
            {thinkingOpen
              ? <IconChevronDown className="w-3 h-3 text-text-muted group-hover:text-text-secondary transition-colors" />
              : <IconChevronRight className="w-3 h-3 text-text-muted group-hover:text-text-secondary transition-colors" />
            }
            <span className="italic">Thinking...</span>
          </button>
          {thinkingOpen && (
            <div className="mt-1 px-4 py-2.5 rounded-xl bg-surface-200/50 border border-border-default text-xs text-text-muted leading-relaxed whitespace-pre-wrap animate-fade-in">
              {entry.data}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (entry.type === "agent_text") {
    return (
      <div className="flex justify-start animate-slide-in-left">
        <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-surface-200 border border-border-default text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
          {entry.data}
        </div>
      </div>
    );
  }

  if (entry.type === "turn_separator") {
    return (
      <div className="flex items-center gap-3 py-2 animate-fade-in">
        <div className="flex-1 h-px bg-border-default" />
        <span className="text-[10px] text-text-muted uppercase tracking-widest font-medium">Turn</span>
        <div className="flex-1 h-px bg-border-default" />
      </div>
    );
  }

  return null;
}
