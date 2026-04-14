import { type FC } from 'react';
import { useWorkflow } from '../hooks/useWorkflow';
import { WorkflowList } from './WorkflowList';

export const WorkflowTab: FC<{ repoId: string | null }> = ({ repoId }) => {
  const { workflows, selected, selectedId, setSelectedId, refreshList } = useWorkflow(repoId);

  if (!repoId) {
    return <div className="p-6 text-sm text-neutral-400">Select a repo to view workflows.</div>;
  }

  return (
    <div className="flex h-full">
      <WorkflowList
        repoId={repoId}
        workflows={workflows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={() => void refreshList()}
      />
      <main className="flex-1 overflow-auto">
        {selected
          ? <div className="p-4 text-text-muted text-sm">Canvas coming in next task — selected: {selected.name}</div>
          : <div className="p-6 text-text-muted text-sm">Select or create a workflow.</div>}
      </main>
    </div>
  );
};
