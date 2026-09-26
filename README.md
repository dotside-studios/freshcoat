<h1>
  <img src="brand/freshcoat-logo.svg" alt="Freshcoat" height="56">
</h1>

<p><strong>Create designs that scale.</strong></p>

Freshcoat is an open-source design and rendering stack for work that repeats:
cards, badges, certificates, labels and watermarked photos. Design once, fill
it from your data, and export one file per record, side or variant.

It brings together a portable template format, a Skia renderer and
Freshcoat Studio, a browser editor for the whole workflow. The format and
renderer power [Davi](https://davi.social)'s card production system; the same
packages can be used independently in your own applications.

Studio runs in your browser without an account or a rendering server.
Imported files and autosaved work stay in browser storage, and exports run
in workers. Fonts and images referenced by URL may still be fetched from
their hosts.

![The Edit section with a membership card open and its name layer selected](docs/images/editor.png)

## From one design to a production run

A membership card is more than a name placed on a background. Names wrap,
photos need cropping, tiers have different colors, and fronts must line up
with backs on a printed sheet. Those choices need to hold across hundreds
of records without turning each card into a separate design file.

Freshcoat keeps the design, data and output settings together:

- **Templates describe the design.** Layers, text, gradients, masks and
  constraints define its appearance. Fields define what changes between
  records; variants define versions such as colorways or badge roles. The
  schema defines the JSON document, and a `.coat` file packages it with
  embedded assets. Fonts and images can be embedded or referenced by URL.
- **One renderer handles preview and export.** CanvasKit (Skia compiled to
  WASM) supplies text measurement and painting in the browser and on
  servers. Export density can change without changing the layout. Upright
  barcode modules snap to whole output pixels.
- **Workspaces describe the run.** Templates, datasets, field bindings and
  export presets travel in one `.coatworkspace` file. Export images
  individually or assemble them into PDFs, including sheets with crop marks
  and duplex backs. Optional correction for dye-sublimation card printers
  uses profiles measured from printed charts.

## What it makes

- **Cards and badges** — CR80 membership cards; event badges with ticket
  barcodes; colorways, roles and tiers as variants; arranged on sheets with
  crop marks.
- **Certificates, labels, anything named and numbered** — from a spreadsheet,
  as images or PDFs, one page per record.
- **Watermarked photos** — a mark on a few hundred camera photos, each
  exported at its own size and named after its file, with a bounded queue of
  renders and finished outputs.
- **Batch exports** — every selected record, side and variant,
  written to a zip or a folder as it goes, with a report of what failed.

Preview real records while designing, then choose the dimensions, density
and file format for the run.

## How it comes together

- **The studio** ([apps/editor](apps/editor/)) — a browser editor with
  layers, snapping, an inspector, and a canvas that previews real records
  while you design. **Data** holds your
  records and photos; **Export** holds the presets, the progress and the
  report.
- **The format** ([packages/coatfile](packages/coatfile/)) — `.coat`
  templates, their schema, and the compiler that turns a design plus values
  into a scene.
- **The engine** ([packages/engine](packages/engine/)) — the coat engine: a
  2D scene graph painted with CanvasKit (Skia compiled to WASM), fast enough
  to repaint as you drag.
- **The print path** ([packages/for-print](packages/for-print/)) — analysis
  and correction for CR80 dye-sublimation card printers, with profiles a card
  shop measures from a print chart.
- **The workspace** ([packages/workspace](packages/workspace/)) — datasets,
  bindings, export planning and imposition, and the `.coatworkspace` file that
  carries the lot.
- **The interface kit** ([packages/ui](packages/ui/)) — Studio's React
  controls, panels and themes.
- **Figma in** ([apps/figma-plugin](apps/figma-plugin/)) — name a layer
  `{{field}}`, and export a template with its bindings, or hand it straight to
  the studio.

For an application that renders templates, start with `@freshcoat/coatfile`.
For a renderer built around your own scene model, start with `freshcoat`, the
engine package. Add `@freshcoat/workspace` for datasets and export planning,
or `@freshcoat/for-print` for card-printer correction.

The packages currently live in this repository and are marked private; they
are not yet published to npm. The format, engine and print packages each
have their own LICENSE and NOTICE.

## Develop

Requires [Bun](https://bun.sh) 1.3.13 or later.

```sh
bun install
bun run dev
```

The editor opens at <http://localhost:3010>. `bun run test` and
`bun run typecheck` run every package's checks. [CONTRIBUTING.md](CONTRIBUTING.md)
has the full list of scripts and what a pull request needs.

## Documentation

- [docs/features.md](docs/features.md) — what the studio does, in detail
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the workspace is built
- [docs/performance.md](docs/performance.md) — the measurements behind the
  render pipeline and the libraries

## License

Freshcoat is licensed under the [Apache License 2.0](LICENSE). Copyright 2026
Dotside Studios; see [NOTICE](NOTICE). The name and marks are not licensed;
see [NAMES-AND-LOGOS.md](NAMES-AND-LOGOS.md).
