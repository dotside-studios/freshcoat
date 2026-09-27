# Contributing to Freshcoat

Thank you for helping. This guide covers setup, the scripts, the tests, how
the code and the copy are written, and what a pull request needs.

Freshcoat lives in its own repository at
<https://github.com/dotside-studios/freshcoat>. Paths below are relative to
the repository root.

New here? [ARCHITECTURE.md](ARCHITECTURE.md) is a one-page map of the code,
and [docs/good-first-issues.md](docs/good-first-issues.md) lists small tasks
to start with. Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md).

## Setup

You need:

- [Bun](https://bun.sh) 1.3.13 or later, which installs, runs the scripts and
  serves the production build;
- Chromium for Playwright, for the end-to-end tests only:
  `bunx playwright install chromium` (add `--with-deps` on a fresh Linux
  machine).

```sh
bun install
cd apps/editor
bun run dev                                    # http://localhost:3010
```

## Scripts

Each package has its own scripts. Run them from the package directory, or
with `bun run --cwd <package> <script>`.

| Package | Script | What it does |
|---|---|---|
| `editor` | `dev` | Vite dev server on port 3010 |
| `editor` | `build` | The static site, in `editor/dist` |
| `editor` | `preview` | Serves the build on port 3010 |
| `editor` | `test` | Unit tests (vitest and jsdom) |
| `editor` | `typecheck` | `tsc --noEmit` |
| `editor` | `check` | Biome lint and format check |
| `editor` | `e2e` | Playwright end-to-end tests |
| `editor` | `e2e:smoke` | The end-to-end subset CI runs on every pull request |
| `editor` | `fonts:update` | Refreshes the Google Fonts catalog snapshot, `src/fonts/google-fonts.json` |
| `editor` | `notices` | Regenerates `THIRD_PARTY_NOTICES.md` from the installed packages |
| `editor` | `notices:check` | Fails if `THIRD_PARTY_NOTICES.md` is out of date |
| `figma-plugin` | `build`, `test`, `typecheck`, `check` | Builds and verifies the Figma exporter |
| `editor` | `boundaries` | Runs `scripts/check-boundaries.ts` |
| `editor` | `test:scripts` | Runs the tests under `scripts/` |
| `ui`, `workspace` | `test`, `typecheck`, `check` | The same as the editor's |

And at the repository root:

| Command | What it does |
|---|---|
| `bun scripts/check-boundaries.ts` | Fails when anything imports from outside Freshcoat, other than declared npm packages and the three kits |
| `bun scripts/third-party-notices.ts [--check]` | What `notices` and `notices:check` run |
| `bun scripts/check-links.ts` | Fails when a relative link in any Markdown file points to a missing file or heading |
| `bun test scripts` | The tests of these scripts, including the link check over the real docs |

`apps/editor/server.ts` is the production server: `bun apps/editor/server.ts`
serves `apps/editor/dist` with an `index.html` fallback, so every route loads directly.

## Tests

### Unit tests

```sh
cd apps/editor && bun run test
cd packages/ui && bun run test
cd packages/workspace && bun run test
```

| Package | What is covered |
|---|---|
| `ui` | 48 tests: scrubbing, arithmetic input, color parsing, tree, tables |
| `workspace` | 163 tests: imposition on sheets (grid, auto orientation, duplex mirroring on either flip, offsets, refusals) and the PDF read back with pdf-lib, coercion and validation, JSON Schema both ways, CSV and Excel, mapping, binding, file names, archive round trips and refusals (a malformed print profile included), streaming zips, image headers in every format and orientation, PDF |
| `editor` | 829 tests: the barcode section, factory and box rules, the Layout group, sheet planning and the sheet preview, the Event badge starter and its preset, every document operation and refusal (and its no-op keeping identity under Immer), history, geometry and snapping, preview, store and workspace, commands, panels, data grid and gallery, import wizard, export job, selected-record runs and the filmstrip's selection, print request mapping and fallback, sinks and UI, routes, search params and legacy redirects, the Google Fonts catalog and the font picker, theme contrast, gradient geometry and the stop bar, starters, thumbnails, autosave, and a guard against retired words in the copy |

The kits have their own suites, run with `bun test` in each kit's directory:
`packages/engine` (258 tests), `packages/coatfile` (329) and
`packages/for-print` (101). Run them when
you change a kit.

### End-to-end tests

```sh
cd apps/editor
bunx playwright test                           # everything, against the dev server
bunx playwright test e2e/smoke.spec.ts         # one spec
FRESHCOAT_PREVIEW=1 bunx playwright test       # against the production build
```

The suite has 245 tests in real Chromium, 238 of them by default. They cover
the canvas, layers, inspector, fields, gradients, files, workspaces, links,
themes, fonts, starters, data, photos, the gallery, the worker pool, every
export path, print output, memory bounds with 200 12 MP photos, barcodes,
sheets, and screenshots of every section. All of them pass against the dev
server and against the production build.

| Variable | Effect |
|---|---|
| `FRESHCOAT_PORT` | The port the test server uses (3010 by default). Set a free one when another server is running |
| `FRESHCOAT_PREVIEW=1` | Builds with `vite build --mode e2e` (the production build plus the e2e probes) and tests against it |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | A Chromium to use instead of Playwright's own |
| `FRESHCOAT_SHOTS=<dir>` | Also saves pictures of the print settings |
| `GRADIENT_SHOTS=<dir>` | Also saves pictures of the gradient handles |

The browser runs with SwiftShader flags, so WebGL works without a GPU. They
are harmless on a machine that has one.

### Screenshots

`e2e/screenshots.spec.ts` writes a picture of every state, in light and dark,
at desktop, tablet and narrow sizes, to `editor/e2e/screenshots/`
(gitignored). They are not compared to anything: look at the ones your change
touches before you open a pull request, in both themes.

```sh
bunx playwright test e2e/screenshots.spec.ts --grep "desktop light"
```

### Benchmarks

- `/bench?sample=<id>&frames=<n>` in a running editor times a bundled sample.
- `FRESHCOAT_PREVIEW=1 bunx playwright test e2e/bench.spec.ts` runs it against
  the production build. It records the numbers and fails only on gross
  regressions.
- `bunx vitest bench --run src/tests/perf` times the state layer.

[docs/performance.md](docs/performance.md) has the current numbers and how
they were taken. A change on a hot path (a drag, a render, a 10k-record
dataset) should show its numbers before and after.

## Code style

- **Biome** formats and lints: tabs, double quotes, organized imports. Run
  `bun run check` in the package, or `bunx biome check --write <files>` on the
  files you touched. Do not reformat files you did not change.
- **TypeScript** is strict. `bun run typecheck` must pass in every package you
  touch.
- **Icons** come from `unplugin-icons` as MingCute Line
  (`~icons/mingcute/<name>-line`). Fill is only for icons on solid-colored
  buttons.
- **Imports** stay inside Freshcoat: npm packages your package declares, the
  three kits, or relative paths. `scripts/check-boundaries.ts` enforces it.
- **Comments** say what the code does and why it has that shape. They do not
  narrate history ("used to", "now", "was changed to"); that belongs in the
  commit message. No comment is better than one that repeats the code.
- **No license headers** in source files. The repository's LICENSE and NOTICE
  cover them.

## Releases

For versioning, package artifacts and publication, see the
[release guide](docs/releases.md).

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
- Shared strings live in `editor/src/app/copy.ts`. A guard test,
  `editor/src/tests/copy.test.ts`, keeps retired words out.

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

## Commits

[Conventional Commits](https://www.conventionalcommits.org), one focused
change each, with the package as the scope:

| Scope | For |
|---|---|
| `freshcoat-editor` | `editor/` |
| `freshcoat-ui` | `ui/` |
| `freshcoat-workspace` | `workspace/` |
| `freshcoat` | several packages, docs, scripts and repository files |
| `coatfile`, `coat-engine`, `for-print` | a change to a kit |

For example `feat(freshcoat-editor): a shortcut to add a gradient stop`,
`fix(freshcoat-workspace): ...`, `perf(coat-engine): ...`,
`test(freshcoat-editor): ...`, `docs(freshcoat): ...`.

## How to

### Add a UI kit component

1. Add `ui/src/<name>.tsx`. Build on a `react-aria-components` primitive where
   one exists, so keyboard, focus and screen reader behavior come with it.
   Style with Tailwind classes over the tokens in `ui/src/theme.css`, never
   raw colors, so both themes work.
2. The package exports every file in `src/` by name, so the editor imports it
   as `@freshcoat/ui/<name>`.
3. Show it in the gallery, `ui/src/gallery.tsx` (the `/kit` route), in both
   themes.
4. Test anything beyond markup in `ui/src/tests/<name>.test.tsx`.

### Add a starter

1. Write the template in `editor/src/samples/<name>.ts`, as the other
   starters do (`photo-watermark.ts`, `event-badge.ts`). Use your own marks:
   the Davi wordmark is not licensed for reuse (see
   [NAMES-AND-LOGOS.md](NAMES-AND-LOGOS.md)).
2. Add an entry to `STARTERS` in `editor/src/samples/starters.ts`: an `id`
   (which `?starter=<id>` opens), a name, a one-line description, its size,
   a swatch color, a lazy `load`, and optionally the export `preset` it opens
   with.
3. Extend `editor/src/tests/starters.test.ts` (the template validates, its
   fields are bound, its preset is what you meant) and
   `editor/e2e/starters.spec.ts`.
4. List it in [docs/features.md](docs/features.md) and in the `?starter=` row
   of its Links table.

### Add a document operation

1. Write it in `editor/src/doc/ops.ts` as a pure function from a `Template`
   to an `OpResult`: `ok(template)` on success, or `refuse(code, reason)` with
   a new `RefusalCode` in `doc/result.ts` when it cannot apply. Check
   refusals before changing anything.
2. A call that changes nothing returns the same template object, not a copy:
   history, the dirty check and several caches compare by identity. Draft
   small objects only if you use `produce` from `~/state/immer`.
3. Call it from a method on `EditorController` (`editor/src/app/controller.ts`)
   through `this.edit(...)`, which commits one undo step and toasts a refusal.
4. If a person can trigger it from a menu or a key, add a `Command` in
   `editor/src/app/commands.ts`; one with `keys` appears in the shortcuts
   sheet.
5. Test it in `editor/src/tests/ops.test.ts`: the result, each refusal, and
   the no-op keeping identity.

### Add an export format

1. Add it to `ExportFormat` in `workspace/src/types.ts` and to the preset
   schema in `workspace/src/archive.ts`, so `.coatworkspace` files keep it.
2. Map it in `workspace/src/plan.ts`: `imageFormat` (what each file is
   encoded as) and `fileExtension`.
3. If it needs a new encoding, add it to `OutputFormat` in
   `editor/src/export/protocol.ts` and encode it in
   `editor/src/export/render-worker.ts` (the workers use CanvasKit's `full`
   build, which has the PNG, JPEG and WebP encoders).
4. Offer it in `editor/src/export/ExportSettings.tsx` and name it in
   `editor/src/export/export-ui.ts`.
5. Test the plan in `workspace/src/plan.test.ts`, the job in
   `editor/src/tests/export-job.test.ts`, and add a case to
   `editor/e2e/export.spec.ts` that opens the file it makes.

## Pull requests

Before you open one:

- [ ] `bun run typecheck`, `bun run check` and `bun run test` pass in every
      package you touched.
- [ ] The end-to-end specs for the area you changed pass, and the smoke specs
      (`smoke`, `workspace`, `data`, `export`) still do.
- [ ] New behavior has tests: a unit test for logic, a Playwright spec for an
      interaction.
- [ ] UI changes: screenshots in light and dark, at desktop and tablet
      widths, attached to the pull request.
- [ ] Copy follows the style and vocabulary above.
- [ ] A new dependency is justified in the description, has an accepted
      license, and `bun run notices` has been run in `editor/`.
- [ ] Docs are updated where behavior changed: [docs/features.md](docs/features.md),
      the known limits in the [README](README.md), or
      [ARCHITECTURE.md](ARCHITECTURE.md).
- [ ] Commits are focused and follow Conventional Commits.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), as section 5 of the license provides.
