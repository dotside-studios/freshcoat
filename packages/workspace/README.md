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
| `dataset` | editing a dataset the way Studio does: cells, records and columns, renames that keep bindings in step, retyping, schema import, search, sort and per-record issues |
| `mapping` | the import wizard's mapping of source columns to schema columns |
| `binding` | which column, fixed value or pattern fills each field, and the variant each record gets |
| `plan` | a preset and a workspace become a list of export items, with file names and sizes |
| `presets` | `newPreset` and `duplicatePreset`: a preset with Studio's defaults, under a name no other preset has |
| `export` | runs a preset: renders each item, writes a zip or a PDF and the export report |
| `impose` | cards on sheets of paper: paper sizes, crop marks, duplex backs |
| `pdf` | PDF assembly with pdf-lib, one page per item or one sheet per page |
| `zip-stream` | the streaming zip writer and reader an export needs; zip64 past 4 GB or 65,535 entries |
| `assets` | photos as `ws:<sha256>` references, prepared once and stored once; `collectPhotoFiles` picks the images out of dropped files and zips |
| `image-info` | a photo's size and orientation read from its file header, without decoding it |
| `ids` | the stable ids, keys and slugs the workspace is addressed by; `slug` is coatfile's `fieldKeyFrom` with `column` as the fallback |
| `node` | Bun and Node only: `readWorkspaceFile`, `fileOutput` and `folderOutput` for files on disk |

Most utilities are exported from `@freshcoat-js/workspace`. Dataset editing
lives at `@freshcoat-js/workspace/dataset`; its functions take a `Dataset`
and return a new one, so a script or `node` host edits a dataset as Studio
does. Tabular file I/O
lives at `@freshcoat-js/workspace/tabular`, and PDF assembly at
`@freshcoat-js/workspace/pdf`, keeping those dependencies off the main entry.
The `.coatworkspace` archive lives at `@freshcoat-js/workspace/archive`.
Image header reading lives at `@freshcoat-js/workspace/image-info` too, which
imports nothing, for hosts that need only that.
Reading and writing files on disk differs by platform, so it lives at
`@freshcoat-js/workspace/node`, as CanvasKit loading does on the engine's
`node` subpath.

## Spreadsheets

`readTable()` reads `.xlsx`, `.xlsm`, `.xls` and `.ods`, and `writeTable()`
writes `.xlsx`, through [hucre](https://github.com/productdevbook/hucre),
loaded on first use. Workbook libraries sit behind the `WorkbookCodec`
interface in `src/workbook/`: `WORKBOOK_READERS` and `WORKBOOK_WRITERS` name
the codec for each extension, so a format can move to another library, or a
new library can add a format, without touching `tabular`. Codecs turn cells
into text with the shared `cellText()`, so every library reads dates, booleans
and numbers alike.

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
on its own again. Templates are read through coatfile's `loadTemplate`,
and written without the assets nothing in them references
(`pruneUnusedAssets`). Editor state that is not part of the design, such as a
template's ruler guides, stays in the manifest's template entry, so the
template format and its renders are unchanged.

## Where it sits

`planExport()` turns a workspace and preset into export items with resolved
values, variants and file names. `@freshcoat-js/workspace/export` runs them:
`runExportJob()` sizes each item from the preset, renders it through a pool,
and writes the outputs in plan order to a zip, or into one PDF, with a report
of what succeeded or failed. Rendering goes through
[`@freshcoat-js/coatfile`](../coatfile) and [`@freshcoat-js/engine`](../engine).

A binding fills each field from a column, a fixed value or a serial.
`autoBinding()` matches fields to columns by key, then by title, and
`unfilledRequired()` names the template's required fields that a binding
reading a dataset leaves without a source, or bound to a missing column. A
binding whose `datasetId` is `NO_DATASET` holds only a variant choice. Those
fields still render with their defaults, so an export is a warning rather
than a failure: every planned item lists them in `unfilled`, as does each
job result and the report's `unfilled` column.

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
import { fileOutput } from "@freshcoat-js/workspace/node";

// The full build carries the JPEG and WebP encoders.
const renderer = await createRenderer({ ck: await loadCanvasKit("full") });
const result = await exportWorkspace(workspace, preset, {
  renderer,
  output: fileOutput("club.zip"),
});
// result.items says how each item went, and which required fields it left
// to their defaults.
```

`exportWorkspace` takes a preset, its id or a name no other preset has
(`findPreset` does that lookup). Unless `fonts` is given, it resolves the
template's fonts with `resolveTemplateFonts`, passing it `fontOptions`, and
reports the families it found no bytes for as `result.fonts.missing`. It
renders one item at a time on the calling thread. The renderer is the host's, so its `load`
decides where image sources that are not dataset photos come from. Without
an `output`, the zip or PDF comes back as `result.file`. `fileOutput` writes
it to a path, the zip as it renders, and deletes the partial file when the
job is cancelled or fails.

When the preset has `markExported`, `result.workspace` is the workspace with
the job's record statuses written: `exported` with the time for records whose
every item rendered, `failed` with the first error for the rest. The workspace
passed in is not changed, and nothing is written for a cancelled job. Save
`result.workspace` with `packWorkspace` to keep them. `applyJobResult` does
the same for a dataset list, `recordOutcome` sorts a `JobResult` by record,
`retryPreset` gives the preset that reruns a job's failed records, and
`unwrittenRecordIds` lists the records a cancelled job left unwritten.

Each item in `result.items` says how it went, and `export-report.csv` in a
zip has a row per item with the same columns: `file`, `record`, `side`,
`status`, `error`, `print`, `gamut`, `unfilled` and `warnings`. A barcode
the encoder refuses fails its item, since a placeholder would print as if it
scanned. Other render warnings, such as an image or font that failed to
load, leave the item rendered and are listed in its `warnings`, described by
coatfile's `describeWarning` and joined with `; ` in the report. An image
field left empty is not reported.

`runExportJob` is the layer below, for a host with its own pool: Studio
passes a pool of workers, each holding a `createItemRenderer` over its own
renderer, and an `OutputSink` such as `createStreamZipSink` over a writable
stream. `exportPoolSize` picks how many workers from the
cores, memory and `largestImagePixels` of the job.

`itemRequest` builds the render request `runExportJob` sends for one item,
with the size `itemSize` gives it, and `imagesOf` lists the photos that item
references. `itemTemplate` returns the template laid out at the size
`itemSize` gives an item whose size follows a photo, with `maxEdge` applied,
so a preview shows what the export will render. Studio builds its export
preview and printer file from these.

### Export from Node

The same job runs in Bun or Node without a DOM, starting from a
`.coatworkspace` on disk. Dataset photos (`ws:<sha256>`) come from the
archive; other image sources, such as relative paths and `file:` URLs, go
through the renderer's `load`.

```ts
import { createRenderer } from "@freshcoat-js/engine";
import { fileLoader, loadCanvasKit } from "@freshcoat-js/engine/node";
import { exportWorkspace } from "@freshcoat-js/workspace/export";
import { fileOutput, readWorkspaceFile } from "@freshcoat-js/workspace/node";

const { workspace, warnings } = await readWorkspaceFile("club.coatworkspace");
const renderer = await createRenderer({
  ck: await loadCanvasKit("full"),
  load: fileLoader({ root: "." }),
});
const result = await exportWorkspace(workspace, "All cards", {
  renderer,
  output: fileOutput("club.zip"),
});
renderer.dispose();
// result.fonts.missing, result.items
```

`folderOutput(dir)` writes one file per item into a folder instead, with the
report beside them, and a PDF as one file in it. Like a folder in Studio, a
cancelled job keeps the files already written. Studio writes to a folder the
user picks through `createFolderSink` on `export`, which takes any
`FolderHandle`; `folderOutput` hands it one over `node:fs`.

A script can also start from a folder of photos and a template, making the
dataset and preset as Studio does:

```ts
import { openAsBlob } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  autoBinding,
  collectPhotoFiles,
  newPreset,
  photoDataset,
  prepareAssets,
  type Workspace,
} from "@freshcoat-js/workspace";
import { exportWorkspace } from "@freshcoat-js/workspace/export";
import { folderOutput } from "@freshcoat-js/workspace/node";

const picked = await Promise.all(
  (await readdir("photos", { recursive: true })).map(async (path) => ({
    file: new File([await openAsBlob(join("photos", path))], path),
    path,
  })),
);
// skipped names each hidden file, non-image and unreadable zip, and why
const { files, skipped } = await collectPhotoFiles(picked);
const dataset = photoDataset("Photos", await prepareAssets(files));
const workspace: Workspace = {
  formatVersion: "1.0",
  name: "Photos",
  templates: [
    {
      id: "t_card",
      fileName: "card.coat",
      template,
      binding: autoBinding(template, dataset),
    },
  ],
  datasets: [dataset],
  presets: [],
};
const preset = { ...newPreset("t_card", []), format: "jpeg-zip" as const };
await exportWorkspace(workspace, preset, {
  renderer,
  output: folderOutput("out"),
});
```

`readWorkspaceFile` reads the archive without loading it into memory first
and throws a `WorkspaceReadError`, whose `code` is `unpackWorkspace`'s, when
it cannot. `readWorkspace` on `archive` does the same for a Blob or bytes.
Pass `fontOptions: { fetch }` to serve fonts from a cache or a mirror instead
of the network.

Pass `checkGlyphs: true` to also get `result.glyphs`: each item's text that
the template's fonts have no glyphs for, by record, side and element, so a CLI
can warn before the cards print with boxes. `checkGlyphs` and
`checkAllGlyphs` run the same check on given items with a renderer that holds
the fonts, and `summarizeGlyphs` and `codepointLabel` shape it for display.

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

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
