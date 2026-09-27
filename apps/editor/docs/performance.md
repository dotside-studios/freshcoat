# Studio performance

Measurements of Studio's render pipeline, export workers and state layer.
These are historical measurements from the implementation stages named below,
not benchmarks of the current release. The software-rendered container results
should not be treated as timings for GPU-backed browsers.

## The render pipeline

The editor keeps one render pipeline warm for the whole session:
- a `PaintCache` owns the WebGL surface, the font provider and the decoded
  images;
- a memoized paragraph engine shapes a paragraph only when its text, font or
  width changes;
- the scheduler renders only the newest edit, one render at a time.

Both caches are opt-in APIs in the coat engine, the `@freshcoat-js/engine` render
package (`createPaintCache`, `memoizeTextEngine`). Callers choose whether to keep these caches between renders.

Measured with `/bench` against the production build, in headless Chromium on a
4-core container. The median is p50 and the slowest 5% is p95. The uncached
layout and lowering figures were taken from a development build before the
text cache landed. Headless Chromium draws WebGL on the CPU through
SwiftShader.

| Full-feature fixture, 30 repaints | p50 per render |
|---|---|
| Fresh env, surface and text engine every render (what a caller without a session pays) | 132 ms |
| Render session with the paint cache | 1.5 ms |

Phase 3's and phase 4's numbers were taken the same way, one test at a
time. Phase 4's are the median of three runs of the production build on an
otherwise idle 4-core container. The first run after a build was 5 to 15%
slower than the two after it, so a single run does not resolve 5%.

| 90 awaited drag frames | membership card 1012×638, phase 2 | phase 3 | phase 4 | certificate 842×595, phase 2 | phase 3 | phase 4 |
|---|---|---|---|---|---|---|
| total p50 / p95 | 18.1 / 32.2 ms | 19.2 / 27.3 ms | 19.0 / 25.6 ms | 26.6 / 38.8 ms | 26.2 / 38.8 ms | 27.1 / 35.0 ms |
| compile | 1.5 ms | 1.4 ms | 1.4 ms | 1.0 ms | 1.0 ms | 1.1 ms |
| layout (text shaping cached) | 0.2 ms (8.2 ms uncached) | 0.1 ms | 0.2 ms | 0.2 ms (23.7 ms uncached) | 0.2 ms | 0.2 ms |
| lower to draw commands | 0.1 ms (9.9 ms uncached) | 0.1 ms | 0.1 ms | 0.1 ms (12.4 ms uncached) | 0.1 ms | 0.1 ms |
| paint (CPU-rasterized WebGL) | 15.9 ms | 17.4 ms | 17.1 ms | 25.1 ms | 24.7 ms | 25.4 ms |
| typing one character, p50 | 21.7 ms | 19.2 ms | 20.0 ms | n/a | n/a | n/a |

Every phase 4 figure is within 5% of phase 3's. The certificate's p50 and
typing are 3 to 4% slower, inside the spread between runs, and the
JavaScript stages (compile, layout, lowering) are unchanged.

What this shows:
- Once the caches are warm, coatfile and the coat engine take about 2 ms of
  JavaScript per edit: compile, layout and lowering together.
- What remains is painting. Here the GPU is software-emulated, so painting runs
  on the CPU, and it scales with the pixel count and with effects such as
  blurred shadows. On real GPU hardware this is the part that gets fast.
- A continuous drag in headless Chromium runs at about 15 to 25 fps. That rate is
  set by the software rasterizer: the main thread has no long tasks during a
  drag. The editor itself does little work per drag frame:
  - only the position fields in the inspector re-render;
  - the layer tree waits until the drag ends;
  - the status bar readout is throttled.

## Export

| Export, pool of 3 workers | phase 2 | phase 3 | phase 4 |
|---|---|---|---|
| 200 records, two sides: 400 PNGs of 1012×638, a 45 MB zip | 32 s, 12.4 items/s, workers up in 0.6 s | 32.2 s, 12.4 items/s, workers up in 0.3 s | 32.6 s, 12.3 items/s, workers up in 0.4 s |
| 200 photos of 4000×3000 (933 MB of JPEGs) watermarked at their own size as JPEG 90, 753 MB out in two 512 MB zip parts | not possible (no JPEG or size from a photo) | 219 s, 0.91 items/s | 227 s, 0.88 items/s (one run) |

The photo export decodes, draws and encodes 12 megapixels an item on the CPU,
about 3.3 s of work per photo per worker, and holds very little: in
`e2e/watermark.spec.ts`, the same 200 photos into 64 MB parts never had more
than 2 finished outputs waiting against a window of 6, and grew the page's
heap by 83 MB. In the Data section, a 10,000-record dataset edits a cell in
about 37 ms and scrolls at about 25 ms a frame, and a gallery of 2,000 photo
records scrolls at 33 ms a frame.

## State layer

The state layer writes with Immer, auto-freeze off, where a recipe costs no
more than the spreads it replaced. `bunx vitest bench --run src/tests/perf`,
in `apps/editor/`, measures it. These are the fastest samples; the first two columns ran the
old and new code in one process, and the last is the finished phase 4 on
its own:

| State layer | spreads | Immer | phase 4 |
|---|---|---|---|
| `withRecordStatus`, 10k records, all exported | 2.09 ms | 2.17 ms | 2.24 ms |
| `withRecordStatus`, 10k records, 100 failed | 0.36 ms | 0.38 ms | 0.38 ms |
| `withRecordStatus`, 10k records, no change | 0.27 ms | 0.26 ms | 0.27 ms |
| `commitDatasets`, 1,000 commits | 0.25 ms | 0.26 ms (kept as spreads: as a recipe, 4.2 ms) | 0.26 ms |
| `addField`, `updateField` and `resizeTemplate` | 0.001 ms | 0.04 ms | 0.03 ms |
| `renameField` | 0.14 ms | 1.0 ms | 0.96 ms |
| `translateLayers`-style drag, 90 frames (`doc/tree.ts`) | 0.009 ms | 3.1 ms (kept as spreads) | kept as spreads |

The template ops are slower in absolute terms and none is on a hot path.

### Where Immer is used

`src/state/immer.ts` is the only place Immer is configured, and every
recipe imports `produce` from it.

- Auto-freeze is off: freezing 10k-record datasets and the renderer's
  geometry Maps on each change costs more than it protects.
- Maps and Sets (`geometry`, `hidden`, `locked`) are assigned as new
  instances and never drafted, and a unit test fails if a recipe mutates
  one.
- An op checks its refusals before `produce`, and a recipe that changes
  nothing returns the base: a test asserts `next === base` for every op's
  no-op case, so the dirty check, history merging and the WeakMap caches
  keep working by identity.
- Recipes draft small objects only. With auto-freeze off, Immer walks every
  unfrozen object left in place until each touched draft is finalized, so
  drafting a workspace's presets walked every record (8 ms with 10k).
  `produceAt` edits one element of a list.
- **Where it is:** the workspace layer (`switchTo`, `restore`, the
  dataset undo and redo, `withRecordStatus`), the workspace cases of the
  reducer, the field, resize and variant ops in `doc/ops.ts`, and the
  binding helpers.
- **Where it stayed out:** `commitDatasets` and `patchBindings` keep their
  spreads (as recipes they measured 17 and 2.5 times slower);
  `withRecordStatus` still maps its records list (a 10k-record draft is ten
  times the `map`); and `doc/tree.ts`, the path-copy helpers on every drag
  frame, stays hand-written (300 times slower as recipes).

## Bundle

The router added 25.5 KiB gzipped to the initial JavaScript.
The barcode encoder, bwip-js, is
about 85 KB gzipped and is a chunk of its own, fetched only when a template
with a barcode opens or the Barcode tool is chosen.

## Running the benchmark

Open `/bench?sample=<id>&frames=<n>` in a running editor to time a bundled
sample: awaited edits, a drag of `n` frames at the display's rate, and
typing. From `apps/editor/`,
`bunx playwright test e2e/bench.spec.ts` with `FRESHCOAT_PREVIEW=1` runs the
benchmark against the production build. It records the numbers, and fails only
on gross regressions. In that mode the build is `vite build --mode e2e`, the
production build plus the e2e probes as modules of their own, so every spec
runs against it too.
