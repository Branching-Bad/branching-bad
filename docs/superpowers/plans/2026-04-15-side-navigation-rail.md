# Side Navigation Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top navigation bar with a permanent left-side navigation rail. Promote every current Settings sub-tab and the Extensions drawer to first-class full-page views.

**Architecture:** Three-column desktop layout (260px rail + content + 540px right detail sidebar). Hash-based routing (`#board`, `#agents`, etc.) with no router library. Settings content extracted into reusable `sections/` components, then composed into per-route `views/`. `App.tsx` keeps all domain hooks; views receive data via props from `App.tsx`.

**Tech Stack:** React 19 + TypeScript + Vite 7 + Tailwind v4. No new runtime dependencies.

**Verification:** No frontend test framework exists in this codebase. Each task verifies via `npm run build` (runs `tsc --noEmit` + `vite build`) and manual browser smoke checks. Final task runs ESLint and a full regression walk-through.

**Reference spec:** `docs/superpowers/specs/2026-04-15-side-navigation-rail-design.md`

---

## Task Ordering Rationale

Tasks are ordered so each commit leaves the app in a working state:

1. Foundation (hooks + ViewShell) — new code, no deletions yet.
2. Extract sections (new files, SettingsModal still works).
3. Build views (new files using extracted sections).
4. Build rail + repo switcher.
5. Rewire `App.tsx` — the big switch. SettingsModal/ExtensionsDrawer still exist but are no longer mounted.
6. Delete obsolete files.
7. Responsive + final verification.

---

## Task 1: `useHashRoute` hook

**Files:**
- Create: `web/src/hooks/useHashRoute.ts`

- [ ] **Step 1: Create the hook file**

```typescript
// web/src/hooks/useHashRoute.ts
import { useCallback, useEffect, useState } from "react";

export const ROUTES = [
  "board",
  "analyst",
  "workflow",
  "extensions",
  "agents",
  "rules",
  "memories",
  "glossary",
  "repos",
  "data",
] as const;

export type Route = typeof ROUTES[number];

const DEFAULT_ROUTE: Route = "board";

function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, "");
  return (ROUTES as readonly string[]).includes(clean) ? (clean as Route) : DEFAULT_ROUTE;
}

export function useHashRoute(): { route: Route; navigate: (r: Route) => void } {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((r: Route) => {
    if (window.location.hash.replace(/^#/, "") !== r) {
      window.location.hash = r;
    }
  }, []);

  return { route, navigate };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useHashRoute.ts
git commit -m "feat(web): add useHashRoute hook for hash-based routing"
```

---

## Task 2: `useGlobalShortcuts` hook

**Files:**
- Create: `web/src/hooks/useGlobalShortcuts.ts`

- [ ] **Step 1: Create the hook file**

```typescript
// web/src/hooks/useGlobalShortcuts.ts
import { useEffect } from "react";
import type { Route } from "./useHashRoute";

const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

export function useGlobalShortcuts(navigate: (r: Route) => void, onOpenRepoSwitcher: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      // Ignore if typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        // Allow Cmd+1/2/3 to work even inside inputs (consistent with macOS apps)
        if (!["1", "2", "3"].includes(e.key)) return;
      }

      if (e.key === "1") { e.preventDefault(); navigate("board"); return; }
      if (e.key === "2") { e.preventDefault(); navigate("analyst"); return; }
      if (e.key === "3") { e.preventDefault(); navigate("workflow"); return; }
      if (e.key === ",") { e.preventDefault(); navigate("repos"); return; }
      if (e.shiftKey && (e.key === "E" || e.key === "e")) {
        e.preventDefault();
        navigate("extensions");
        return;
      }
      if (e.key === "r" || e.key === "R") {
        // ⌘R would trigger reload; only intercept if Shift held to avoid breaking reload
        if (e.shiftKey) {
          e.preventDefault();
          onOpenRepoSwitcher();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, onOpenRepoSwitcher]);
}

export const SHORTCUT_LABELS = {
  modKey: isMac ? "⌘" : "Ctrl",
} as const;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useGlobalShortcuts.ts
git commit -m "feat(web): add useGlobalShortcuts hook for keyboard navigation"
```

---

## Task 3: `ViewShell` component

**Files:**
- Create: `web/src/views/ViewShell.tsx`

- [ ] **Step 1: Create the file**

```typescript
// web/src/views/ViewShell.tsx
import type { ReactNode } from "react";

export function ViewShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border-default bg-surface-100/80 px-6 py-4 backdrop-blur-md">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-text-primary">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-[11px] text-text-muted">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/ViewShell.tsx
git commit -m "feat(web): add ViewShell component for full-page view chrome"
```

---

## Task 4: Extract `sections/RulesPanel.tsx`

Move the full "Rules" tab content (Global + Repo rules lists + AI Optimize panel) into a standalone component. Currently spans roughly `SettingsModal.tsx:554-656` plus the helper `RuleRow` (lines 15-73) and `RulesSection` (lines 75-126).

**Files:**
- Create: `web/src/components/sections/RulesPanel.tsx`
- Modify: `web/src/components/SettingsModal.tsx` (import the new panel, remove inline code)

- [ ] **Step 1: Create `web/src/components/sections/RulesPanel.tsx`**

Copy the existing implementation verbatim: the `RuleRow` function (SettingsModal.tsx lines 16-73), the `RulesSection` function (lines 76-125), the Rules tab JSX from lines 555-655, and the optimize state + handlers `optimizing`, `optimizePreview`, `optimizeProfileId`, `optimizeInstruction`, `optimizeScope` + `handleOptimize` + `handleApplyOptimized` (lines 317-321, 371-387). Wrap in a single exported `RulesPanel` component with this props contract:

```typescript
import { useCallback, useState } from "react";
import type { AgentProfile, Repo, RepositoryRule } from "../../types";
import { IconX } from "../icons";
import { selectClass } from "../shared";

export function RulesPanel({
  selectedRepoId,
  selectedRepo,
  agentProfiles,
  globalRules,
  repoRules,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onOptimizeRules,
  onBulkReplaceRules,
  onRulesRefresh,
}: {
  selectedRepoId: string;
  selectedRepo: Repo | undefined;
  agentProfiles: AgentProfile[];
  globalRules: RepositoryRule[];
  repoRules: RepositoryRule[];
  onAddRule: (repoId: string | null, content: string) => Promise<void>;
  onUpdateRule: (id: string, content: string) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onOptimizeRules: (profileId: string, repoId?: string, instruction?: string, scope?: string) => Promise<string[]>;
  onBulkReplaceRules: (repoId: string | null, contents: string[]) => Promise<void>;
  onRulesRefresh: () => void;
}) {
  // … body = optimize state + handlers + the JSX that was inside `tab === "rules"` wrapped in the same `<div className="space-y-6">`
}

// RuleRow and RulesSection stay private to this file.
```

**Important:** The extracted handlers (`handleAddRule`, `handleUpdateRule`, `handleDeleteRule`, `handleOptimize`, `handleApplyOptimized`) should be recreated inside `RulesPanel` using the incoming `onAddRule`/etc. props. They're currently defined inline in SettingsModal at lines 353-387 — copy that logic, just substitute the required props as the non-optional dependencies.

- [ ] **Step 2: Update `SettingsModal.tsx` to use the new panel**

Replace everything inside the `{tab === "rules" && ( ... )}` block (lines 554-656) with:

```tsx
{tab === "rules" && (
  <RulesPanel
    selectedRepoId={selectedRepoId}
    selectedRepo={selectedRepo}
    agentProfiles={agentProfiles}
    globalRules={globalRules ?? []}
    repoRules={repoRules ?? []}
    onAddRule={onAddRule!}
    onUpdateRule={onUpdateRule!}
    onDeleteRule={onDeleteRule!}
    onOptimizeRules={onOptimizeRules!}
    onBulkReplaceRules={onBulkReplaceRules!}
    onRulesRefresh={onRulesRefresh!}
  />
)}
```

Delete the `RuleRow` function (lines 16-73), the `RulesSection` function (lines 76-125), the optimize-related `useState` calls (lines 317-321), and the `handleAddRule`/`handleUpdateRule`/`handleDeleteRule`/`handleOptimize`/`handleApplyOptimized` `useCallback`s (lines 353-387) from `SettingsModal.tsx`. Add `import { RulesPanel } from "./sections/RulesPanel";` at the top.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. Open `http://localhost:5173`, click Settings, click "Rules" tab. Verify: global rules render, add/edit/delete works, optimize button still works. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/sections/RulesPanel.tsx web/src/components/SettingsModal.tsx
git commit -m "refactor(web): extract RulesPanel from SettingsModal"
```

---

## Task 5: Extract `sections/RepositoryPanel.tsx`

Move the "Repository" tab content.

**Files:**
- Create: `web/src/components/sections/RepositoryPanel.tsx`
- Modify: `web/src/components/SettingsModal.tsx`

- [ ] **Step 1: Create `web/src/components/sections/RepositoryPanel.tsx`**

This extracts `SettingsModal.tsx` lines 462-513 (the `tab === "repo"` JSX) plus the supporting `BuildCommandSection` (lines 220-254) plus the `branches`/`handleDefaultBranchChange`/`handleBuildCommandSave` state and handlers (lines 315, 324-351).

```typescript
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Repo } from "../../types";
import { api } from "../../api";
import { FolderPicker } from "../FolderPicker";
import { TaskDefaultsSection } from "../TaskDefaultsSection";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../shared";

function BuildCommandSection({ repo, onSave }: { repo: Repo; onSave: (cmd: string | null) => void }) {
  // … copy lines 220-254 verbatim from SettingsModal.tsx
}

export function RepositoryPanel({
  repos,
  selectedRepoId,
  setSelectedRepoId,
  busy,
  onRepoSubmit,
  repoPath,
  setRepoPath,
  repoName,
  setRepoName,
  onReposChange,
}: {
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
  const [branches, setBranches] = useState<string[]>([]);
  const selectedRepo = repos.find((r) => r.id === selectedRepoId);

  useEffect(() => {
    if (!selectedRepoId) { setBranches([]); return; }
    api<{ branches: string[]; default: string }>(`/api/repos/${encodeURIComponent(selectedRepoId)}/branches`)
      .then((res) => setBranches(res.branches))
      .catch(() => setBranches([]));
  }, [selectedRepoId]);

  const handleDefaultBranchChange = useCallback(async (branch: string) => {
    if (!selectedRepoId || !branch) return;
    try {
      await api(`/api/repos/${encodeURIComponent(selectedRepoId)}`, {
        method: "PATCH",
        body: JSON.stringify({ defaultBranch: branch }),
      });
      onReposChange?.();
    } catch { /* silent */ }
  }, [selectedRepoId, onReposChange]);

  const handleBuildCommandSave = useCallback(async (cmd: string | null) => {
    if (!selectedRepoId) return;
    try {
      await api(`/api/repos/${encodeURIComponent(selectedRepoId)}`, {
        method: "PATCH",
        body: JSON.stringify({ buildCommand: cmd }),
      });
      onReposChange?.();
    } catch { /* silent */ }
  }, [selectedRepoId, onReposChange]);

  return (
    <div className="space-y-5">
      {/* Copy the JSX currently at SettingsModal.tsx lines 463-513 verbatim. */}
    </div>
  );
}
```

Note: the `useEffect` no longer needs to gate on `open` — the view is always mounted when visible.

- [ ] **Step 2: Update `SettingsModal.tsx`**

Replace the `{tab === "repo" && ...}` block (lines 462-513) with:

```tsx
{tab === "repo" && (
  <RepositoryPanel
    repos={repos}
    selectedRepoId={selectedRepoId}
    setSelectedRepoId={setSelectedRepoId}
    busy={busy}
    onRepoSubmit={onRepoSubmit}
    repoPath={repoPath}
    setRepoPath={setRepoPath}
    repoName={repoName}
    setRepoName={setRepoName}
    onReposChange={onReposChange}
  />
)}
```

Delete the now-unused `BuildCommandSection`, `branches`, `handleDefaultBranchChange`, `handleBuildCommandSave` from SettingsModal.tsx. Add `import { RepositoryPanel } from "./sections/RepositoryPanel";`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Smoke test**

`npm run dev`, open Settings → Repository, confirm repo switches, default branch dropdown populates, build command saves, Add Repository form works.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/sections/RepositoryPanel.tsx web/src/components/SettingsModal.tsx
git commit -m "refactor(web): extract RepositoryPanel from SettingsModal"
```

---

## Task 6: Extract `sections/AgentProfilesPanel.tsx`

**Files:**
- Create: `web/src/components/sections/AgentProfilesPanel.tsx`
- Modify: `web/src/components/SettingsModal.tsx`

- [ ] **Step 1: Create the panel**

Extracts SettingsModal.tsx lines 516-551.

```typescript
import type { AgentProfile } from "../../types";
import { IconRefresh } from "../icons";
import { selectClass, btnPrimary, btnSecondary } from "../shared";
import { AgentProfileMcpPanel } from "../../mcp/AgentProfileMcpPanel";

export function AgentProfilesPanel({
  agentProfiles,
  selectedProfileId,
  setSelectedProfileId,
  selectedProfile,
  busy,
  discoverAgents,
  saveAgentSelection,
}: {
  agentProfiles: AgentProfile[];
  selectedProfileId: string;
  setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* Copy JSX from SettingsModal.tsx lines 517-551 verbatim. */}
    </div>
  );
}
```

- [ ] **Step 2: Update `SettingsModal.tsx`**

Replace `{tab === "agent" && (...)}` with `<AgentProfilesPanel ...>` passing all the matching props. Add `import { AgentProfilesPanel } from "./sections/AgentProfilesPanel";`. Remove unused `IconRefresh` / `AgentProfileMcpPanel` imports if no longer needed in SettingsModal.

- [ ] **Step 3: Verify**

`npm run build` → exits 0. Smoke test: Settings → AI Agent, change profile, save, discover, MCP checkboxes load.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/sections/AgentProfilesPanel.tsx web/src/components/SettingsModal.tsx
git commit -m "refactor(web): extract AgentProfilesPanel from SettingsModal"
```

---

## Task 7: Extract `sections/MemoryPanel.tsx`

**Files:**
- Create: `web/src/components/sections/MemoryPanel.tsx`
- Modify: `web/src/components/SettingsModal.tsx`

- [ ] **Step 1: Create the panel**

Extracts SettingsModal.tsx lines 671-785 plus the `memoryImportOpen` state (line 321).

```typescript
import { useState } from "react";
import type { TaskMemory } from "../../hooks/useMemoryState";
import { IconX } from "../icons";
import { inputClass, btnSecondary } from "../shared";
import { ImportDialog } from "../ImportDialog";

export function MemoryPanel({
  selectedRepoId,
  memories,
  memoryTotal,
  memoryPage,
  memoryTotalPages,
  memoryLoading,
  memorySearchQuery,
  onMemorySearchChange,
  onLoadMemories,
  onDeleteMemory,
  onExportMemories,
  onImportMemories,
}: {
  selectedRepoId: string;
  memories: TaskMemory[];
  memoryTotal: number;
  memoryPage: number;
  memoryTotalPages: number;
  memoryLoading: boolean;
  memorySearchQuery: string;
  onMemorySearchChange: (q: string) => void;
  onLoadMemories: (repoId: string, query?: string, page?: number) => Promise<void>;
  onDeleteMemory: (id: string, repoId: string, query?: string, page?: number) => Promise<void>;
  onExportMemories?: (repoId: string) => void;
  onImportMemories?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  const [memoryImportOpen, setMemoryImportOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Copy JSX from SettingsModal.tsx lines 672-784 verbatim. */}
    </div>
  );
}
```

- [ ] **Step 2: Update `SettingsModal.tsx`**

Replace `{tab === "memory" && (...)}` with `<MemoryPanel ...>`. Delete the `memoryImportOpen` state. Add the import.

- [ ] **Step 3: Verify**

`npm run build` → exits 0. Smoke: Settings → Memories. Search, paginate, delete, import/export.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/sections/MemoryPanel.tsx web/src/components/SettingsModal.tsx
git commit -m "refactor(web): extract MemoryPanel from SettingsModal"
```

---

## Task 8: Extract `sections/DataPanel.tsx`

**Files:**
- Create: `web/src/components/sections/DataPanel.tsx`
- Modify: `web/src/components/SettingsModal.tsx`

- [ ] **Step 1: Create the panel**

Extracts the `UpdateSection` component (SettingsModal.tsx lines 180-218) and the `tab === "data"` JSX (lines 787-805).

```typescript
import { useCallback, useState } from "react";
import { api } from "../../api";
import { btnPrimary } from "../shared";

function UpdateSection() {
  // Copy lines 181-218 verbatim.
}

export function DataPanel({
  onClearOutputs,
}: {
  onClearOutputs?: () => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <UpdateSection />
      {/* Copy the second card (lines 790-803) verbatim. */}
    </div>
  );
}
```

- [ ] **Step 2: Update `SettingsModal.tsx`**

Replace `{tab === "data" && (...)}` block with `<DataPanel onClearOutputs={onClearOutputs} />`. Delete the `UpdateSection` function. Add the import.

- [ ] **Step 3: Verify**

`npm run build` → exits 0. Smoke: Settings → Data. Update button works, Clear Outputs button works.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/sections/DataPanel.tsx web/src/components/SettingsModal.tsx
git commit -m "refactor(web): extract DataPanel from SettingsModal"
```

---

## Task 9: Views that wrap extracted sections

Each view is a thin component that renders its section inside a `ViewShell`.

**Files:**
- Create: `web/src/views/RepositoriesView.tsx`
- Create: `web/src/views/AgentsView.tsx`
- Create: `web/src/views/RulesView.tsx`
- Create: `web/src/views/MemoriesView.tsx`
- Create: `web/src/views/GlossaryView.tsx`
- Create: `web/src/views/DataView.tsx`

- [ ] **Step 1: Create `web/src/views/RepositoriesView.tsx`**

```typescript
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
```

- [ ] **Step 2: Create `web/src/views/AgentsView.tsx`**

```typescript
import type { AgentProfile } from "../types";
import { AgentProfilesPanel } from "../components/sections/AgentProfilesPanel";
import { ViewShell } from "./ViewShell";

export function AgentsView(props: {
  agentProfiles: AgentProfile[];
  selectedProfileId: string;
  setSelectedProfileId: (v: string) => void;
  selectedProfile: AgentProfile | null;
  busy: boolean;
  discoverAgents: () => void;
  saveAgentSelection: () => void;
}) {
  return (
    <ViewShell title="AI Agents" subtitle="Agent profiles and MCP assignment">
      <AgentProfilesPanel {...props} />
    </ViewShell>
  );
}
```

- [ ] **Step 3: Create `web/src/views/RulesView.tsx`**

```typescript
import type { AgentProfile, Repo, RepositoryRule } from "../types";
import { RulesPanel } from "../components/sections/RulesPanel";
import { ViewShell } from "./ViewShell";

export function RulesView(props: {
  selectedRepoId: string;
  selectedRepo: Repo | undefined;
  agentProfiles: AgentProfile[];
  globalRules: RepositoryRule[];
  repoRules: RepositoryRule[];
  onAddRule: (repoId: string | null, content: string) => Promise<void>;
  onUpdateRule: (id: string, content: string) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onOptimizeRules: (profileId: string, repoId?: string, instruction?: string, scope?: string) => Promise<string[]>;
  onBulkReplaceRules: (repoId: string | null, contents: string[]) => Promise<void>;
  onRulesRefresh: () => void;
}) {
  return (
    <ViewShell title="Rules" subtitle="Global and per-repo rules, plus AI optimizer">
      <RulesPanel {...props} />
    </ViewShell>
  );
}
```

- [ ] **Step 4: Create `web/src/views/MemoriesView.tsx`**

```typescript
import type { TaskMemory } from "../hooks/useMemoryState";
import { MemoryPanel } from "../components/sections/MemoryPanel";
import { ViewShell } from "./ViewShell";

export function MemoriesView(props: {
  selectedRepoId: string;
  memories: TaskMemory[];
  memoryTotal: number;
  memoryPage: number;
  memoryTotalPages: number;
  memoryLoading: boolean;
  memorySearchQuery: string;
  onMemorySearchChange: (q: string) => void;
  onLoadMemories: (repoId: string, query?: string, page?: number) => Promise<void>;
  onDeleteMemory: (id: string, repoId: string, query?: string, page?: number) => Promise<void>;
  onExportMemories?: (repoId: string) => void;
  onImportMemories?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  return (
    <ViewShell title="Memories" subtitle="Agent-generated summaries from past tasks">
      <MemoryPanel {...props} />
    </ViewShell>
  );
}
```

- [ ] **Step 5: Create `web/src/views/GlossaryView.tsx`**

```typescript
import type { GlossaryTerm } from "../hooks/useGlossaryState";
import { GlossaryPanel } from "../components/GlossaryPanel";
import { ViewShell } from "./ViewShell";

export function GlossaryView(props: {
  glossaryTerms: GlossaryTerm[];
  glossaryLoading: boolean;
  selectedRepoId: string;
  onAddGlossaryTerm?: (repoId: string, term: string, description: string) => Promise<void>;
  onUpdateGlossaryTerm?: (id: string, term: string, description: string, repoId: string) => Promise<void>;
  onDeleteGlossaryTerm?: (id: string, repoId: string) => Promise<void>;
  onExportGlossary?: (repoId: string) => void;
  onImportGlossary?: (repoId: string, file: File, strategy: "skip" | "update") => Promise<{ created: number; updated: number; skipped: number }>;
}) {
  return (
    <ViewShell title="Glossary" subtitle="Domain terms for this repository">
      <GlossaryPanel
        terms={props.glossaryTerms}
        loading={props.glossaryLoading}
        selectedRepoId={props.selectedRepoId}
        onAdd={props.onAddGlossaryTerm ?? (async () => {})}
        onUpdate={props.onUpdateGlossaryTerm ?? (async () => {})}
        onDelete={props.onDeleteGlossaryTerm ?? (async () => {})}
        onExport={props.onExportGlossary}
        onImport={props.onImportGlossary}
      />
    </ViewShell>
  );
}
```

- [ ] **Step 6: Create `web/src/views/DataView.tsx`**

```typescript
import { DataPanel } from "../components/sections/DataPanel";
import { ViewShell } from "./ViewShell";

export function DataView({ onClearOutputs }: { onClearOutputs?: () => Promise<void> }) {
  return (
    <ViewShell title="Data" subtitle="Application update and output log maintenance">
      <DataPanel onClearOutputs={onClearOutputs} />
    </ViewShell>
  );
}
```

- [ ] **Step 7: Verify**

Run: `npm run build`
Expected: exits 0. No runtime check yet — views aren't mounted anywhere.

- [ ] **Step 8: Commit**

```bash
git add web/src/views/
git commit -m "feat(web): add per-route views wrapping extracted sections"
```

---

## Task 10: `ExtensionsView`

Converts `ExtensionsDrawer` into a full-page view. Keeps the same internal structure (MCP block + provider list) but drops the fixed-position drawer chrome.

**Files:**
- Create: `web/src/views/ExtensionsView.tsx`

- [ ] **Step 1: Create the view**

```typescript
import { useState } from "react";
import type { ProviderMeta } from "../types";
import { getAllProviderUIs } from "../providers/registry";
import { IconSettings } from "../components/icons";
import { ProviderSettingsModal } from "../components/ProviderSettingsModal";
import { McpTab } from "../mcp/McpTab";
import { ViewShell } from "./ViewShell";

export function ExtensionsView({
  selectedRepoId,
  providerMetas,
  providerItemCounts,
  busy,
  error,
  info,
  onBusyChange,
  onTasksRefresh,
  onError,
  onInfo,
  onBootstrapRefresh,
}: {
  selectedRepoId: string;
  providerMetas: ProviderMeta[];
  providerItemCounts: Record<string, number>;
  busy: boolean;
  error: string;
  info: string;
  onBusyChange: (v: boolean) => void;
  onTasksRefresh: () => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  onBootstrapRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [settingsProviderId, setSettingsProviderId] = useState<string | null>(null);
  const providers = getAllProviderUIs();

  return (
    <>
      <ViewShell title="Extensions" subtitle={`${providers.length} provider${providers.length === 1 ? "" : "s"}`}>
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 p-3">
            <McpTab />
          </div>

          {(error || info) && (
            <div className="space-y-2">
              {error && (
                <div className="rounded-[var(--radius-md)] border border-error-border bg-error-bg px-3 py-2 text-sm text-error-text">{error}</div>
              )}
              {info && (
                <div className="rounded-[var(--radius-md)] border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">{info}</div>
              )}
            </div>
          )}

          {providers.map(([id, ui]) => {
            const meta = providerMetas.find((m) => m.id === id);
            const displayName = meta?.displayName ?? id;
            const count = providerItemCounts[id] ?? 0;
            const isExpanded = expanded[id] ?? false;
            const Section = ui.drawerSection;

            return (
              <div
                key={id}
                className="overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-0/40 transition hover:border-border-strong"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded((prev) => ({ ...prev, [id]: !isExpanded }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpanded((prev) => ({ ...prev, [id]: !isExpanded }));
                    }
                  }}
                  className="group flex cursor-pointer items-center gap-2 px-3 py-2.5 transition hover:bg-surface-200"
                >
                  <svg
                    className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    viewBox="0 0 12 12"
                    fill="none"
                  >
                    <path d="M4.5 3L8 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="flex-1 truncate text-[13px] font-medium text-text-primary">{displayName}</span>
                  {count > 0 && (
                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-status-danger px-1.5 text-[10px] font-semibold text-white ring-2 ring-surface-100">
                      {count}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setSettingsProviderId(id); }}
                    title={`${displayName} settings`}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted opacity-0 transition hover:bg-surface-300 hover:text-text-primary group-hover:opacity-100"
                  >
                    <IconSettings className="h-3 w-3" />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-border-default/60 bg-surface-100/50 px-3 py-3">
                    <Section
                      selectedRepoId={selectedRepoId}
                      busy={busy}
                      onBusyChange={onBusyChange}
                      onTasksRefresh={onTasksRefresh}
                      onError={onError}
                      onInfo={onInfo}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {providers.length === 0 && (
            <div className="flex items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border-default/60 px-4 py-10 text-center text-[12px] text-text-muted">
              No extensions registered.
            </div>
          )}
        </div>
      </ViewShell>

      {settingsProviderId && (
        <ProviderSettingsModal
          providerId={settingsProviderId}
          providerMetas={providerMetas}
          selectedRepoId={selectedRepoId}
          busy={busy}
          error={error}
          info={info}
          onBusyChange={onBusyChange}
          onError={onError}
          onInfo={onInfo}
          onBootstrapRefresh={onBootstrapRefresh}
          onClose={() => setSettingsProviderId(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/ExtensionsView.tsx
git commit -m "feat(web): add ExtensionsView as full-page provider catalog"
```

---

## Task 11: `RepoSwitcher` popover

A compact control placed at the top of the sidebar rail. Shows the current repo name + default branch. Click opens a popover listing all repos with an "Add Repository" shortcut at the bottom.

**Files:**
- Create: `web/src/components/RepoSwitcher.tsx`

- [ ] **Step 1: Create the component**

```typescript
import { useEffect, useRef, useState } from "react";
import type { Repo } from "../types";

export function RepoSwitcher({
  repos,
  selectedRepoId,
  setSelectedRepoId,
  onAddRepository,
  open,
  onOpenChange,
}: {
  repos: Repo[];
  selectedRepoId: string;
  setSelectedRepoId: (id: string) => void;
  onAddRepository: () => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const selectedRepo = repos.find((r) => r.id === selectedRepoId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        className="group flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-border-default bg-surface-200 px-3 py-2 text-left transition hover:bg-surface-300"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-text-primary">
            {selectedRepo?.name ?? "No repository"}
          </p>
          {selectedRepo && (
            <p className="truncate text-[10px] text-text-muted">{selectedRepo.default_branch}</p>
          )}
        </div>
        <svg className="h-3 w-3 shrink-0 text-text-muted" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-hidden rounded-[var(--radius-lg)] border border-border-default bg-surface-100 shadow-[var(--shadow-lg)]">
          <div className="max-h-[260px] overflow-y-auto py-1">
            {repos.map((r) => {
              const active = r.id === selectedRepoId;
              return (
                <button
                  key={r.id}
                  onClick={() => { setSelectedRepoId(r.id); onOpenChange(false); }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition ${
                    active ? "bg-brand-tint text-text-primary" : "text-text-secondary hover:bg-surface-200 hover:text-text-primary"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{r.name}</p>
                    <p className="truncate text-[10px] text-text-muted">{r.default_branch}</p>
                  </div>
                  {active && (
                    <svg className="h-3 w-3 shrink-0 text-brand" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
            {repos.length === 0 && (
              <p className="px-3 py-3 text-[11px] text-text-muted italic">No repositories yet.</p>
            )}
          </div>
          <div className="border-t border-border-default">
            <button
              onClick={() => { onAddRepository(); onOpenChange(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-text-secondary transition hover:bg-surface-200 hover:text-text-primary"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add Repository…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/RepoSwitcher.tsx
git commit -m "feat(web): add RepoSwitcher popover for sidebar rail"
```

---

## Task 12: `SideRail` component

The rail itself. Fixed 260px column with logo header, repo switcher, two nav groups (WORKSPACE, CONFIGURE), and a Clear Queue footer action.

**Files:**
- Create: `web/src/components/SideRail.tsx`

- [ ] **Step 1: Create the file**

```typescript
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
      {/* Brand header */}
      <div className="flex items-center gap-2.5 border-b border-border-default px-4 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-glow bg-brand-dark">
          <span className="text-sm font-bold text-brand">B</span>
        </div>
        <h1 className="text-sm font-semibold text-text-primary">Branching Bad</h1>
      </div>

      {/* Repo switcher */}
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

      {/* Nav */}
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-3">
        <NavGroup title="Workspace" items={workspaceItems} route={route} navigate={navigate} />
        <NavGroup title="Configure" items={configureItems} route={route} navigate={navigate} />
      </nav>

      {/* Footer */}
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

/* ── Rail-specific small icons (stroke-based, match existing icon style) ── */

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
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SideRail.tsx
git commit -m "feat(web): add SideRail primary navigation component"
```

---

## Task 13: Rewire `App.tsx`

This is the big switch. Remove top nav, mount `SideRail`, route-switch in the main content slot, and stop rendering `SettingsModal` / `ExtensionsDrawer`.

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Update imports in `App.tsx`**

Remove:
```typescript
import { IconSettings, IconExtensions, IconAnalyst, IconBoard, IconWorkflow } from "./components/icons";
import { SettingsModal } from "./components/SettingsModal";
import { ExtensionsDrawer } from "./components/ExtensionsDrawer";
```

Add:
```typescript
import { SideRail } from "./components/SideRail";
import { useHashRoute } from "./hooks/useHashRoute";
import { useGlobalShortcuts, SHORTCUT_LABELS } from "./hooks/useGlobalShortcuts";
import { RepositoriesView } from "./views/RepositoriesView";
import { AgentsView } from "./views/AgentsView";
import { RulesView } from "./views/RulesView";
import { MemoriesView } from "./views/MemoriesView";
import { GlossaryView } from "./views/GlossaryView";
import { DataView } from "./views/DataView";
import { ExtensionsView } from "./views/ExtensionsView";
```

Keep the `JiraSprintQuickSwitch` import and everything else unchanged.

- [ ] **Step 2: Remove obsolete UI state**

In `App.tsx`, delete these `useState` lines:
```typescript
const [settingsOpen, setSettingsOpen] = useState(false);
const [extensionsOpen, setExtensionsOpen] = useState(false);
const [topTab, setTopTab] = useState<'board' | 'analyst' | 'workflow'>('board');
```

Add in their place:
```typescript
const { route, navigate } = useHashRoute();
const [repoSwitcherOpen, setRepoSwitcherOpen] = useState(false);
useGlobalShortcuts(navigate, () => setRepoSwitcherOpen(true));
```

- [ ] **Step 3: Replace the return JSX**

Replace the entire return block (currently starts at line 230 `return ( <div className="min-h-screen…` and ends at the closing `</div>` before `export default`) with:

```tsx
return (
  <div className="flex h-screen overflow-hidden bg-surface-0 text-text-primary">
    <SideRail
      route={route}
      navigate={navigate}
      repos={boot.repos}
      selectedRepoId={repo.selectedRepoId}
      setSelectedRepoId={repo.setSelectedRepoId}
      providerItemCount={totalProviderItemCount}
      repoSwitcherOpen={repoSwitcherOpen}
      setRepoSwitcherOpen={setRepoSwitcherOpen}
      onClearQueue={() => void task.clearAllPipelines()}
      clearQueueDisabled={busy}
      modLabel={SHORTCUT_LABELS.modKey}
    />

    <main className={`flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ${detailsOpen ? "lg:pr-[540px]" : ""}`}>
      {/* Alerts */}
      {(error || info) && (
        <div className="px-6 pt-4">
          {error && (
            <div className="rounded-[var(--radius-md)] border border-error-border bg-error-bg px-4 py-3 text-sm text-error-text">{error}</div>
          )}
          {info && (
            <div className="mt-2 rounded-[var(--radius-md)] border border-info-border bg-info-bg px-4 py-3 text-sm text-info-text">{info}</div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {route === "board" && (
          <section className="px-6 py-6">
            <KanbanBoard
              groupedTasks={task.groupedTasks}
              selectedTaskId={task.selectedTaskId}
              onSelectTask={(taskId) => { task.setSelectedTaskId(taskId); setDetailsOpen(true); setDetailsTab("plan"); }}
              onCreateTask={() => setCreateTaskModalOpen(true)}
              selectedRepoId={repo.selectedRepoId}
              statusFromLane={task.statusFromLane}
              setTasks={task.setTasks}
              onError={setError}
              onConflict={(taskId, files) => {
                task.setSelectedTaskId(taskId);
                setDetailsOpen(true);
                setDetailsTab("review");
                review.setApplyConflicts(files);
                setError("Changes conflict with main. Resolve in the review panel.");
              }}
              agentProfiles={boot.agentProfiles}
              taskRunStates={run.taskRunStates}
              queueMode={repo.selectedRepo?.queue_mode}
              onToggleQueueMode={async () => {
                if (!repo.selectedRepo) return;
                const newMode = !repo.selectedRepo.queue_mode;
                try {
                  await api(`/api/repos/${encodeURIComponent(repo.selectedRepo.id)}`, {
                    method: "PATCH",
                    body: JSON.stringify({ queueMode: newMode }),
                  });
                  void boot.bootstrap();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
              toolbarContent={
                <JiraSprintQuickSwitch
                  selectedRepoId={repo.selectedRepoId}
                  busy={busy}
                  onBusyChange={setBusy}
                  onError={setError}
                  onInfo={setInfo}
                  onTasksRefresh={task.refreshTasks}
                  refreshHint={`${info}|${error}|${route}`}
                />
              }
            />
          </section>
        )}

        {route === "analyst" && (
          <section className="flex h-full bg-surface-0 p-3">
            {repo.selectedRepoId ? (
              <TaskAnalystPanel
                repoId={repo.selectedRepoId}
                repos={boot.repos}
                agentProfiles={boot.agentProfiles}
                onCreateTask={(prefill) => { setTaskPrefill(prefill); setCreateTaskModalOpen(true); }}
                analystState={analyst}
                autoFocus={true}
                layout="island"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">
                Select a repository to use the Task Analyst.
              </div>
            )}
          </section>
        )}

        {route === "workflow" && (
          <section className="h-full">
            <WorkflowTab
              repoId={repo.selectedRepoId}
              agentProfiles={boot.agentProfiles.map((p) => ({ id: p.id, name: p.agent_name }))}
            />
          </section>
        )}

        {route === "extensions" && (
          <ExtensionsView
            selectedRepoId={repo.selectedRepoId}
            providerMetas={boot.providerMetas}
            providerItemCounts={boot.providerItemCounts}
            busy={busy}
            error={error}
            info={info}
            onBusyChange={setBusy}
            onTasksRefresh={task.refreshTasks}
            onError={setError}
            onInfo={setInfo}
            onBootstrapRefresh={boot.bootstrap}
          />
        )}

        {route === "agents" && (
          <AgentsView
            agentProfiles={boot.agentProfiles}
            selectedProfileId={repo.selectedProfileId}
            setSelectedProfileId={repo.setSelectedProfileId}
            selectedProfile={repo.selectedProfile}
            busy={busy}
            discoverAgents={repo.discoverAgents}
            saveAgentSelection={repo.saveAgentSelection}
          />
        )}

        {route === "rules" && (
          <RulesView
            selectedRepoId={repo.selectedRepoId}
            selectedRepo={repo.selectedRepo}
            agentProfiles={boot.agentProfiles}
            globalRules={rulesState.globalRules}
            repoRules={rulesState.repoRules}
            onAddRule={rulesState.addRule}
            onUpdateRule={rulesState.updateRule}
            onDeleteRule={rulesState.deleteRule}
            onOptimizeRules={rulesState.optimizeRules}
            onBulkReplaceRules={rulesState.bulkReplaceRules}
            onRulesRefresh={() => void rulesState.loadRules(repo.selectedRepoId || undefined)}
          />
        )}

        {route === "memories" && (
          <MemoriesView
            selectedRepoId={repo.selectedRepoId}
            memories={memoryState.memories}
            memoryTotal={memoryState.total}
            memoryPage={memoryState.page}
            memoryTotalPages={memoryState.totalPages}
            memoryLoading={memoryState.loading}
            memorySearchQuery={memoryState.searchQuery}
            onMemorySearchChange={memoryState.setSearchQuery}
            onLoadMemories={memoryState.loadMemories}
            onDeleteMemory={memoryState.deleteMemory}
            onExportMemories={memoryState.exportMemories}
            onImportMemories={memoryState.importMemories}
          />
        )}

        {route === "glossary" && (
          <GlossaryView
            glossaryTerms={glossaryState.terms}
            glossaryLoading={glossaryState.loading}
            selectedRepoId={repo.selectedRepoId}
            onAddGlossaryTerm={glossaryState.addTerm}
            onUpdateGlossaryTerm={glossaryState.updateTerm}
            onDeleteGlossaryTerm={glossaryState.deleteTerm}
            onExportGlossary={glossaryState.exportTerms}
            onImportGlossary={glossaryState.importTerms}
          />
        )}

        {route === "repos" && (
          <RepositoriesView
            repos={boot.repos}
            selectedRepoId={repo.selectedRepoId}
            setSelectedRepoId={repo.setSelectedRepoId}
            busy={busy}
            onRepoSubmit={repo.onRepoSubmit}
            repoPath={repo.repoPath}
            setRepoPath={repo.setRepoPath}
            repoName={repo.repoName}
            setRepoName={repo.setRepoName}
            onReposChange={boot.bootstrap}
          />
        )}

        {route === "data" && (
          <DataView
            onClearOutputs={async () => {
              await api("/api/outputs", { method: "DELETE" });
              setInfo("All output logs cleared.");
            }}
          />
        )}
      </div>
    </main>

    {/* Existing panels (unchanged) */}
    {detailsOpen && task.selectedTask && (
      <DetailsSidebar
        /* … existing props unchanged … */
      />
    )}

    {task.selectedTask && reviewModalOpen && (
      <DiffReviewModal /* … unchanged … */ />
    )}

    {task.selectedTask && planModalOpen && (
      <PlanExpandModal /* … unchanged … */ />
    )}

    {repo.selectedRepoId && (
      <TaskAnalystModal
        open={analystOpen}
        onClose={() => setAnalystOpen(false)}
        repoId={repo.selectedRepoId}
        repos={boot.repos}
        agentProfiles={boot.agentProfiles}
        onCreateTask={(prefill) => { setTaskPrefill(prefill); setCreateTaskModalOpen(true); }}
        analystState={analyst}
      />
    )}

    <CreateTaskModal
      open={createTaskModalOpen} onClose={() => { setCreateTaskModalOpen(false); setTaskPrefill(null); }} busy={busy}
      agentProfiles={boot.agentProfiles}
      onSubmit={task.createManualTask} repoName={repo.selectedRepo?.name ?? "selected repo"}
      prefill={taskPrefill}
      repoId={repo.selectedRepoId || undefined}
    />

    <EditTaskModal
      open={editTaskModalOpen} onClose={() => setEditTaskModalOpen(false)} busy={busy}
      task={task.selectedTask}
      agentProfiles={boot.agentProfiles}
      onSave={task.saveTaskEdits}
    />

    <StatusBar
      runs={visibleRuns}
      exitingRunIds={exitingRunIds}
      onCancel={cancelRun}
      onResume={resumeRun}
      onNavigate={handleRunNavigate}
    />
    <ThanosSnapFilter />
    <ToastNotification
      toasts={toasts}
      onDismiss={dismissToast}
      onNavigate={handleRunNavigate}
    />
  </div>
);
```

**Important:** where the old JSX said `/* … existing props unchanged … */` for `DetailsSidebar`, `DiffReviewModal`, and `PlanExpandModal`, keep their original prop lists exactly as they were in the previous `App.tsx`. Do not modify those components or their props in this task.

Also: the old JSX contained a `SettingsModal` and `ExtensionsDrawer` render. **Delete both of those blocks entirely** — they are replaced by the route-based rendering above.

- [ ] **Step 4: Update `handleRunNavigate` callback**

The `handleRunNavigate` currently (around line 152 in the original file) does:

```typescript
const handleRunNavigate = useCallback((taskId: string, repoId: string) => {
  if (repoId !== selectedRepoId) setSelectedRepoId(repoId);
  setSelectedTaskId(taskId);
  removeRun(taskId);
  setDetailsOpen(true);
  setDetailsTab("run");
}, [selectedRepoId, setSelectedRepoId, setSelectedTaskId, removeRun]);
```

Change the first navigation side-effect to also switch to the board view, so a user clicking a toast from Memories sees the board with the details panel open:

```typescript
const handleRunNavigate = useCallback((taskId: string, repoId: string) => {
  if (repoId !== selectedRepoId) setSelectedRepoId(repoId);
  setSelectedTaskId(taskId);
  removeRun(taskId);
  setDetailsOpen(true);
  setDetailsTab("run");
  navigate("board");
}, [selectedRepoId, setSelectedRepoId, setSelectedTaskId, removeRun, navigate]);
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run build`
Expected: exits 0. Resolve any reported type errors by re-checking prop names against the view signatures in Tasks 9-10.

- [ ] **Step 6: Smoke test**

Run `npm run dev`. Walk the app:
1. Load `http://localhost:5173` → defaults to Board.
2. Click each nav item (Board, Task Analyst, Workflow, Extensions, AI Agents, Rules, Memories, Glossary, Repositories, Data). Each renders its view. URL hash updates (`#agents`, etc.).
3. Press ⌘1, ⌘2, ⌘3 — workspace switches.
4. Press ⌘, (comma) — lands on Repositories.
5. Click the repo switcher at the top of the rail. Select a different repo → content refreshes. Click "Add Repository…" → routes to Repositories.
6. Click a task on the Board → DetailsSidebar opens on the right. Content area narrows (`lg:pr-[540px]` still works).
7. Click Clear Queue in the rail footer — pipelines clear (if busy is false).
8. Browser Back → previous route shown. Forward → restores.
9. Load with unknown hash `http://localhost:5173/#nonexistent` → redirects to Board.

If any step breaks: inspect console, fix, re-run.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): replace top nav with SideRail + hash routing"
```

---

## Task 14: Delete obsolete files

`SettingsModal` and `ExtensionsDrawer` are no longer imported anywhere. Confirm, then delete.

**Files:**
- Delete: `web/src/components/SettingsModal.tsx`
- Delete: `web/src/components/ExtensionsDrawer.tsx`

- [ ] **Step 1: Confirm no imports remain**

Run: `grep -rn "SettingsModal\|ExtensionsDrawer" web/src`
Expected: no matches outside of the files themselves.

If matches appear, fix them before proceeding.

- [ ] **Step 2: Delete the files**

```bash
rm web/src/components/SettingsModal.tsx
rm web/src/components/ExtensionsDrawer.tsx
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A web/src/components/
git commit -m "chore(web): delete obsolete SettingsModal and ExtensionsDrawer"
```

---

## Task 15: Responsive mobile drawer

On viewports below 1024px, the 260px rail would crush the content. Collapse it into an overlay drawer triggered by a hamburger button in the top-left of the content area.

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/SideRail.tsx`

- [ ] **Step 1: Add mobile-drawer state in `App.tsx`**

Near the other UI state declarations:
```typescript
const [mobileNavOpen, setMobileNavOpen] = useState(false);
```

Close it whenever the route changes:
```typescript
useEffect(() => { setMobileNavOpen(false); }, [route]);
```

- [ ] **Step 2: Update `App.tsx` layout root for responsive**

Change the layout root and rail wrapper from:

```tsx
<div className="flex h-screen overflow-hidden bg-surface-0 text-text-primary">
  <SideRail … />
  <main …>
```

to:

```tsx
<div className="flex h-screen overflow-hidden bg-surface-0 text-text-primary">
  {/* Mobile backdrop */}
  {mobileNavOpen && (
    <div
      className="fixed inset-0 z-40 bg-black/50 lg:hidden"
      onClick={() => setMobileNavOpen(false)}
    />
  )}

  {/* Rail — permanent on lg+, drawer below */}
  <div className={`fixed inset-y-0 left-0 z-50 transition-transform lg:static lg:translate-x-0 ${
    mobileNavOpen ? "translate-x-0" : "-translate-x-full"
  }`}>
    <SideRail … />
  </div>

  <main className="flex min-w-0 flex-1 flex-col">
    {/* Mobile hamburger */}
    <button
      onClick={() => setMobileNavOpen(true)}
      className="absolute left-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-md bg-surface-200 text-text-secondary lg:hidden"
      aria-label="Open navigation"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
      </svg>
    </button>

    {/* … rest of main content unchanged … */}
  </main>
```

The `detailsOpen ? "lg:pr-[540px]" : ""` class moves off the `<main>` wrapper and onto the inner content `<div className="min-h-0 flex-1">` — or keep it on `<main>`, doesn't matter, just be consistent.

- [ ] **Step 3: Verify**

Run: `npm run build` → exits 0. `npm run dev`:
- Full-width desktop: rail visible, no hamburger.
- Resize browser below 1024px: rail hides, hamburger appears top-left. Click hamburger → rail slides in as drawer, backdrop darkens background. Click backdrop or nav item → closes.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): responsive mobile drawer for SideRail below 1024px"
```

---

## Task 16: Final verification and cleanup

- [ ] **Step 1: Typecheck + build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 2: Server typecheck**

Run: `npm run check:server`
Expected: exits 0 (should be unaffected by this change; just confirming).

- [ ] **Step 3: Lint the web directory**

Run: `cd web && npx eslint . && cd ..`
Expected: no errors. Warnings OK but review them — especially any "unused variable" in the modified `App.tsx`.

- [ ] **Step 4: Full manual regression**

`npm run dev`. Walk every surface and confirm:

| Action                                          | Expected                                       |
|-------------------------------------------------|------------------------------------------------|
| Load app                                        | Rail visible on left. Board shown by default.  |
| Click each nav item                             | Each view loads. URL hash updates.             |
| ⌘1 / ⌘2 / ⌘3                                    | Switches Board / Analyst / Workflow.           |
| ⌘,                                              | Routes to Repositories.                        |
| Repo switcher → select repo                     | Content refreshes (e.g., board columns reload).|
| Repo switcher → Add Repository                  | Routes to Repositories view.                   |
| Rules view: add, edit, delete, optimize         | Works like before.                             |
| Memories view: search, paginate, delete         | Works like before.                             |
| Glossary view: add, edit, delete, export        | Works like before.                             |
| Extensions view: expand provider, open settings | Works. ProviderSettingsModal opens on top.     |
| Data view: update button, clear outputs         | Works like before.                             |
| Create a task, watch it run                     | StatusBar shows run. Toast on completion.      |
| Toast click                                     | Navigates to Board, opens details (task.run).  |
| Browser Back after nav clicks                   | Goes back through route history.               |
| Below-1024px viewport                           | Hamburger opens drawer. Drawer closes on nav.  |

- [ ] **Step 5: Commit any final fixes**

If any bugs were found and fixed during verification:
```bash
git add -A
git commit -m "fix(web): regression fixes from side-rail migration"
```

If no fixes needed, skip this step.

---

## Files Created / Modified / Deleted (Summary)

**Created (16):**
- `web/src/hooks/useHashRoute.ts`
- `web/src/hooks/useGlobalShortcuts.ts`
- `web/src/views/ViewShell.tsx`
- `web/src/views/RepositoriesView.tsx`
- `web/src/views/AgentsView.tsx`
- `web/src/views/RulesView.tsx`
- `web/src/views/MemoriesView.tsx`
- `web/src/views/GlossaryView.tsx`
- `web/src/views/DataView.tsx`
- `web/src/views/ExtensionsView.tsx`
- `web/src/components/sections/RulesPanel.tsx`
- `web/src/components/sections/RepositoryPanel.tsx`
- `web/src/components/sections/AgentProfilesPanel.tsx`
- `web/src/components/sections/MemoryPanel.tsx`
- `web/src/components/sections/DataPanel.tsx`
- `web/src/components/RepoSwitcher.tsx`
- `web/src/components/SideRail.tsx`

**Modified (1):**
- `web/src/App.tsx`

**Deleted (2):**
- `web/src/components/SettingsModal.tsx`
- `web/src/components/ExtensionsDrawer.tsx`

---

## Self-Review Checklist (completed by plan author)

- **Spec coverage:** Layout, rail structure, routing, component migration, view chrome, keyboard shortcuts, state/data flow, and cross-platform all map to tasks 1-16. Responsive covered in Task 15. Settings/Extensions deletion covered in Task 14.
- **Placeholder scan:** No TBDs. Every code block is complete. For extraction tasks, "Copy JSX from SettingsModal.tsx lines X-Y verbatim" is an explicit instruction — the code exists in the current file at those lines.
- **Type consistency:** Route names (`board`, `analyst`, `workflow`, `extensions`, `agents`, `rules`, `memories`, `glossary`, `repos`, `data`) are used identically in `useHashRoute`, `SideRail`, and the App route switch. Section prop names match view prop names which match App usage.
