import type { FormEvent } from "react";
import type { Repo } from "../types";
import { RepositoryPanel } from "../components/sections/RepositoryPanel";
import { ViewShell } from "./ViewShell";

export function RepositoriesView(props: {
  repos: Repo[];
  selectedRepoId: string;
  setSelectedRepoId: (v: string) => void;
  busy: boolean;
  onRepoSubmit: (e: FormEvent) => void;
  repoPath: string;
  setRepoPath: (v: string) => void;
  repoName: string;
  setRepoName: (v: string) => void;
  onReposChange?: () => void;
}) {
  return (
    <ViewShell title="Repositories" subtitle="Manage repositories, default branches, and build commands">
      <RepositoryPanel {...props} />
    </ViewShell>
  );
}
