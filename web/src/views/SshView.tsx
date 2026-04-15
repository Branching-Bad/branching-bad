import { useState } from "react";
import type { SshConnection } from "../types";
import { ConnectionList } from "../components/ssh/ConnectionList";
import { ConnectionDetail } from "../components/ssh/ConnectionDetail";
import { ConnectionFormModal, type ConnectionFormValue } from "../components/ssh/ConnectionFormModal";
import { HostKeyPromptModal } from "../components/ssh/HostKeyPromptModal";
import { MigrationBanner } from "../components/ssh/MigrationBanner";
import type { UseSshConnections } from "../hooks/useSshConnections";
import type { UseSshSessions } from "../hooks/useSshSessions";
import type { UseSshPty } from "../hooks/useSshPty";
import type { UseSshMigration } from "../hooks/useSshMigration";

export function SshView({
  sshConnections,
  sshSessions,
  sshPty,
  migration,
  setInfo,
  setError,
}: {
  sshConnections: UseSshConnections;
  sshSessions: UseSshSessions;
  sshPty: UseSshPty;
  migration: UseSshMigration;
  setInfo: (m: string) => void;
  setError: (m: string) => void;
}) {
  const { connections, groups, create, update, remove, createGroup, refresh: refreshConnections } = sshConnections;
  const { sessions, connect, approveHostKey } = sshSessions;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState<SshConnection | null>(null);
  const [pendingHostKey, setPendingHostKey] = useState<{ connectionId: string; host: string; port: number; fingerprint: string; kind: 'unknown' | 'mismatch'; expected?: string } | null>(null);

  const selected = selectedId ? connections.find((c) => c.id === selectedId) ?? null : null;

  const openNew = () => { setFormInitial(null); setFormOpen(true); };
  const openEdit = () => { setFormInitial(selected); setFormOpen(true); };

  const handleSave = async (v: ConnectionFormValue) => {
    const body = {
      alias: v.alias, groupId: v.groupId, host: v.host, port: v.port, username: v.username,
      authType: v.authType, keyPath: v.keyPath,
      password: v.password || undefined,
      passphrase: v.passphrase || undefined,
      jumpHostId: v.jumpHostId, forwards: v.forwards,
    };
    if (formInitial) await update(formInitial.id, body);
    else {
      const c = await create(body as any);
      setSelectedId(c.id);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete connection "${selected.alias}"?`)) return;
    await remove(selected.id);
    setSelectedId(null);
  };

  const tryConnect = async (connectionId: string): Promise<string | null> => {
    const res = await connect(connectionId);
    if (res.ok) return res.sessionId;
    if (res.hostKeyPrompt) {
      setPendingHostKey({ connectionId, ...res.hostKeyPrompt });
      return null;
    }
    setError(res.message || res.errorCode || 'Connection failed');
    return null;
  };

  const handleHostKeyApprove = async () => {
    if (!pendingHostKey) return;
    await approveHostKey(pendingHostKey.host, pendingHostKey.port, pendingHostKey.fingerprint);
    const connId = pendingHostKey.connectionId;
    setPendingHostKey(null);
    const sessionId = await tryConnect(connId);
    if (sessionId) setInfo('Connected.');
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        {migration.available && migration.sourcePath && (
          <MigrationBanner
            sourcePath={migration.sourcePath}
            onImport={async () => {
              const r = await migration.runImport();
              setInfo(`Imported ${r.created} connections.`);
              await refreshConnections();
            }}
            onDismiss={() => void migration.dismiss()}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <ConnectionList
            connections={connections}
            groups={groups}
            sessions={sessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={openNew}
            onImportExportDone={() => void refreshConnections()}
          />
          {selected ? (
            <ConnectionDetail
              conn={selected}
              sessions={sessions}
              pty={sshPty}
              sshSessions={sshSessions}
              onEdit={openEdit}
              onDelete={() => void handleDelete()}
              onRequestConnect={() => tryConnect(selected.id)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-text-muted">
              Select a connection or create a new one.
            </div>
          )}
        </div>
      </div>

      <ConnectionFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initial={formInitial}
        groups={groups}
        connections={connections}
        onCreateGroup={createGroup}
        onSave={handleSave}
      />

      {pendingHostKey && (
        <HostKeyPromptModal
          prompt={{
            host: pendingHostKey.host, port: pendingHostKey.port,
            fingerprint: pendingHostKey.fingerprint, kind: pendingHostKey.kind,
            expected: pendingHostKey.expected,
          }}
          onApprove={() => void handleHostKeyApprove()}
          onCancel={() => setPendingHostKey(null)}
        />
      )}
    </div>
  );
}
