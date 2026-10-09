# @freshcoat-js/workspace

The data model, archive format and export planning utilities for
[Freshcoat](../../README.md). A workspace combines templates with datasets,
field bindings and export presets; a `.coatworkspace` file stores them and
their assets in one zip.

Use this package when your application needs to organize records and photos,
bind them to templates, plan a batch export or assemble rendered images into
PDFs. Freshcoat Studio uses it for its Data and Export sections.

The model and planning code are independent of React and the DOM and can run
in a browser, Bun or Node. The host application supplies rendering, job
scheduling and file destinations.

## What is in it

| Module | What it does |
|---|---|
| `archive` | reads and writes `.coatworkspace`: the manifest, templates, datasets and assets in one zip |
| `columns` | the column types (text, number, date, color, URL, email, image, …), coercion and validation |
| `json-schema` | a dataset's schema as JSON Schema 2020-12, in and out |
| `tabular` | CSV, TSV, Excel, `.ods`, JSON and NDJSON in and out |
| `mapping` | the import wizard's mapping of source columns to schema columns |
| `binding` | which column, fixed value or pattern fills each field, and the variant each record gets |
| `plan` | a preset and a workspace become a list of export items, with file names and sizes |
| `export` | runs a preset: renders each item, writes a zip or a PDF and the export report |
| `impose` | cards on sheets of paper: paper sizes, crop marks, duplex backs |
| `pdf` | PDF assembly with pdf-lib, one page per item or one sheet per page |
| `zip-stream` | the streaming zip writer and reader an export needs; zip64 past 4 GB or 65,535 entries |
| `assets` | photos as `ws:<sha256>` references, prepared once and stored once |
| `image-info` | a photo's size and orientation read from its file header, without decoding it |
| `ids` | the stable ids, keys and slugs the workspace is addressed by |

Most utilities are exported from `@freshcoat-js/workspace`. Tabular file I/O
lives at `@freshcoat-js/workspace/tabular`, and PDF assembly at
`@freshcoat-js/workspace/pdf`, keeping those dependencies off the main entry.
The `.coatworkspace` archive lives at `@freshcoat-js/workspace/archive`.

## The shape of a workspace

A `.coatworkspace` is a zip, so a workspace is one file and its images travel
with it:

```text
mimetype                          application/vnd.freshcoat.workspace+zip, stored, first
workspace.json                    name, template entries, bindings and guides, presets
templates/<id>.coat               each template, in coatfile's own format
data/<id>/schema.json             the dataset's columns as JSON Schema
data/<id>/records.json            its records and their export status
data/<id>/assets/<sha256>.<ext>   photos, referenced from records as ws:<sha256>
```

Templates inside are ordinary `.coat` files: a template opened on its own
becomes a one-template workspace, and a workspace's template can be exported
on its own again. Editor state that is not part of the design, such as a
template's ruler guides, stays in the manifest's template entry, so the
template format and its renders are unchanged.

## Where it sits

`planExport()` turns a workspace and preset into export items with resolved
values, variants and file names. `@freshcoat-js/workspace/export` runs them:
`runExportJob()` sizes each item from the preset, renders it through a pool,
and writes the outputs in plan order to a zip, or into one PDF, with a report
of what succeeded or failed. Rendering goes through
[`@freshcoat-js/coatfile`](../coatfile) and [`@freshcoat-js/engine`](../engine).

A binding's `variant` picks the variant each record renders in: a fixed one,
the one a column names, every one, or `{ kind: "image", field }`, the one
whose size is closest in aspect to the record's photo, so a template with
landscape, portrait and square variants follows each photo's orientation.
A column source's `fallback`, a fixed or image source, is what a record
whose cell names no variant gets. A workspace that uses one is written at
format 1.1, which a 1.0 reader opens without the fallback.

A text column's `options` names where its cells pick their value from, kept
in `schema.json` as `x-freshcoat-options`. `{ kind: "variants", templateId }`
is the variants of one of the workspace's templates.
Each item renders at its variant's size; sheets need every card in a plan to
share one size.

```ts
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/node";
import { exportWorkspace } from "@freshcoat-js/workspace/export";
import { fileOutput } from "@freshcoat-js/workspace/export/node";

// The full build carries the JPEG and WebP encoders.
const renderer = await createRenderer({ ck: await loadCanvasKit("full") });
const result = await exportWorkspace(workspace, preset, {
  renderer,
  output: fileOutput("club.zip"),
});
// result.items says how each item went.
```

`exportWorkspace` takes a preset or its id, resolves the template's fonts
with `resolveTemplateFonts` unless `fonts` is given, and renders one item at
a time on the calling thread. The renderer is the host's, so its `load`
decides where image sources that are not dataset photos come from. Without
an `output`, the zip or PDF comes back as `result.file`. `fileOutput` writes
it to a path, the zip as it renders, and deletes the partial file when the
job is cancelled or fails.

`runExportJob` is the layer below, for a host with its own pool: Studio
passes a pool of workers, each holding a `createItemRenderer` over its own
renderer, and an `OutputSink` such as `createStreamZipSink` over a writable
stream.

### Export from Node

The same job runs in Bun or Node without a DOM. The host does what Studio's
workers do: it resolves the template's fonts, registers the barcode encoder,
and gives the renderer a loader for image sources that are file paths.
Dataset photos (`ws:<sha256>`) come from the archive and need no loader.

```ts
import { createWriteStream, openAsBlob } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { resolveTemplateFonts, setBarcodeEncoder } from "@freshcoat-js/coatfile";
import { bwipBarcodeEncoder } from "@freshcoat-js/coatfile/barcode";
import { fileLoader, loadCanvasKit } from "@freshcoat-js/engine/node";
import { unpackWorkspace } from "@freshcoat-js/workspace/archive";
import {
  createItemRenderer,
  createStreamZipSink,
  inlinePool,
  runExportJob,
} from "@freshcoat-js/workspace/export";

const unpacked = await unpackWorkspace(await openAsBlob("club.coatworkspace"));
if (!unpacked.ok) throw new Error(unpacked.message);
const { workspace } = unpacked;
const preset = workspace.presets[0];
const entry = workspace.templates.find((t) => t.id === preset.templateId);

// Pass `fetch` to serve fonts from a cache or a mirror instead of the network.
const { fonts, missing } = await resolveTemplateFonts(entry.template);
setBarcodeEncoder(bwipBarcodeEncoder);

const items = createItemRenderer({
  ck: await loadCanvasKit("full"),
  fonts,
  // relative paths and file: URLs in the template, read under this directory
  load: fileLoader({ root: "." }),
});

const out = preset.format === "pdf" ? "club.pdf" : "club.zip";
const result = await runExportJob(workspace, preset, {
  pool: inlinePool(items),
  sink:
    preset.format === "pdf"
      ? undefined
      : createStreamZipSink(Writable.toWeb(createWriteStream(out))),
});
items.dispose();

// A PDF is assembled in memory and comes back as `file`.
if (result.file) await writeFile(out, await result.file.blob.bytes());
// A cancelled zip leaves a partial file behind.
if (result.cancelled) await unlink(out).catch(() => {});
```

`src/export/node-export.test.ts` runs this path end to end.

For PDFs, `assemblePdf()` accepts rendered PNG or JPEG images. It can place
one image per page or impose cards on sheets with crop marks and duplex
backs. The designs inside the PDF are raster images at the chosen density.

A preset with `bleed: true` asks the host to render each card with its
template's bleed. Pass that bleed to `assemblePdf()` as `bleedMm`
(coatfile's `bleedMm(pixels, dpi)` converts it). On sheets, each card is placed by its
trim with the bleed outside the slot. The gap between cards is widened to
`minGapMm(bleed)`, twice the bleed, when the layout's is narrower, and crop
marks sit on the trim and start outside the bleed. One card per page, each
page gets a trim box inside its bleed box.
Card-printer correction options use [`@freshcoat-js/for-print`](../for-print).

## License

Apache-2.0; see the repository's [`LICENSE`](../../LICENSE) and
[`NOTICE`](../../NOTICE). Part of [Freshcoat](../../README.md).
