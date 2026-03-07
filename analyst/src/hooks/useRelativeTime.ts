import { useState, useEffect } from "react";

const INTERVALS = [
  { label: "just now", seconds: 60 },
  { label: "m ago", seconds: 3600, divisor: 60 },
  { label: "h ago", seconds: 86400, divisor: 3600 },
  { label: "d ago", seconds: 604800, divisor: 86400 },
  { label: "w ago", seconds: 2592000, divisor: 604800 },
] as const;

function format(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 0) return "just now";
  for (const interval of INTERVALS) {
    if (diff < interval.seconds) {
      if (!("divisor" in interval)) return interval.label;
      return `${Math.floor(diff / interval.divisor)}${interval.label}`;
    }
  }
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function useRelativeTime(timestamp: number): string {
  const [text, setText] = useState(() => format(timestamp));

  useEffect(() => {
    setText(format(timestamp));
    const id = setInterval(() => setText(format(timestamp)), 30_000);
    return () => clearInterval(id);
  }, [timestamp]);

  return text;
}

export function formatRelative(ts: number): string {
  return format(ts);
}
