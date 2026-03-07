import { useRef, useCallback, useEffect } from "react";
import { IconSend } from "./Icons";

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export default function MessageInput({ onSend, disabled, placeholder, inputRef: externalRef }: Props) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = externalRef ?? internalRef;

  const autoResize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [ref]);

  const handleSend = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || disabled) return;
    onSend(text);
    el.value = "";
    el.style.height = "auto";
  }, [onSend, disabled, ref]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  useEffect(() => {
    // Focus on mount
    ref.current?.focus();
  }, [ref]);

  return (
    <div className="flex items-end gap-2 p-3 bg-surface-100 border border-border-default rounded-xl transition-colors focus-within:border-brand/30">
      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder={placeholder ?? "Describe a task, feature, or bug..."}
        onInput={autoResize}
        onKeyDown={handleKeyDown}
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none leading-relaxed max-h-[200px]"
      />
      <button
        onClick={handleSend}
        disabled={disabled}
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-brand/10 text-brand hover:bg-brand/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <IconSend />
      </button>
    </div>
  );
}
