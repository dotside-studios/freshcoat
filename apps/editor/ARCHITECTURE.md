# Studio architecture

Studio combines the shared Freshcoat packages into a browser application.
For the project-wide boundaries, see the [repository architecture](../../ARCHITECTURE.md).
For behavior and measurements, see [features](docs/features.md) and
[performance](docs/performance.md).

Paths such as `src/state/store.ts` are relative to `apps/editor/`.

## Editing: store, controller, render session, canvas

```
 user input ──► commands / panels / canvas
                      │
                      ▼
               EditorController ── doc/ops (pure) ──► OpResult
                      │ dispatch(action)
                      ▼
                 EditorStore (reducer, history, workspace layer)
                      │ useSyncExternalStore
          ┌───────────┴──────────────┐
          ▼                          ▼
   panels, overlay (SVG)     useLiveRender ─► buildPreview ─► RenderScheduler
                                                                   │
                                                                   ▼
                                                  RenderSession (CanvasKit, warm)
                                                                   │
                                        canvas pixels + layer geometry ─► store
```

- **Store** (`src/state/store.ts`): one external store, a reducer over
  typed actions, read by components through `useSyncExternalStore` with a
  selector (`useEditor`). It holds the open template's history, the
  selection, the view, the tool, editor-only state (hidden and locked layers,
  preview values) and the workspace.
- **Controller** (`src/app/controller.ts`): the only thing that turns
  intent into actions. Menus, keyboard commands (`app/commands.ts`), panels
  and canvas gestures call its methods; it runs a document operation, commits
  the result as one undo step, and toasts a refusal.
- **Document core** (`src/doc`): pure TypeScript, no React. Layers are
  addressed by path (`side/index/index…`). Operations in `ops.ts` return a new
  template with structural sharing, or a refusal with a reason. `geometry.ts`
  converts between parent-relative and absolute boxes, and snaps.
- **Render session** (`src/render/session.ts`): one CanvasKit pipeline
  kept warm for the session. The coat engine's paint cache owns the WebGL surface,
  the font provider and decoded images, and a memoized paragraph engine
  reshapes text only when it changes. Every render is timed (compile, layout,
  lower, paint).
- **Scheduler** (`src/render/scheduler.ts`): one render in flight, and
  a newer request replaces any waiting one, so a drag paints as fast as the
  pipeline keeps up and never queues.
- **Canvas** (`src/canvas`): `useLiveRender` builds a one-side preview
  (`doc/preview.ts`), requests a render, and writes the laid-out layer boxes
  back to the store. The selection, handles, snap guides and gradient handles
  are SVG in screen space over the canvas: they follow the pointer at once,
  while the paint catches up. Editing text in place (`canvas/TextEditor.tsx`)
  sets the store's `textEdit`: a textarea stands over the layer, the render
  leaves the layer out, and the controller holds the edit in one history
  transaction.

### Document model and history

A template is a `@freshcoat-js/coatfile` `Template`: sides, each a tree of layers,
plus fields, fonts, variants and metadata. Studio edits it and never
extends it. History (`doc/history.ts`) is a list of whole templates, which
structural sharing makes cheap: up to 200 steps, with commits under the same
merge key within a second folded into one (a burst of typing, a run of
nudges), and transactions for gestures (a drag is one step however many
frames it paints). Ruler guides (`doc/guides.ts`) are editor state, not part
of the template: each history step pairs the template with its guides, so
they undo in the same timeline, and the workspace saves them in the
`.coatworkspace` manifest. Datasets have their own history in the workspace
layer.

Variants are edited through a **working template**: the base with the active
variant applied (`working(state)` in `state/store.ts`), ids unchanged, so a
layer path means the same layer in both. Hidden layers stay in it, so they
can be listed and selected. The panels read it, and every op runs on it as it
would on the base; the canvas draws the variant as an export does, without
the hidden layers. The reducer then folds the result
back into the base (`foldVariantEdit`, `doc/variant-edit.ts`) by diffing it
against the base, so the change is written as the variant's deltas and every
existing op works in a variant unchanged. Structural ops (adding, deleting,
grouping, reordering and renaming layers and sides, managing variants) run on
the base with `scope: "base"`, since every variant shares one layer tree.
Saving, autosave and exports read the base.

### The workspace

`state/workspace.ts` holds every template in the workspace as a slot. The
active one lives in the store's `doc`; the others are parked with their own
history, side and view, and restored when switched to. Autosave
(`app/autosave.ts`) writes the workspace to IndexedDB, and each photo once,
apart from the templates and data. Each opened workspace gets a recent entry
(`app/recent.ts`), and its autosave names that entry, so the welcome screen
lists only what it can still open.

## Data

The Data section (`src/data`) edits datasets: typed columns (the
schema) and records. The table and the gallery run on react-aria's
`Virtualizer`. Import goes through `@freshcoat-js/workspace`'s tabular readers
and a mapping wizard. Photos stay as the browser's `Blob`s, referenced from
records as `ws:<sha256>`; thumbnails are made in a worker
(`thumbnail-worker.ts`) and kept in a bounded LRU, so no grid decodes a whole
photo.

The section unmounts when another is shown, so how it shows each dataset (the
search, filters, sort and selection) lives in the store's `dataViews`, by
dataset id, outside the undo history and the saved workspace. Export reads a
dataset's selection from there to offer it.

## Export

```
 ExportSection / Export selected
          │
          ▼
 ExportJobs ─► ExportRunner ─► WorkerPool (module workers, CanvasKit each)
                    │                         │ RenderOutput (bytes)
                    ▼                         ▼
              runExportJob ── planExport ──► in order, windowed
                    │
          ┌─────────┴───────────┐
          ▼                     ▼
   OutputSink (zip parts,   PDF pages ─► assemblePdf (pdf-lib, loaded on demand)
   zip file, folder)
```

- **Plan** (`../../packages/workspace/src/plan.ts`): a preset and a workspace become a list
  of items, one per record and side, with its file name and size.
- **Runner and pool** (`src/export/use-export-runner.ts`,
  `worker-pool.ts`): one job at a time over a pool of module workers
  (`render-worker.ts`). Each worker loads CanvasKit's full build (it has the
  JPEG and WebP encoders), renders through coatfile and, when asked,
  for-print, and keeps decoded photos in an LRU. The pool is at most 4
  workers, 2 when photos pass 24 megapixels.
- **Job** (`runExportJob` in `../../packages/workspace/src/export/job.ts`):
  renders at most the pool's size at once and dispatches at most twice that
  ahead of what is written, writes items in plan order, records failures and
  goes on, and writes `export-report.csv`. `src/export/use-export-runner.ts`
  runs it over Studio's worker pool. On sheets,
  `../../packages/workspace/src/export/sheets.ts` and
  `../../packages/workspace/src/impose.ts` place each card on paper.
- **Preview** (`src/export/ExportSection.tsx`, `src/export/printer-file.ts`):
  the preview template comes from `itemTemplate` and the printer file's
  request from `itemRequest`, the functions the job itself uses, so both show
  what the export renders. The printer file only switches a PDF's pages to
  PNG and caps the long edge at `PRINTER_FILE_MAX_EDGE`.
- **Statuses** (`../../packages/workspace/src/export/status.ts`): a finished
  job's `recordOutcome` marks records exported or failed when the preset has
  `markExported`. `statusActions` in `src/export/export-ui.ts` turns it into
  store actions, which write it outside the undo history.
- **Sinks** (`src/export/sinks.ts`): where files go. Download zips in
  memory and hands over 512 MB parts; Zip file and Folder write through the
  File System Access API as items finish.

## Routing

The URL mirrors the store, never the other way round. `app/router.tsx` has
code-based TanStack Router routes (`/edit`, `/data`, `/export`, `/kit`,
`/bench`), and `app/url-state.ts` parses and writes the search. The store owns
what is shown; `use-url-state.ts` writes it to the URL at most once a frame,
and applies Back, Forward or an edited URL to the store. Opening links
(`?sample=`, `?starter=`, `?new=`) run once and are removed.

The Figma plugin hands a template over in the fragment, which the browser
never sends to a server: `#coat=<data>` is the template JSON, raw-deflated and
base64url-encoded, and `app/handoff.ts` decodes and validates it before it
joins the open workspace (or the autosaved one, restored, or a new one).
`#open=1` is the plugin saying the template was too large for a link and was
downloaded instead: the welcome screen rings **Open file…** and says to open
that file, or, over a workspace, a toast says so with the same action. An older
plugin's `#drop=1` is read the same way. Both run once and are removed, like
the search intents.

Another page can hand a template over the same way and add
`&return=<its origin>` (https, or http on localhost). Studio then shows
**Send to <host>** for that template, and `app/send-back.ts` posts the
validated template to `window.opener`, addressed to that origin only, and
waits for the page to answer `freshcoat:received` or `freshcoat:rejected`.
Nothing is saved by sending: the page decides what to do with it, and Studio
still has no account or server.

A file is opened only through **Open file…**: a
file dropped on the window is refused, except an image, placed in the open
template, and the photos and spreadsheets the Data section takes.

## Libraries, and why

- **TanStack Router** gives typed routes, redirects for older links, and lazy
  chunks for `/kit` and `/bench`, in place of a hand-written hash router.
- **Immer** writes the workspace layer and a few template ops, where a recipe
  costs no more than the spreads it replaces. It is configured once, in
  `state/immer.ts`, with auto-freeze off, since freezing 10k-record datasets
  on every change costs more than it protects. The drag path (`doc/tree.ts`)
  stays hand-written: as recipes it measured 300 times slower.
- **TanStack Virtual** windows the two lists that are only a scrolling strip
  of cells: the Export filmstrip and the font picker. The data grid, the
  gallery and the layer tree stay on react-aria's `Virtualizer`, which gives
  them grid semantics, roving focus, range selection and column resizing.

[performance](docs/performance.md) has the measurements behind each.

## File layout

```text
apps/editor/
  README.md ARCHITECTURE.md CONTRIBUTING.md
  docs/           features, performance, contribution ideas and screenshots
  server.ts       the production static server
  scripts/        the Google Fonts catalog updater
  e2e/            Playwright specs, helpers and probes
  src/
    doc/          document operations, history, paths, geometry and resizing
    state/        the store, workspace layer and Immer setup
    render/       the CanvasKit session, scheduler, fonts and barcode loader
    canvas/       viewport, overlay, live render, handles and print guides
    app/          controller, commands, shell, menus, routes and autosave
    panels/       layers, design, content and template setup
    data/         grid, gallery, columns, import wizard and thumbnails
    export/       jobs, worker pool, rendering, sinks, sheets and print
    fonts/        the Google Fonts catalog and picker
    binding/      the binding editor
    samples/      samples and starters
    tests/        unit tests and state-layer benchmarks
```

Shared models and controls live under `packages/`, not inside this app.
See their READMEs before adding behavior that other hosts could reuse.

## Glossary

| Word | Means |
|---|---|
| template | The file a person designs: sides of layers, fields, fonts, variants. A `.coat` holds one |
| side | One face of a template, such as front or back |
| layer | One element on a side: frame, rectangle, ellipse, text, image, QR, barcode, vector |
| field | A named value a template reads, written as `{{field}}` in text |
| variant | A named version of a template, such as a color scheme or a badge for speakers. It shares the template's layers and records only what it changes: a side's background, and a layer's properties, position, size, rotation, opacity or visibility. Default is the template with none applied |
| workspace | Templates, datasets, bindings and presets together, saved as `.coatworkspace` |
| dataset | A schema of typed columns and the records that follow it |
| record | One entry in a dataset, which fills one output |
| column | One typed value every record in a dataset has |
| binding | Which column, fixed value or pattern fills each of a template's fields |
| preset | A saved export: template, records, sides, size, format and destination |
| export | Turning a preset into files; also the section that does it |
| starter | A template meant to be made your own, opened from the welcome screen |
| sink | Where an export's files go: a download, a zip file or a folder |
