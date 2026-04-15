import { DataPanel } from "../components/sections/DataPanel";
import { ViewShell } from "./ViewShell";

export function DataView({ onClearOutputs }: { onClearOutputs?: () => Promise<void> }) {
  return (
    <ViewShell title="Data" subtitle="Application update and output log maintenance">
      <DataPanel onClearOutputs={onClearOutputs} />
    </ViewShell>
  );
}
