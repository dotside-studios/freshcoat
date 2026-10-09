# Architecture

Freshcoat separates reusable formats and rendering from the applications that
author templates or manage production runs. The packages can be used without
Studio or Figma.

## Responsibilities

| Component | Owns | Does not own |
|---|---|---|
| [`coatfile`](packages/coatfile/) | Template schema, validation, compilation, `.coat` files and rendering helpers | Editor state or batch-job scheduling |
| [`engine`](packages/engine/) (`@freshcoat-js/engine`) | Scene layout and CanvasKit painting, geometry and render caches | Template fields, datasets or application UI |
| [`for-print`](packages/for-print/) | Image analysis, correction planning and measured card-printer profiles | General ICC color management or printer transport |
| [`workspace`](packages/workspace/) | Datasets, bindings, archives, export planning and execution, imposition and PDF assembly | Workers or platform file pickers |
| [`ui`](packages/ui/) | Shared React controls, themes and accessibility behavior | Template or workspace models |
| [`test-utils`](packages/test-utils/) | CanvasKit loading, vendored fonts and image headers for test suites | Anything shipped to users |
| [Studio](apps/editor/) | Interactive editing, history, browser persistence and export execution | A separate template format or renderer |
| [Figma plugin](apps/figma-plugin/) | Reading Figma designs, transpilation, diagnostics and handoff | Studio's controller or workspace UI |

## From authoring to output

Studio and the Figma plugin both produce coatfile templates. A host can also
construct or load a template directly:

```text
Studio / Figma / host application
              │ template + values
              ▼
           coatfile
              │ scene
              ▼
            engine
              │ layout + pixels
              ▼
        host preview or output
```

A host creates a renderer from the engine with a CanvasKit instance, and
coatfile's `renderTemplate` compiles and paints through it. The renderer reads
assets through a loader the host can replace, and does not assume browser
storage, a network policy or a UI framework. Loading CanvasKit and reading
files differ by platform, so they live on the engine's `node` and `browser`
subpaths.

For batch work, `workspace` turns templates, datasets, bindings and presets
into export plans, and `workspace/export` runs them through coatfile with a
renderer the host creates: `createItemRenderer` renders one item, and
`runExportJob` renders a whole preset through a pool and writes a zip or a
PDF. The pool and the destination are the host's. Studio runs items in a pool
of workers and writes to a folder or file it asks the user for; a script calls
`exportWorkspace`, which renders on its own thread, and can write to disk with
`fileOutput` from `workspace/node`. Both write a job's record statuses back
through the same `applyJobResult`, when the preset has `markExported`. Print
correction uses `for-print` when requested.

## Dependency boundaries

Internal dependencies are declared with Bun's `workspace:*` protocol.
The engine is the foundation; for-print depends on it; coatfile depends on
both. Workspace builds on coatfile, for-print and the engine. The UI package
has no dependency on the template or rendering model. Test suites share fixtures
through `test-utils`, which packages list only as a dev dependency.

Both applications consume the shared packages rather than each other's
source. Repository checks reject undeclared imports and paths that escape
the repository. Package-level imports keep runtime-specific integrations at
explicit entry points, such as the engine's node and browser subpaths.

## Files and identity

A `.coat` holds one template and can embed fonts and images. A
`.coatworkspace` holds templates, datasets, bindings, presets and assets.
A scene is the engine's rendering input, not another authoring file format.
The format and workspace READMEs describe their schemas and compatibility.

The UI term "layer" and the engine term "node" describe different levels of
the pipeline. Application copy conventions do not rename SDK types.

## Repository layout

- `apps/editor/`: Studio, its guides, screenshots and browser tests.
- `apps/figma-plugin/`: Figma exporter, its guide and local harness.
- `packages/`: reusable packages, each with its own API documentation.
- `docs/releases.md`: cross-project release process.
- `scripts/` and `.github/`: repository checks and release automation.
- `brand/` and `legal/`: project marks and third-party license material.

Root policies apply to the entire repository. The root `Dockerfile` and
`railway.toml` are Studio deployment entry points; they remain at the root
for the existing deployment configuration and use the repository as the
build context.

The [Studio architecture](apps/editor/ARCHITECTURE.md) covers its store,
controller, canvas, routing and workers. The [Figma guide](apps/figma-plugin/README.md)
covers its transpiler and export behavior. Package READMEs are the reference
for reusable APIs.

## Releases

The engine, for-print, coatfile and workspace are prepared for npm
publication. Generated manifests expose compiled ESM and declarations with
concrete dependency versions; checked-in manifests export source for workspace
development. UI remains internal. Figma is distributed as a plugin bundle,
and Studio is deployed separately. See [releases](docs/releases.md).
