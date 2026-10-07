# Contributing to Freshcoat

Freshcoat includes SDK packages, a Figma plugin and a browser editor.
Choose the component you want to change before following an application-specific
workflow. The [architecture](ARCHITECTURE.md) maps their responsibilities.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
Report security issues privately using [SECURITY.md](SECURITY.md).

## Setup

Install [Bun](https://bun.sh) 1.3.13 or later and run this from the repository root:

```sh
bun install --frozen-lockfile
```

Most source tests run with Bun or Vitest. Browser tests additionally need
Playwright Chromium. Release packing and consumer checks need Node 24 and npm;
the Figma bundle command also uses `zip`.

| Area | Guide |
|---|---|
| Template format, compilation and archives | [coatfile](packages/coatfile/README.md) |
| Scene layout and CanvasKit painting | [engine](packages/engine/README.md) |
| Loading CanvasKit per platform | [canvaskit](packages/canvaskit/README.md) |
| Print analysis and correction | [for-print](packages/for-print/README.md) |
| Dataset and export planning | [workspace](packages/workspace/README.md) |
| Shared React controls and themes | [UI kit](packages/ui/README.md#contributing) |
| CanvasKit and font fixtures for tests | [test-utils](packages/test-utils/README.md) |
| Browser editor | [Studio contribution guide](apps/editor/CONTRIBUTING.md) |
| Figma exporter and harness | [Figma plugin](apps/figma-plugin/README.md) |

## Repository checks

Run these commands from the repository root:

| Command | What it does |
|---|---|
| `bun run test` | Runs the workspace packages' unit tests |
| `bun run typecheck` | Runs packages that define a type-check script |
| `bun run test:scripts` | Tests repository tooling and documentation links |
| `bun run check:boundaries` | Checks declared dependencies and repository boundaries |
| `bun run check:links` | Checks relative Markdown links and heading anchors |
| `bun run check:notices` | Verifies third-party notices against installed dependencies |
| `bun run release:pack` | Compiles and packs the four SDK packages |
| `bun run release:check` | Checks those tarballs in an isolated npm consumer |

Not every package defines every script. Inspect its `package.json` or README
and use `bun run --cwd <directory> <script>` for focused checks. UI, workspace,
Studio and the Figma plugin define Biome `check` scripts. The core SDKs use
Bun tests; release compilation and consumer checks also verify their declarations.

The root `dev` and `build` scripts target Studio. They are convenience aliases,
not prerequisites for SDK or plugin development.

## Tests and compatibility

Add tests next to the behavior you change. SDK changes should test public
inputs and outputs, including refusals and malformed files. A change to a
shared package may affect either application; run the relevant consumer tests
as well as the package's own suite.
Load CanvasKit and test fonts through [test-utils](packages/test-utils/)
instead of resolving `canvaskit-wasm` or font files by path.

For SDK exports, dependencies or runtime behavior, also run
`release:pack` and `release:check`. Source imports can pass while compiled
Node imports fail, so test the distributable rather than assuming the
workspace is an equivalent consumer.

Run application browser tests for interaction changes. Studio's smoke suite
is part of CI; the plugin has a separate local Figma harness. Their guides
cover browser installation and manual checks.

Preserve readable legacy file formats unless a compatibility change is
intentional and documented. A new format feature belongs in its package,
not in an application-specific copy of the model.

## Cache and performance checks

### Paint cache fuzz test

[`paint-cache-fuzz.test.ts`](packages/engine/tests/paint-cache-fuzz.test.ts)
paints seeded sequences of random scenes through one `PaintCache` and checks
that each paint's pixels and warnings match a fresh uncached paint byte for
byte. It runs in `bun run test` with a short fixed set of seeds. For a longer
run, raise the iteration count:

```sh
cd packages/engine
FUZZ_ITERATIONS=500 bun test tests/paint-cache-fuzz.test.ts
```

A failure names its seed and the command that replays it, for example
`FUZZ_SEED=42 FUZZ_ITERATIONS=1`. Treat it as a cache bug, not a flaky
test: fix the cache, then add a focused regression test to
`paint-cache.test.ts`. Do not change the seeds or the generator to get a
green run.

### Render benchmark

[`bench-render.ts`](apps/editor/scripts/bench-render.ts) times `compileScene`
on the membership card and on its front repeated 12 times, and
`renderCompiled` per record for both sides with print off and on. It uses the
full CanvasKit build on software surfaces. Each time is divided by a
calibration loop's, and a case fails when that ratio is more than 30% above
its baseline in
[`bench-render.baseline.json`](apps/editor/scripts/bench-render.baseline.json).
A case over the limit is measured twice more before it fails.

```sh
bun run --cwd apps/editor bench:render
```

CI runs it in the `bench` job, which reports the numbers in the job summary
and uploads them as the `bench-render` artifact. The job does not block
merging yet. Once its results are steady across runs, remove its
`continue-on-error` in [`ci.yml`](.github/workflows/ci.yml).

Update the baselines when a change makes rendering faster, when a slowdown is
intended, or when a case is added or renamed. Run this on a quiet machine
and commit the new file, with the reason in the commit message:

```sh
bun run --cwd apps/editor bench:render --update
```

The update takes the median of three rounds per case. The `bench-render`
artifact from a CI run uses the same format, so you can copy it over the
baseline to match the hosted runners.

## Code and documentation

- Use strict TypeScript and the package's existing formatting conventions.
  Biome uses tabs, double quotes and organized imports where configured.
- Keep imports within declared package dependencies. Put reusable model or
  rendering behavior in the owning package; keep host storage, scheduling
  and interaction code in the application.
- Comments explain behavior and the reason for a constraint. Avoid narrating
  change history or repeating the code.
- Do not add license headers to source files; LICENSE and NOTICE cover them.
- Keep prose plain and use sentence case. Application labels follow their
  own copy guide; do not impose Studio vocabulary on SDK APIs.
- Keep detailed guides and examples beside the component they describe.
  Root documents cover the project and link to those guides.

For a new dependency, explain why it is needed and check its license.
Regenerate repository notices with:

```sh
bun scripts/third-party-notices.ts
bun run check:notices
```

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org), with one focused
change per commit. Use a scope that identifies the component: `canvaskit`,
`engine`, `coatfile`, `for-print`, `workspace`, `ui`, `test-utils`, `editor`,
`figma-plugin` or `release`. Repository-wide documentation can use `docs: ...`.

Before opening a pull request:

- Run the tests, type checks and lint scripts that the changed packages define.
- Run repository link, boundary and notice checks.
- Add tests for new behavior and compatibility-sensitive changes.
- For UI changes, run relevant browser specs and include screenshots in both themes.
- For SDK changes, verify release artifacts when exports or runtime behavior changed.
- Update the owning package or app's documentation and any cross-project overview affected.
- Explain new dependencies and regenerate notices when needed.
- Keep commits focused and state how the change was verified.

## Releases

Versioning, tarballs, npm trusted publishing and Figma bundles are documented
in the [release guide](docs/releases.md). Do not publish source workspace
directories or change external release settings as part of an unrelated patch.

By contributing, you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), as section 5 of the license provides.
