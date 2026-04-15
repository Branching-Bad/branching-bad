import { useEffect } from "react";
import type { Route } from "./useHashRoute";

const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

export function useGlobalShortcuts(navigate: (r: Route) => void, onOpenRepoSwitcher: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        if (!["1", "2", "3"].includes(e.key)) return;
      }

      if (e.key === "1") { e.preventDefault(); navigate("board"); return; }
      if (e.key === "2") { e.preventDefault(); navigate("analyst"); return; }
      if (e.key === "3") { e.preventDefault(); navigate("workflow"); return; }
      if (e.key === ",") { e.preventDefault(); navigate("repos"); return; }
      if (e.shiftKey && (e.key === "E" || e.key === "e")) {
        e.preventDefault();
        navigate("extensions");
        return;
      }
      if (e.key === "r" || e.key === "R") {
        if (e.shiftKey) {
          e.preventDefault();
          onOpenRepoSwitcher();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, onOpenRepoSwitcher]);
}

export const SHORTCUT_LABELS = {
  modKey: isMac ? "\u2318" : "Ctrl",
} as const;
