import type { HostKeyPromptPayload } from "../../types";
import { btnPrimary, btnSecondary } from "../shared";

export function HostKeyPromptModal({
  prompt,
  onApprove,
  onCancel,
}: {
  prompt: HostKeyPromptPayload;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const danger = prompt.kind === 'mismatch';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className={`relative w-full max-w-md space-y-3 rounded-[var(--radius-2xl)] border bg-surface-100 p-5 ${danger ? 'border-status-danger' : 'border-border-default'}`}>
        <h3 className="text-[14px] font-semibold text-text-primary">
          {danger ? '⚠ Host key mismatch' : 'Unknown host key'}
        </h3>
        <p className="text-[12px] text-text-secondary">
          {prompt.host}:{prompt.port}
        </p>
        <div className="rounded bg-surface-200 p-3 font-mono text-[11px] text-text-secondary">
          <div>Fingerprint: {prompt.fingerprint}</div>
          {prompt.expected && <div className="mt-1 text-status-danger">Expected: {prompt.expected}</div>}
        </div>
        <p className="text-[11px] text-text-muted">
          {danger
            ? 'The host key does not match what we recorded. This could be a man-in-the-middle attack. Approve only if you know the server was rebuilt or re-keyed.'
            : "We've never connected to this host before. If you recognize the fingerprint, approve to continue."}
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className={btnSecondary}>Cancel</button>
          <button onClick={onApprove} className={btnPrimary}>{danger ? 'Approve (replace)' : 'Approve'}</button>
        </div>
      </div>
    </div>
  );
}
