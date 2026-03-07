import { IconAnalyst, IconMessage } from "./Icons";

interface Props {
  variant: "no-repo" | "no-session";
}

export default function EmptyState({ variant }: Props) {
  if (variant === "no-repo") {
    return (
      <div className="flex-1 flex items-center justify-center animate-fade-in">
        <div className="text-center space-y-4 max-w-sm">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-300 border border-border-default flex items-center justify-center">
            <IconAnalyst className="w-7 h-7 text-text-muted" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">No repositories</h2>
            <p className="text-sm text-text-muted mt-1 leading-relaxed">
              Add a repository in the main app to start analyzing tasks.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center animate-fade-in">
      <div className="text-center space-y-4 max-w-sm">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-300 border border-border-default flex items-center justify-center">
          <IconMessage className="w-7 h-7 text-text-muted" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Start a conversation</h2>
          <p className="text-sm text-text-muted mt-1 leading-relaxed">
            Describe a feature, bug, or idea. The analyst will explore the codebase and draft a task definition.
          </p>
        </div>
        <div className="flex items-center justify-center gap-4 text-xs text-text-muted pt-2">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-surface-400 rounded text-[10px] font-mono border border-border-default">
              {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+K
            </kbd>
            New session
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-surface-400 rounded text-[10px] font-mono border border-border-default">
              {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+\u21B5
            </kbd>
            Send
          </span>
        </div>
      </div>
    </div>
  );
}
