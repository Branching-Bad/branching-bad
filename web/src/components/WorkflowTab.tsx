import { type FC } from 'react';

export const WorkflowTab: FC<{ repoId: string | null }> = ({ repoId }) => {
  if (!repoId) {
    return <div className="p-6 text-sm text-neutral-400">Select a repo to view workflows.</div>;
  }
  return (
    <div className="flex h-full items-center justify-center text-neutral-500">
      Workflow — coming online…
    </div>
  );
};
