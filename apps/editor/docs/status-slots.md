# Proposal: status slots and shared progress

Status: exploration. Nothing here is built yet.

Studio's status surfaces have grown one at a time, each wired straight into
the shell or into a section. This note takes stock of them and proposes a
middle layer, modeled on VS Code's status bar items and `withProgress`, so a
feature contributes an item or reports a task without editing the shell.

Paths are relative to `apps/editor/`.

## What there is today

| Surface | Where | Owner of the state | Visible in |
|---|---|---|---|
| Side and variant menus, size, selection summary | `src/app/StatusBar.tsx` | store | Edit |
| Issues button and popover | `src/app/IssuesPopover.tsx`, rendered by `StatusBar` | store | Edit |
| Record stepper "◀ 7/120 ▶" | `RecordStep` in `StatusBar.tsx` | store + workspace binding | Edit |
| Render error and render stats | `StatusBar.tsx`, toggle in `src/app/render-stats.ts` | store + localStorage | Edit |
| Zoom field and menu | `ZoomField` in `StatusBar.tsx` | store | Edit |
| Data footer: records, selection, issues, columns, photos | `DataStatus` in `src/data/DataSection.tsx` | dataset + `grid-state` | Data |
| Export progress, compact | `src/export/JobIndicator.tsx`, rendered by `AppMenuBar` | `export-jobs.ts` | everywhere but Export |
| Export progress, full | `src/export/JobBar.tsx` | `export-jobs.ts` | Export |
| Photo import progress and Cancel | `src/data/PhotoImportBar.tsx` | module store in `src/data/actions.ts` | Data |
| Table import progress | `src/data/ImportWizard.tsx` | component state | the wizard dialog |
| Dirty dot, file name, Send to | `AppMenuBar.tsx` | store | everywhere |
| Finished, failed or canceled work | toasts from `export-jobs.ts`, `actions.ts`, `controller.ts` | each caller | everywhere |

What this costs:

- **The shell knows every feature.** `StatusBar` imports from `canvas`,
  `doc`, `state`, `workspace` and `IssuesPopover`; `AppMenuBar` imports
  `export/JobIndicator`. Adding an indicator means editing a shell file and
  choosing a spot in its JSX by hand.
- **Two status bars.** Edit's bar sits inside the Edit section's container,
  and Data renders its own `<footer>` with the same height and type but a
  different background. Export has none.
- **Three progress models.** Export keeps a `subscribe`/`getSnapshot` store,
  photo import a module-level listener set, the wizard `useState`. Each
  renders its own `ProgressBar` with its own label format.
- **Progress can be lost.** `PhotoImportBar` is rendered by `DataSection`,
  which unmounts when another section is shown. Switching to Edit during an
  import leaves it running with no progress and no Cancel until Data is
  opened again. Export avoids this only because `JobIndicator` was put in
  the menu bar by hand.
- **"Hide when the detailed view is open" is per feature.**
  `JobIndicator` checks `section === "export"`; `export-jobs.ts` checks the
  same before toasting. The next long task will copy both.

## Proposal

Two small pieces under `src/app/status/`, between the shell and the
features. Neither adds a dependency.

### 1. Status items: slots the shell renders

A feature declares an item; the shell renders the items for the current
section, ordered by alignment and priority. This is VS Code's
`StatusBarItem` (alignment, priority, id, name) without the dynamic
extension API, since Studio has no extensions: a static list keeps order
deterministic, typed and testable.

```ts
// src/app/status/types.ts
export type StatusItem = {
	id: string;
	/** shown in the bar's context menu, to hide and show the item */
	name: string;
	sections: readonly Section[] | "all";
	align: "start" | "end";
	/** higher sits closer to its edge, and is the last to go when narrow */
	priority: number;
	/** cheap store check; the item is not mounted while false */
	when?: (s: EditorState) => boolean;
	component: ComponentType;
};
```

```ts
// src/app/status/items.ts: the only list the shell reads
export const STATUS_ITEMS: readonly StatusItem[] = [
	...EDIT_STATUS_ITEMS,   // src/canvas/status-items.tsx
	...DATA_STATUS_ITEMS,   // src/data/status-items.tsx
	ISSUES_ITEM,            // src/app/IssuesPopover.tsx
	ACTIVITY_ITEM,          // src/app/status/Activity.tsx, see below
];
```

Each existing piece of `StatusBar` and `DataStatus` becomes one item in the
folder it reads from, with its `data-testid` unchanged. `StatusBar` shrinks to
a loop:

```tsx
export function StatusBar() {
	const section = useEditor((s) => s.section);
	const hidden = useHiddenStatusItems();
	const items = STATUS_ITEMS.filter(
		(i) => (i.sections === "all" || i.sections.includes(section)) && !hidden.has(i.id),
	);
	return (
		<footer className="@container flex h-6 …">
			<Slot items={items} align="start" />
			<span className="flex-1" />
			<Slot items={items} align="end" />
		</footer>
	);
}
```

The bar moves from inside the Edit container to `Workspace.tsx`, under all
three sections, so Data drops its own footer and Export gains one.

Priorities are named constants in `items.ts`, not numbers scattered across
features. Narrow windows drop the lowest priorities first through container
queries, the way `JobBar` already folds its detail.

Right-clicking the bar lists the items by `name` with a check each,
remembered per browser like the theme. Render stats becomes one such item,
hidden by default, and View > Render stats toggles it, so
`render-stats.ts` reduces to the generic visibility store.

### 2. Tasks: one progress model the shell shows

Long work reports through one service, held beside the controller as
`exportJobsFor` is, so it outlives section switches. This is VS Code's
`window.withProgress` with a cancellation signal.

```ts
// src/app/status/tasks.ts
export type TaskOptions = {
	id: string;
	title: string;            // "Reading photos", "Exporting Badges"
	/** the section with the task's detailed view, if any */
	section?: Section;
	cancellable?: boolean;
};

export type TaskReport = { done: number; total: number; failed?: number };

export function withTask<T>(
	tasks: Tasks,
	options: TaskOptions,
	run: (report: (r: TaskReport) => void, signal: AbortSignal) => Promise<T>,
): Promise<T>;

export function useTasks(): readonly TaskSnapshot[];
```

The shell renders them with one item, `Activity`, at the end of the bar:

- one task: its title, a compact `ProgressBar` and "done / total";
- several: "2 tasks" and a combined bar;
- pressing it opens a popover listing each task with its own bar, Cancel
  when `cancellable`, and **Show** when it has a `section`;
- a task whose `section` is showing is left out, so the Export section's
  `JobBar` and the bar never repeat each other. This replaces
  `JobIndicator`'s own check.

When a task ends, the service toasts its outcome only if its `section` is
not showing, which replaces the check in `export-jobs.ts`. Features keep
their own result details: Export's history, retry and report stay in
`export-jobs.ts` and `JobBar`, which go on reading their own store. Export
mirrors its runner's progress into a task; it does not move its state.

What moves where:

| Today | With tasks |
|---|---|
| `JobIndicator` in the menu bar | removed; Export reports a task |
| `PhotoImportBar` inside Data | removed; `preparePhotos` runs in `withTask` and is visible and cancellable from any section |
| module store and `usePhotoImportProgress` in `data/actions.ts` | removed |
| `ImportWizard` progress | unchanged: it is inside a modal the person is looking at |

## Feasibility

High, and low risk:

- Every item already reads the store through `useEditor` or a feature store
  through `useSyncExternalStore`, so lifting them out of `StatusBar` changes
  where they are declared, not what they read.
- The task service is the pattern `export-jobs.ts` and `data/actions.ts`
  already implement twice, generalized once.
- Lazy loading holds: items are small modules imported by the shell, as
  `JobIndicator` already is; `DataSection` and `ExportSection` stay lazy.
- Tests keep their hooks: `job-indicator` (2 files) and
  `photo-import-progress` (1) move to the activity item's test id;
  `data-status` (9), `status-record` (4), `issues-badge` (4) and
  `status-variant` (1) keep theirs on the ported items.

Things to decide while building:

- **Where progress lives.** The status bar is the VS Code answer and needs
  the bar lifted to the shell. If the bar should stay per section, the
  activity item can sit in the menu bar's right cluster instead, where
  `JobIndicator` is now; the task service is the same either way.
- **Data's footer background** is `bg-fc-panel` and Edit's `bg-fc-app`;
  one shell bar picks one.
- **Touch:** the bar is 32px tall on coarse pointers; the activity
  popover's Cancel and Show need the same target sizes as the record
  stepper.
- **Not in scope:** a runtime `register()` API, notifications beyond the
  existing toasts, and moving `AppMenuBar`'s file name, dirty dot and Send
  to into slots. The menu bar's right cluster could use the same `Slot`
  later if it keeps growing.

## Order of work

Each step ships on its own and leaves the app working.

1. **Tasks.** Add `tasks.ts`, `useTasks` and the `Activity` item, rendered
   in the menu bar where `JobIndicator` is. Port photo import, which fixes
   the lost progress, then mirror export and delete `JobIndicator` and
   `PhotoImportBar`.
2. **Slots for Edit.** Add `StatusItem`, `items.ts` and `Slot`; split
   `StatusBar` into items one to one. No visible change.
3. **One bar.** Port `DataStatus` to items, move the bar to `Workspace.tsx`
   and the activity item into it.
4. **Hide and show.** The context menu and the visibility store; fold render
   stats into it.
