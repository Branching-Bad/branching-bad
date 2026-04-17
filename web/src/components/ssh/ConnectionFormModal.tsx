import { useEffect, useState } from "react";
import type { SshConnection, SshGroup, SshForward } from "../../types";
import { ForwardsEditor } from "./ForwardsEditor";
import { FolderPicker } from "../FolderPicker";
import { IconX } from "../icons";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../shared";

type Forward = Omit<SshForward, 'id' | 'connectionId' | 'createdAt'>;

export interface ConnectionFormValue {
  alias: string;
  groupId: string | null;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  keyPath: string | null;
  password: string;
  passphrase: string;
  jumpHostId: string | null;
  forwards: Forward[];
}

export function ConnectionFormModal({
  open,
  onClose,
  initial,
  groups,
  connections,
  onCreateGroup,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: SshConnection | null;
  groups: SshGroup[];
  connections: SshConnection[];
  onCreateGroup: (name: string) => Promise<SshGroup>;
  onSave: (value: ConnectionFormValue) => Promise<void>;
}) {
  const [v, setV] = useState<ConnectionFormValue>(() => valueFromInitial(initial));
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setV(valueFromInitial(initial)); setError(""); } }, [open, initial]);

  if (!open) return null;

  const handleSave = async () => {
    setError("");
    if (!v.alias.trim()) return setError("Alias required");
    if (!v.host.trim()) return setError("Host required");
    if (!v.username.trim()) return setError("Username required");
    const effectivePort = v.port || 22;
    if (effectivePort < 1 || effectivePort > 65535) return setError("Port out of range");
    if (v.authType === 'key' && !v.keyPath) return setError("Key path required");
    setSaving(true);
    try {
      await onSave({ ...v, port: effectivePort });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleGroupChange = async (val: string) => {
    if (val === '__new__') {
      const name = window.prompt("New group name:");
      if (!name?.trim()) return;
      const g = await onCreateGroup(name.trim());
      setV((p) => ({ ...p, groupId: g.id }));
    } else {
      setV((p) => ({ ...p, groupId: val || null }));
    }
  };

  const jumpCandidates = connections.filter(
    (c) => !c.jumpHostId && (!initial || c.id !== initial.id),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
        <header className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h3 className="text-[15px] font-semibold text-text-primary">
            {initial ? `Edit ${initial.alias}` : "New SSH Connection"}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <IconX className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-[12px]">
          {error && (
            <div className="rounded-[var(--radius-md)] border border-error-border bg-error-bg px-3 py-2 text-error-text">{error}</div>
          )}

          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Identity</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Alias *"><input className={inputClass} value={v.alias} onChange={(e) => setV((p) => ({ ...p, alias: e.target.value }))} /></Field>
              <Field label="Group">
                <select className={selectClass} value={v.groupId ?? ""} onChange={(e) => void handleGroupChange(e.target.value)}>
                  <option value="">— None —</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="__new__">+ New group…</option>
                </select>
              </Field>
              <Field label="Host *"><input className={inputClass} value={v.host} onChange={(e) => setV((p) => ({ ...p, host: e.target.value }))} /></Field>
              <Field label="Port"><input type="number" className={inputClass} value={v.port || ""} placeholder="22" onChange={(e) => setV((p) => ({ ...p, port: e.target.value === "" ? 0 : Number(e.target.value) }))} /></Field>
              <Field label="Username *"><input className={inputClass} value={v.username} onChange={(e) => setV((p) => ({ ...p, username: e.target.value }))} /></Field>
              <Field label="Auth type">
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={v.authType === 'password'} onChange={() => setV((p) => ({ ...p, authType: 'password' }))} /> Password</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={v.authType === 'key'} onChange={() => setV((p) => ({ ...p, authType: 'key' }))} /> Key (PEM)</label>
                </div>
              </Field>
              {v.authType === 'password' && (
                <Field label={initial ? "Password (leave blank to keep)" : "Password"}>
                  <input type="password" className={inputClass} value={v.password} onChange={(e) => setV((p) => ({ ...p, password: e.target.value }))} />
                </Field>
              )}
              {v.authType === 'key' && (
                <>
                  <Field label="Key path *">
                    <FolderPicker mode="file" value={v.keyPath ?? ""} onChange={(val) => setV((p) => ({ ...p, keyPath: val }))} />
                  </Field>
                  <Field label={initial ? "Passphrase (leave blank to keep)" : "Passphrase (optional)"}>
                    <input type="password" className={inputClass} value={v.passphrase} onChange={(e) => setV((p) => ({ ...p, passphrase: e.target.value }))} />
                  </Field>
                </>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Jump host (optional)</h4>
            <Field label="Via">
              <select className={selectClass} value={v.jumpHostId ?? ""} onChange={(e) => setV((p) => ({ ...p, jumpHostId: e.target.value || null }))}>
                <option value="">— None —</option>
                {jumpCandidates.map((c) => <option key={c.id} value={c.id}>{c.alias}</option>)}
              </select>
            </Field>
          </section>

          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">Port forwards (optional)</h4>
            <ForwardsEditor forwards={v.forwards} onChange={(next) => setV((p) => ({ ...p, forwards: next }))} />
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-default px-6 py-3">
          <button onClick={onClose} className={btnSecondary}>Cancel</button>
          <button onClick={() => void handleSave()} disabled={saving} className={btnPrimary}>
            {saving ? "Saving…" : initial ? "Save Changes" : "Create Connection"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function valueFromInitial(initial: SshConnection | null): ConnectionFormValue {
  if (!initial) return {
    alias: "", groupId: null, host: "", port: 22, username: "",
    authType: 'password', keyPath: null, password: "", passphrase: "",
    jumpHostId: null, forwards: [],
  };
  return {
    alias: initial.alias,
    groupId: initial.groupId,
    host: initial.host,
    port: initial.port,
    username: initial.username,
    authType: initial.authType,
    keyPath: initial.keyPath,
    password: "",
    passphrase: "",
    jumpHostId: initial.jumpHostId,
    forwards: initial.forwards.map((f) => ({
      forwardType: f.forwardType, bindAddress: f.bindAddress,
      bindPort: f.bindPort, remoteHost: f.remoteHost, remotePort: f.remotePort,
    })),
  };
}
