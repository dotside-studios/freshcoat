# Contributing to Studio

Read the [repository contribution guide](../../CONTRIBUTING.md) first.
This guide covers the browser editor: its development server, interaction
tests, copy conventions and extension points. Paths are relative to
`apps/editor/` unless stated otherwise.

The [architecture](ARCHITECTURE.md) maps the store, controller and render
pipeline. [Features](docs/features.md) describes the user-facing behavior;
[contribution ideas](docs/good-first-issues.md) lists small starting points.

## Setup and scripts

Install dependencies from the repository root with `bun install`, then run
these commands from `apps/editor/`:

| Command | What it does |
|---|---|
| `bun run dev` | Vite development server at http://localhost:3010 |
| `bun run build` | Static site in `dist/` |
| `bun run preview` | Serves the built site on port 3010 |
| `bun run test` | Unit tests with Vitest and jsdom |
| `bun run typecheck` | TypeScript checks |
| `bun run check` | Biome lint and formatting checks |
| `bun run e2e` | Browser end-to-end tests |
| `bun run e2e:smoke` | The browser subset used by CI |
| `bun run fonts:update` | Refreshes `src/fonts/google-fonts.json` |

The notices, boundaries and script-test aliases here run repository-wide
checks. Prefer the root commands described in the repository guide.

## Browser tests

Install Chromium from this directory:

```sh
bunx playwright install chromium
bun run e2e:smoke
FRESHCOAT_PREVIEW=1 bun run e2e:smoke
bunx playwright test e2e/smoke.spec.ts
```

On a fresh Linux machine, add `--with-deps` to the browser installation.
The suite exercises canvas interactions, files, datasets, exports and routes.
Run the specs for the area you changed, plus the smoke suite. A release gate
uses the production build with test probes rather than the development server.

| Variable | Effect |
|---|---|
| `FRESHCOAT_PORT` | Test server port; defaults to 3010 |
| `FRESHCOAT_PREVIEW=1` | Builds with `vite build --mode e2e` and tests the production output |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Uses a supplied Chromium executable |
| `FRESHCOAT_SHOTS=<dir>` | Also saves print-settings pictures |
| `GRADIENT_SHOTS=<dir>` | Also saves gradient-handle pictures |

The browser uses SwiftShader flags so WebGL works without a GPU. Prefer
locator input methods such as `fill()` when replacing text; an emulated
browser platform and the host's native text shortcuts can differ.

### Screenshots and benchmarks

`e2e/screenshots.spec.ts` writes screenshots to `e2e/screenshots/`
(gitignored). These are for manual inspection, not snapshot comparison.
For a UI change, inspect both themes and the relevant viewport sizes.

```sh
bunx playwright test e2e/screenshots.spec.ts --grep "desktop light"
FRESHCOAT_PREVIEW=1 bunx playwright test e2e/bench.spec.ts
bunx vitest bench --run src/tests/perf
```

The running app also exposes `/bench?sample=<id>&frames=<n>`.
[Performance](docs/performance.md) records earlier measurements and their
conditions. For a hot-path change, report new before-and-after measurements.

## UI conventions

Icons use MingCute Line through `unplugin-icons`
(`~icons/mingcute/<name>-line`); fill variants are for solid-colored buttons.
Use shared controls and theme tokens from `@freshcoat/ui`. For a new shared
component, follow the [UI package guide](../../packages/ui/README.md#contributing).

## Copy

Every string a person reads follows this style:

- Short and plain, like Figma, Linear or Photoshop. Say what it is or what to
  do, not why.
- Sentence case everywhere: "Import JSON schema", not "Import JSON Schema".
- No period on labels, buttons, menu items, tooltips, toasts or one-sentence
  hints and empty states. Two-sentence help text takes periods.
- An ellipsis only on a command that opens a dialog, a picker or a file
  chooser before it acts.
- American spelling: "color", "center", "optimize".
- Failures start with "Couldn't". Refusals are stated plainly ("Layers must
  share a parent"). Counts go through `plural()`.
- Empty states: a title of at most four words, and at most one short line or
  one button.
- Shared strings live in `src/app/copy.ts`. A guard test,
  `src/tests/copy.test.ts`, keeps retired words out.

One word for each thing:

| Use | Not |
|---|---|
| template | document, design (a design is what a person makes; the file is a template) |
| side | page, frame (a frame is a layer type) |
| layer | element, node |
| field | variable (the tab that lists fields is "Content"), key (except the key input) |
| dataset | data (as a noun for one), table |
| record | row, entry |
| column | property |
| preset | export setting |
| export (verb and noun) | render, make |
| select | tick |

The same rules apply to the docs: sentence case headings, plain short words,
American spelling, and no em dashes.

## Extension points

### Add a starter

1. Write the template in `src/samples/<name>.ts`, as the other
   starters do (`photo-watermark.ts`, `event-badge.ts`). Use your own marks:
   the Davi wordmark is not licensed for reuse (see
   [NAMES-AND-LOGOS.md](../../NAMES-AND-LOGOS.md)).
2. Add an entry to `STARTERS` in `src/samples/starters.ts`: an `id`
   (which `?starter=<id>` opens), a name, a one-line description, its size,
   a swatch color, a lazy `load`, and optionally the export `preset` it opens
   with.
3. Extend `src/tests/starters.test.ts` (the template validates, its
   fields are bound, its preset is what you meant) and
   `e2e/starters.spec.ts`.
4. List it in [docs/features.md](docs/features.md) and in the `?starter=` row
   of its Links table.

### Add a document operation

1. Write it in `src/doc/ops.ts` as a pure function from a `Template`
   to an `OpResult`: `ok(template)` on success, or `refuse(code, reason)` with
   a new `RefusalCode` in `doc/result.ts` when it cannot apply. Check
   refusals before changing anything.
2. A call that changes nothing returns the same template object, not a copy:
   history, the dirty check and several caches compare by identity. Draft
   small objects only if you use `produce` from `~/state/immer`.
3. Call it from a method on `EditorController` (`src/app/controller.ts`)
   through `this.edit(...)`, which commits one undo step and toasts a refusal.
4. If a person can trigger it from a menu or a key, add a `Command` in
   `src/app/commands.ts`; one with `keys` appears in the shortcuts
   sheet.
5. Test it in `src/tests/ops.test.ts`: the result, each refusal, and
   the no-op keeping identity.

### Add an export format

1. Add it to `ExportFormat` in `../../packages/workspace/src/types.ts` and to
   the preset schema in `../../packages/workspace/src/archive.ts`, so
   `.coatworkspace` files keep it.
2. Map it in `../../packages/workspace/src/plan.ts`: `imageFormat` (what each
   file is encoded as) and `fileExtension`.
3. If it needs a new encoding, add it to `OutputFormat` in
   `src/export/protocol.ts` and encode it in
   `src/export/render-worker.ts` (the workers use CanvasKit's `full`
   build, which has the PNG, JPEG and WebP encoders).
4. Offer it in `src/export/ExportSettings.tsx` and name it in
   `src/export/export-ui.ts`.
5. Test the plan in `../../packages/workspace/src/plan.test.ts`, the job in
   `src/tests/export-job.test.ts`, and add a case to
   `e2e/export.spec.ts` that opens the file it makes.

## Review checklist

Follow the repository checklist, and for Studio changes also:

- Run the relevant browser specs and the smoke suite.
- Attach before-and-after screenshots for visual changes, in both themes.
- Check that a data or export change works with more than one record.
- Update [features](docs/features.md), known limits in the [README](README.md),
  or [architecture](ARCHITECTURE.md) when the behavior changes.
