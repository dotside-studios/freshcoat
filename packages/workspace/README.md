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
Each item renders at its variant's size; sheets need every card in a plan to
share one size.

```ts
import { loadCanvasKit } from "@freshcoat-js/engine/node";
import {
  createItemRenderer,
  inlinePool,
  runExportJob,
} from "@freshcoat-js/workspace/export";

// The full build carries the JPEG and WebP encoders.
const items = createItemRenderer({
  ck: await loadCanvasKit("full"),
  fonts: new Map([["Inter", [interBytes]]]),
});
const result = await runExportJob(workspace, preset, {
  pool: inlinePool(items),
});
// result.file is the zip or PDF; result.items says how each item went.
```

The pool is the host's: `inlinePool` renders one item at a time on the
calling thread, and Studio passes a pool of workers, each holding its own
`createItemRenderer`. So is the destination: the default keeps the zip in
memory, and a host can pass any `OutputSink`, such as `createStreamZipSink`
over a writable stream.

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
