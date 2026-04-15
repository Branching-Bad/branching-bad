import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

function wsUrl(ptyId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/ssh/pty/${encodeURIComponent(ptyId)}/ws`;
}

export function Terminal({
  ptyId,
  active,
  onClose,
}: {
  ptyId: string;
  active: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Xterm({
      fontFamily: 'Menlo, Consolas, "Courier New", monospace',
      fontSize: 13,
      theme: { background: '#0b0f14', foreground: '#e6e6e6' },
      cursorBlink: true,
      scrollback: 10000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const ws = new WebSocket(wsUrl(ptyId));
    ws.onopen = () => {
      try {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      } catch { /* ignore */ }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'data' && typeof msg.data === 'string') {
          term.write(msg.data);
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => { onClose(); };

    const sendWrite = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'write', data }));
      }
    };
    term.onData(sendWrite);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const { cols, rows } = term;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      } catch { /* ignore */ }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      try { ws.close(); } catch { /* ignore */ }
      term.dispose();
    };
  }, [ptyId, onClose]);

  return <div ref={containerRef} className={active ? "h-full w-full" : "hidden h-full w-full"} />;
}
