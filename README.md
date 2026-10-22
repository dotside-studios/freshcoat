<h1>
  <img src="brand/freshcoat-logo.svg" alt="Freshcoat" height="56">
</h1>

<p><strong>Create designs that scale.</strong></p>

Freshcoat is an open-source design and rendering stack for creating cards,
badges, certificates, labels and watermarked photos from reusable templates.
A portable format describes each design, a Skia renderer turns it into pixels,
and print and workspace utilities help produce the output in batches.

Use the packages in your own application, render from a terminal with the
`freshcoat` command, create templates in Figma, or design and export in
Freshcoat Studio. The format and renderer also power
[Davi](https://davi.social)'s card production system.

## Why we're open sourcing it

Freshcoat grew out of our own production needs as a small team. We struggled
to find a design and rendering solution that fit our workflow, so we built one.
We're sharing it so others can build on it and adapt it to their own needs.
We want design files to be portable and the code that interprets them to be
understandable and open to change, without depending on proprietary formats.

We're not experts in graphics engines or compiler design, and most of the
work on Freshcoat has been AI-assisted. Our design decisions draw on working
knowledge of compilers, experience with Canvas2D rendering and the practical
demands of producing designs at scale. There is still plenty for us to learn.

We'd welcome help from people with deeper experience in these areas: finding
mistakes, questioning assumptions and improving the template format, renderer
and print workflows. If that sounds like your kind of work, see the
[contribution guide](CONTRIBUTING.md).

## Choose your starting point

| If you want to | Start with |
|---|---|
| Fill a template with data and render it | [`@freshcoat-js/coatfile`](packages/coatfile/) |
| Render your own 2D scene graph with CanvasKit | [`@freshcoat-js/engine`](packages/engine/) |
| Analyze images and plan corrections for card printers | [`@freshcoat-js/for-print`](packages/for-print/) |
| Bind datasets to templates and batch-export them to ZIPs or PDFs | [`@freshcoat-js/workspace`](packages/workspace/) |
| Render, validate and batch-export from a terminal or CI | [`@freshcoat-js/cli`](packages/cli/) |
| Design, preview and batch-export in a browser | [Freshcoat Studio](apps/editor/) |
| Turn Figma frames and field markers into templates | [Freshcoat for Figma](apps/figma-plugin/) ([Figma Community](https://www.figma.com/community/plugin/1685967766479998641)) |

## Quick start

The npm packages run on Node 22 or later and Bun 1.3.13 or later. On Node 22,
npm prints an `EBADENGINE` warning for `hucre`, the spreadsheet dependency,
which declares Node 24; spreadsheet import and export work on Node 22, so the
warning is safe to ignore.

From a terminal, install the command line and render a template. To try it
without a template of your own, download
[`minimal-card.json`](packages/coatfile/fixtures/minimal-card.json) and pack
it first:

```sh
npm install --global @freshcoat-js/cli
freshcoat pack minimal-card.json --out card.coat
freshcoat render card.coat --set displayName="Alex" --out out
freshcoat render card.coat --data people.csv --out cards.zip
```

The first `render` writes one image per side into `out`. The second renders the
template once per row of a spreadsheet and zips the results. See the
[CLI README](packages/cli/README.md) for every option.

From code, install the template package and the renderer:

```sh
npm install @freshcoat-js/coatfile @freshcoat-js/engine
```

```ts
import { readFile, writeFile } from "node:fs/promises";
import { loadTemplate } from "@freshcoat-js/coatfile";
import { renderTemplate } from "@freshcoat-js/coatfile/render";
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/node";

const loaded = await loadTemplate(await readFile("card.coat"));
if (!loaded.ok) throw new Error("Could not read card.coat");

const renderer = await createRenderer({ ck: await loadCanvasKit() });
const [front] = await renderTemplate(renderer, loaded.template, { displayName: "Alex" });
await writeFile("front.png", front.bytes);
```

Create the renderer once and reuse it. See the
[coatfile README](packages/coatfile/README.md) for variants, export sizes and
batch rendering.

## How the stack fits together

- **Templates:** layers, fields, fonts, sides and variants define a reusable
  design. Templates are described in JSON; a `.coat` archive can bundle their
  assets.
- **Scenes and rendering:** coatfile compiles a template and values into a
  scene. The engine lays out and paints that scene through CanvasKit, which
  brings Skia to WebAssembly. The host creates one renderer with
  `createRenderer`, giving it a CanvasKit instance and fonts, and keeps it for
  the life of the process or worker. The renderer owns text shaping, the paint
  cache and image decoding.
- **Production utilities:** print analysis and correction are separate from
  authoring. The workspace package adds datasets, bindings, export plans,
  PDF assembly and sheet imposition for applications that need batch output.
- **Command line:** the CLI puts coatfile, the engine and workspace behind one
  `freshcoat` command, so a script or CI job can render without any code.

The [UI](packages/ui/) and [test-utils](packages/test-utils/) packages are
internal packages and are not currently included in npm releases.
The workspace model is independent of React; the UI kit supplies Studio's
React controls and themes.

## Apps and tools

The [command line](packages/cli/) renders a template to images, once per
spreadsheet row, or runs a workspace's export preset to a zip or PDF. It also
validates and inspects templates and workspaces, and packs a template with its
images into one `.coat` file. A template can be JSON, a `.coat` file, or a
TypeScript or JavaScript module that builds one. See the
[CLI README](packages/cli/README.md) for commands and options.

[Studio](apps/editor/) combines template editing, typed datasets and worker-based
exports in a browser. Imported files and autosaved work stay in browser
storage; URL-referenced fonts and images can still be fetched from their hosts.
See the [Studio README](apps/editor/README.md) for features, screenshots,
limitations and development instructions.

[Freshcoat for Figma](apps/figma-plugin/) exports frames as `.coat` templates
with optional field bindings and can send them to Studio. Install it from the
[Figma Community listing](https://www.figma.com/community/plugin/1685967766479998641).
See the [plugin README](apps/figma-plugin/README.md) for layer naming, supported Figma
features and installation.

## Develop

Requires [Bun](https://bun.sh) 1.3.13 or later. From the repository root:

```sh
bun install
bun run test
bun run typecheck
```

Each app and package has its own README with development commands.
For example, `bun run --cwd apps/editor dev` starts Studio, while
`bun run --cwd apps/figma-plugin build` builds the plugin.
The root `dev` and `build` aliases target Studio for convenience.

To run the CLI from source, call its entry with Bun:

```sh
bun packages/cli/src/bin.ts render card.coat --out out
```

Release builds for the SDK packages and the command line include compiled ESM,
TypeScript declarations and assets. Their source manifests are private and
intended for workspace development; use the generated tarballs for publication.
See the [release guide](docs/releases.md) for npm setup, release checks and
Figma plugin bundles.

## Documentation

- [Architecture](ARCHITECTURE.md): package responsibilities and host boundaries.
- [Contributing](CONTRIBUTING.md): repository setup, checks and review conventions.
- [Upgrading from 0.4](docs/migrating-to-0.5.md): what changed in 0.5 and how to move over.
- [Upgrading from 0.3](docs/migrating-to-0.4.md): what changed in 0.4 and how to move over.
- [Releases](docs/releases.md): npm publication and Figma release bundles.
- [CLI](packages/cli/README.md), [Studio](apps/editor/README.md) and
  [Figma plugin](apps/figma-plugin/README.md): commands, behavior and guides
  for each tool.
- Each package README documents its API, runtime requirements and examples.

## License

Freshcoat is licensed under the [Apache License 2.0](LICENSE). Copyright 2026
Dotside Studios; see [NOTICE](NOTICE) and
[third-party notices](THIRD_PARTY_NOTICES.md).
The name and marks are not licensed; see [NAMES-AND-LOGOS.md](NAMES-AND-LOGOS.md).
