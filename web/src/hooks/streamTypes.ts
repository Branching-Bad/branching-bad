export type StreamFunctions = {
  attachRunLogStream: (runId: string, taskId: string, repoId: string) => void;
  attachPlanLogStream: (jobId: string, taskId: string, repoId: string) => void;
  closeAllRunStreams: () => void;
  closeAllPlanStreams: () => void;
};
