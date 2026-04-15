# Side Navigation Rail — Design Spec

**Date:** 2026-04-15
**Status:** Draft, pending user review
**Author:** Claude (senior frontend architect role, brainstormed with user)

## Motivation

The current top navigation is cramped and hides important surfaces. Settings (6 sub-tabs) and Extensions (drawer) are one-click-away buttons next to the logo, which makes every secondary surface feel buried. A sticky top bar also wastes vertical space on a Kanban-heavy workflow.

Replace the top nav with a permanent left rail (Xcode/Mail pattern). Every Settings sub-tab and Extensions drawer is promoted to a first-class nav item.

## Layout

Three-column desktop layout:

```
┌────────┬──────────────────────────────────┬─────────────┐
│        │                                  │             │
│  RAIL  │           CONTENT                │   DETAIL    │
│  260px │       (grows to fill)            │   540px     │
│        │                                  │   (when     │
│        │                                  │    task     │
│        │                                  │   selected) │
│        │                                  │             │
└────────┴──────────────────────────────────┴─────────────┘
```

- Rail: fixed 260px, `h-screen`, `border-r`, never collapses on desktop.
- Content: `flex-1`, fills remaining width. No more `max-w-7xl` centering — the rail provides the left margin visually.
- Detail sidebar: unchanged. Slides in from right at 540px when a task is selected.
- Top nav (`<nav>` in `App.tsx`) is **removed entirely**.

### Responsive

- Primary target: ≥1024px desktop. Below that, rail collapses to a hamburger drawer (same rail content, overlaid). We don't optimize further; this is a desktop tool.

## Rail Structure

From top to bottom, with two visual sections separated by a divider:

```
┌───────────────────────────────────────────┐
│  🅑  Branching Bad                        │  ← header (logo + name)
├───────────────────────────────────────────┤
│  ▼  my-repo                         [⇅]  │  ← repo switcher
│     feat/branch-name                      │
├───────────────────────────────────────────┤
│  WORKSPACE                                │
│  ▦  Board                         ⌘1     │
│  ✦  Task Analyst                  ⌘2     │
│  ⇢  Workflow                      ⌘3     │
│                                           │
│  CONFIGURE                                │
│  ⚡ Extensions                     [3]   │
│  🤖 AI Agents                            │
│  ◆  Rules                                │
│  ❐  Memories                             │
│  Aa Glossary                              │
│  📁 Repositories                         │
│  💾 Data                                 │
├───────────────────────────────────────────┤
│  ⌫  Clear Queue                          │  ← footer action
└───────────────────────────────────────────┘
```

**Ordering rationale** (per user's "sık kullanım" directive): within each group, top = most frequent.

### Repo switcher block

- Click opens a popover listing all repos with their active branch.
- Popover footer: "Add Repository" button (opens the Repositories view, pre-scrolled to the add-form).
- Keyboard: `⌘R` opens the popover, arrow keys to select, `Enter` to switch.

### Badges

- Extensions: existing `totalProviderItemCount` badge, positioned right-aligned next to the label.
- Future-proof: any nav item can show a badge (numeric count or dot).

### Active state

- Active item: `bg-brand-tint`, `inset shadow-[0_0_0_1px_var(--color-brand-glow)]`, icon tinted `text-brand`.
- Hover: `bg-surface-200`, `text-text-primary`.
- Same treatment currently used inside SettingsModal's left nav — lifted to the app-level rail.

## Routing

Hash-based route, no new dependency (no React Router).

**Route → View mapping:**

| Hash           | View component              | Replaces                          |
|----------------|-----------------------------|-----------------------------------|
| `#board`       | existing KanbanBoard        | `topTab === 'board'`              |
| `#analyst`     | existing TaskAnalystPanel   | `topTab === 'analyst'`            |
| `#workflow`    | existing WorkflowTab        | `topTab === 'workflow'`           |
| `#extensions`  | new `ExtensionsView`        | `<ExtensionsDrawer>`              |
| `#agents`      | new `AgentsView`            | SettingsModal tab `"agent"`       |
| `#rules`       | new `RulesView`             | SettingsModal tab `"rules"`       |
| `#memories`    | new `MemoriesView`          | SettingsModal tab `"memory"`      |
| `#glossary`    | new `GlossaryView`          | SettingsModal tab `"glossary"`    |
| `#repos`       | new `RepositoriesView`      | SettingsModal tab `"repo"`        |
| `#data`        | new `DataView`              | SettingsModal tab `"data"`        |

Default route: `#board`. Unknown hash → redirect to `#board`.

**Implementation:** a new `useHashRoute()` hook (`web/src/hooks/useHashRoute.ts`) returning `{ route, navigate }`. `App.tsx` switches on route, replaces the existing `topTab` state.

## Component Migration

### Delete
- `web/src/components/SettingsModal.tsx` — every tab becomes its own view.
- `web/src/components/ExtensionsDrawer.tsx` — becomes `ExtensionsView`.
- `App.tsx` top nav JSX (the `<nav>` element and everything in it).
- `App.tsx` state: `settingsOpen`, `extensionsOpen`, `topTab`.

### Create
- `web/src/components/SideRail.tsx` — the rail itself. Props: `route`, `navigate`, `selectedRepo`, `repos`, `providerItemCount`, `onAddRepo`. ~150 lines.
- `web/src/components/RepoSwitcher.tsx` — popover at top of rail. ~80 lines.
- `web/src/hooks/useHashRoute.ts` — tiny hook. ~30 lines.
- `web/src/views/` — new directory. One file per route view:
  - `ExtensionsView.tsx`
  - `AgentsView.tsx`
  - `RulesView.tsx`
  - `MemoriesView.tsx`
  - `GlossaryView.tsx`
  - `RepositoriesView.tsx`
  - `DataView.tsx`

Each view is a thin wrapper that renders the existing section content (currently inside SettingsModal) in a full-page chrome with its own header.

### Extract-and-reuse (don't rewrite)
The current `SettingsModal.tsx` has internal sub-components (`RulesSection`, `RuleRow`, memory panel, glossary panel, etc.). Extract these to standalone files under `web/src/components/sections/` so both the modal (until deleted) and the new views can use them. This is the only "refactor" — it's required because we're splitting one modal into seven views.

Candidates to extract:
- `RulesSection` + `RuleRow` → `sections/RulesSection.tsx`
- Memory list + pagination logic → `sections/MemoryPanel.tsx`
- Repository management form → `sections/RepositoryPanel.tsx`
- Agent profile list + MCP assignment → `sections/AgentProfilesPanel.tsx`
- Glossary already uses `GlossaryPanel.tsx` (good — keep as is)
- Data/clear-outputs → `sections/DataPanel.tsx`

Extensions drawer internals (provider cards, MCP tab) move into `ExtensionsView` directly — they're already in their own components, the drawer chrome is just a wrapper.

### Unchanged
- `DetailsSidebar` (right panel) — rendering unchanged.
- `StatusBar`, `ToastNotification`, all modals (CreateTask, EditTask, DiffReview, PlanExpand, TaskAnalystModal).
- All domain hooks (`useBootstrap`, `useTaskState`, etc.) — same data flow.

## View Chrome

Every full-page view shares a consistent layout:

```
┌──────────────────────────────────────────┐
│  View Title                 [actions...] │  ← sticky header, 56px
├──────────────────────────────────────────┤
│                                          │
│  (scrollable content)                    │
│                                          │
└──────────────────────────────────────────┘
```

A shared `ViewShell` component (`web/src/views/ViewShell.tsx`, ~40 lines) provides this chrome. Props: `title`, `actions` (React node), `children`. Matches the header currently inside SettingsModal but without the modal chrome.

## Keyboard Shortcuts

| Shortcut | Action                          |
|----------|---------------------------------|
| ⌘1       | Navigate to Board               |
| ⌘2       | Navigate to Task Analyst        |
| ⌘3       | Navigate to Workflow            |
| ⌘R       | Open repo switcher popover      |
| ⌘,       | Navigate to Repositories        |
| ⌘⇧E      | Navigate to Extensions          |
| Esc      | Close detail sidebar (existing) |

Implemented in a new top-level `useGlobalShortcuts()` hook. On Windows/Linux, `⌘` → `Ctrl`.

## State & Data Flow

No changes to backend. No new endpoints. All existing hooks (`useBootstrap`, `useRulesState`, `useMemoryState`, etc.) continue to live in `App.tsx` and are passed down to the view that needs them.

Rationale: the current hooks are already well-factored. Moving them into per-view containers would create prop-drilling for shared data (e.g. `agentProfiles` is used by Extensions view, Agents view, CreateTaskModal). Keeping them in `App.tsx` with view-level destructuring is the least-disruptive path.

## Cross-Platform Considerations

- Keyboard shortcuts: detect `process.platform` equivalent via `navigator.platform` or `navigator.userAgent` — on non-Mac, `⌘` → `Ctrl` in both the hint labels and the event listener.
- No backend changes, so nothing else platform-specific.

## Out of Scope

- Theme / appearance settings (no such feature currently exists).
- Collapsible rail groups (keep flat for now).
- Drag-to-reorder nav items.
- Per-user customization of which items appear.
- Search box inside the rail.
- Breadcrumbs in the view header.
- Deep-linking into a specific task (would require `#board/task/:id` — deferred).

## Success Criteria

- Top nav is gone. Rail is the only primary navigation surface.
- Every surface reachable in the current app is reachable from the rail in ≤2 clicks.
- SettingsModal and ExtensionsDrawer files are deleted from the codebase.
- Hash route changes on every nav click; browser back/forward works.
- ⌘1/2/3 switch workspace views instantly.
- Build passes (`npm run build`), typecheck passes (`npm run check:server`), ESLint clean.
- Visual QA: rail matches SettingsModal's existing left-nav styling (for continuity of design language).

## Open Questions

None at spec-writing time. Will surface during implementation plan.
