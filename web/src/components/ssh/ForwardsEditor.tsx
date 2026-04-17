import { useState } from "react";
import type { SshForward } from "../../types";

type Forward = Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>;

export function ForwardsEditor({
  forwards,
  onChange,
}: {
  forwards: Forward[];
  onChange: (next: Forward[]) => void;
}) {
  const set = (i: number, patch: Partial<Forward>) =>
    onChange(forwards.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () =>
    onChange([...forwards, { forwardType: 'local', bindAddress: '127.0.0.1', bindPort: 8080, remoteHost: 'localhost', remotePort: 80 }]);
  const remove = (i: number) =>
    onChange(forwards.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {forwards.length === 0 && (
        <p className="text-[11px] italic text-text-muted">No port forwards configured.</p>
      )}
      {forwards.map((f, i) => (
        <ForwardRow
          key={i}
          forward={f}
          onChange={(patch) => set(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}
      <button
        onClick={add}
        className="text-[11px] font-medium text-brand hover:text-brand/80"
      >
        + Add Forward
      </button>
    </div>
  );
}

function ForwardRow({
  forward: f,
  onChange,
  onRemove,
}: {
  forward: Forward;
  onChange: (patch: Partial<Forward>) => void;
  onRemove: () => void;
}) {
  const [advanced, setAdvanced] = useState(f.bindAddress !== '127.0.0.1');

  return (
    <div className="space-y-2 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-1 min-w-[140px] items-center gap-1.5 text-[11px] text-text-muted">
          Target host
          <input
            value={f.remoteHost}
            onChange={(e) => onChange({ remoteHost: e.target.value })}
            className="flex-1 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="localhost"
          />
        </label>

        <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
          Server port
          <input
            type="number"
            value={f.remotePort}
            onChange={(e) => onChange({ remotePort: Number(e.target.value) || 0 })}
            className="w-20 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="port"
          />
        </label>

        <span className="text-text-muted">→</span>

        <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
          Local port
          <input
            type="number"
            value={f.bindPort}
            onChange={(e) => onChange({ bindPort: Number(e.target.value) || 0 })}
            className="w-20 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="port"
          />
        </label>

        <button
          onClick={() => setAdvanced(!advanced)}
          className="text-[10px] font-medium text-text-muted hover:text-text-primary"
          title="Bind address (advanced)"
        >
          {advanced ? '▾ Advanced' : '▸ Advanced'}
        </button>

        <button
          onClick={onRemove}
          className="text-text-muted hover:text-status-danger"
          title="Remove"
        >
          ×
        </button>
      </div>

      <p className="text-[10px] text-text-muted">
        <code>target host:server port</code> reachable <em>from the SSH server</em> (use
        <code> localhost</code> for services on the SSH host itself). Exposed on your
        machine at <code>local port</code>.
      </p>

      {advanced && (
        <div className="flex items-center gap-2 border-t border-border-default/60 pt-2">
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
            Bind address
            <input
              value={f.bindAddress}
              onChange={(e) => onChange({ bindAddress: e.target.value })}
              className="w-28 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
              placeholder="127.0.0.1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
