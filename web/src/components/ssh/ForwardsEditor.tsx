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
        <div key={i} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2">
          <select
            value={f.forwardType}
            onChange={(e) => set(i, { forwardType: e.target.value as 'local' | 'remote' })}
            className="rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
          >
            <option value="local">Local (-L)</option>
            <option value="remote">Remote (-R)</option>
          </select>
          <input
            value={f.bindAddress}
            onChange={(e) => set(i, { bindAddress: e.target.value })}
            className="w-28 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="127.0.0.1"
          />
          <input
            type="number" value={f.bindPort}
            onChange={(e) => set(i, { bindPort: Number(e.target.value) || 0 })}
            className="w-20 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="port"
          />
          <span className="text-text-muted">→</span>
          <input
            value={f.remoteHost}
            onChange={(e) => set(i, { remoteHost: e.target.value })}
            className="flex-1 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="localhost"
          />
          <input
            type="number" value={f.remotePort}
            onChange={(e) => set(i, { remotePort: Number(e.target.value) || 0 })}
            className="w-20 rounded bg-surface-300 px-2 py-1 text-[11px] text-text-primary"
            placeholder="port"
          />
          <button
            onClick={() => remove(i)}
            className="text-text-muted hover:text-status-danger"
            title="Remove"
          >
            ×
          </button>
        </div>
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
