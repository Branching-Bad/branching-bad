import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function TaskContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const estimatedHeight = Math.min(items.length * 32 + 8, 280);
  const estimatedWidth = 200;
  const top = Math.min(y, window.innerHeight - estimatedHeight - 8);
  const left = Math.min(x, window.innerWidth - estimatedWidth - 8);

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: "fixed", top, left, zIndex: 100 }}
      className="min-w-[180px] rounded-md border border-border-strong bg-surface-200 py-1 shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`block w-full px-3 py-1.5 text-left text-[12px] transition ${
            item.danger
              ? "text-status-danger hover:bg-status-danger/10"
              : "text-text-primary hover:bg-surface-300"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
