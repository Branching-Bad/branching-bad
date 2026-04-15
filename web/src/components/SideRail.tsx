import type { ComponentType } from "react";
import type { Repo } from "../types";
import type { Route } from "../hooks/useHashRoute";
import { RepoSwitcher } from "./RepoSwitcher";
import {
  IconBoard,
  IconAnalyst,
  IconWorkflow,
  IconExtensions,
  IconSettings,
} from "./icons";

type NavItem = {
  route: Route;
  label: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  badge?: number;
};

export function SideRail({
  route,
  navigate,
  repos,
  selectedRepoId,
  setSelectedRepoId,
  providerItemCount,
  repoSwitcherOpen,
  setRepoSwitcherOpen,
  onClearQueue,
  clearQueueDisabled,
  modLabel,
}: {
  route: Route;
  navigate: (r: Route) => void;
  repos: Repo[];
  selectedRepoId: string;
  setSelectedRepoId: (id: string) => void;
  providerItemCount: number;
  repoSwitcherOpen: boolean;
  setRepoSwitcherOpen: (v: boolean) => void;
  onClearQueue: () => void;
  clearQueueDisabled: boolean;
  modLabel: string;
}) {
  const workspaceItems: NavItem[] = [
    { route: "board", label: "Board", icon: IconBoard, shortcut: `${modLabel}1` },
    { route: "analyst", label: "Task Analyst", icon: IconAnalyst, shortcut: `${modLabel}2` },
    { route: "workflow", label: "Workflow", icon: IconWorkflow, shortcut: `${modLabel}3` },
  ];

  const configureItems: NavItem[] = [
    { route: "extensions", label: "Extensions", icon: IconExtensions, badge: providerItemCount > 0 ? providerItemCount : undefined },
    { route: "agents", label: "AI Agents", icon: IconAgentsRail },
    { route: "rules", label: "Rules", icon: IconRulesRail },
    { route: "memories", label: "Memories", icon: IconMemoriesRail },
    { route: "glossary", label: "Glossary", icon: IconGlossaryRail },
    { route: "repos", label: "Repositories", icon: IconReposRail },
    { route: "data", label: "Data", icon: IconDataRail },
  ];

  return (
    <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-border-default bg-surface-0/90 backdrop-blur-md">
      <div className="flex items-center gap-2.5 border-b border-border-default px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-glow bg-brand-dark">
          <span className="text-sm font-bold text-brand">B</span>
        </div>
        <h1 className="text-sm font-semibold text-text-primary">Branching Bad</h1>
      </div>

      <div className="border-b border-border-default px-3 py-3">
        <RepoSwitcher
          repos={repos}
          selectedRepoId={selectedRepoId}
          setSelectedRepoId={setSelectedRepoId}
          onAddRepository={() => navigate("repos")}
          open={repoSwitcherOpen}
          onOpenChange={setRepoSwitcherOpen}
        />
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-3">
        <NavGroup title="Workspace" items={workspaceItems} route={route} navigate={navigate} />
        <NavGroup title="Configure" items={configureItems} route={route} navigate={navigate} />
      </nav>

      <div className="border-t border-border-default p-2.5">
        <button
          onClick={onClearQueue}
          disabled={clearQueueDisabled}
          className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-[12px] font-medium text-text-muted transition hover:bg-surface-200 hover:text-text-primary disabled:opacity-40"
          title="Clear all stuck pipelines"
        >
          <IconSettings className="h-3.5 w-3.5" />
          Clear Queue
        </button>
      </div>
    </aside>
  );
}

function NavGroup({
  title,
  items,
  route,
  navigate,
}: {
  title: string;
  items: NavItem[];
  route: Route;
  navigate: (r: Route) => void;
}) {
  return (
    <div>
      <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{title}</p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = route === item.route;
          return (
            <button
              key={item.route}
              onClick={() => navigate(item.route)}
              className={`group flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-medium transition ${
                active
                  ? "bg-brand-tint text-text-primary shadow-[inset_0_0_0_1px_var(--color-brand-glow)]"
                  : "text-text-secondary hover:bg-surface-200 hover:text-text-primary"
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? "text-brand" : "text-text-muted group-hover:text-text-secondary"}`} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge !== undefined && (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-status-danger px-1 text-[9px] font-bold text-white">
                  {item.badge}
                </span>
              )}
              {item.shortcut && !item.badge && (
                <span className="text-[10px] text-text-muted/70">{item.shortcut}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IconAgentsRail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

function IconRulesRail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </svg>
  );
}

function IconMemoriesRail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  );
}

function IconGlossaryRail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function IconReposRail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function IconDataRail({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  );
}
