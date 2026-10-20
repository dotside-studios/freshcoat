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

```sh
npm install @freshcoat-js/workspace @freshcoat-js/coatfile @freshcoat-js/engine
```

## What is in it

| Module | What it does |
|---|---|
| `archive` | reads and writes `.coatworkspace`: the manifest, templates, datasets and assets in one zip |
| `columns` | the column types (text, number, date, color, URL, email, image, …), coercion and validation |
| `json-schema` | a dataset's schema as JSON Schema 2020-12, in and out |
| `tabular` | CSV, TSV, Excel, `.ods`, JSON and NDJSON in and out |
| `dataset` | editing a dataset the way Studio does: cells, records and columns, renames that keep bindings in step, retyping, schema import, search, sort and per-record issues |
| `mapping` | the import wizard's mapping of source columns to schema columns, and `importDefaults`: the sheet, header row, date order and mapping an import starts from |
| `binding` | which column, fixed value or pattern fills each field, and the variant each record gets |
| `view` | the records a binding reads: column filters and a join of a second dataset |
| `plan` | a preset and a workspace become a list of export items, with file names and sizes |
| `presets` | `newPreset` and `duplicatePreset`: a preset with Studio's defaults, under a name no other preset has |
| `export` | runs a preset: renders each item, writes a zip or a PDF and the export report |
| `impose` | cards on sheets of paper: paper sizes, printer's marks, duplex backs |
| `pdf` | PDF assembly with pdf-lib, one page per item or one sheet per page |
| `zip-stream` | the streaming zip writer and reader an export needs; zip64 past 4 GB or 65,535 entries |
| `assets` | photos as `ws:<sha256>` references, prepared once and stored once; `collectPhotoFiles` picks the images out of dropped files and zips |
| `image-info` | a photo's size and orientation read from its file header, without decoding it; re-exported from `@freshcoat-js/engine/image` |
| `ids` | the stable ids, keys and slugs the workspace is addressed by; `slug` is coatfile's `fieldKeyFrom` with `column` as the fallback |
| `node` | Bun and Node only: `readWorkspaceFile`, `fileOutput` and `folderOutput` for files on disk |

Most utilities are exported from `@freshcoat-js/workspace`. Dataset editing
lives at `@freshcoat-js/workspace/dataset`; its functions take a `Dataset`
and return a new one, so a script or `node` host edits a dataset as Studio
does. Tabular file I/O
lives at `@freshcoat-js/workspace/tabular`, and PDF assembly at
`@freshcoat-js/workspace/pdf`, keeping those dependencies off the main entry.
The `.coatworkspace` archive lives at `@freshcoat-js/workspace/archive`.
Image header reading lives at `@freshcoat-js/workspace/image-info` too, a
re-export of `@freshcoat-js/engine/image`, for hosts that need only that.
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
profiles/<sha256>.icc             ICC profiles PDF presets' output intents name
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

`unknownFileNameTokens()` lists the `{{tokens}}` of a file name pattern that
name no built-in, template field or dataset column; they export as empty text.
`presetReadiness()` (from `/export`) says whether a preset can run: its
template, the template's validation issues, the required fields no column
fills, how the plan lands on sheets, and the first thing that blocks the
export, with a short message and, for sheets, the whole reason.

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

A binding's `view` narrows and widens the records it reads, and is saved with
the binding. `join` adds a second dataset's columns to each record whose `on`
cell equals that dataset's `key` cell, compared as trimmed text, with
`prefix` put before each joined column's key; a joined column whose key the
bound dataset already has is left out. When several joined records hold a
key, the first is used. A record with an empty or unmatched cell keeps its
joined cells empty, or is dropped when the join is `inner`. `filters` then
keep the records every filter matches, so they can test joined columns:

| `op` | matches a cell that |
|---|---|
| `equals` | equals `value`: as a number, a date or yes and no for those column types, else as text ignoring case and surrounding space; with no value, is empty |
| `contains` | holds `value` as text, ignoring case; with no value, every cell |
| `empty` | is empty |
| `lt`, `lte`, `gt`, `gte` | is a number or date below or above `value`; empty cells never match |

`not` keeps the records a filter does not match. `boundDataset()` is the
dataset a binding reads through its view, with the bound dataset's id and the
records' own ids and statuses, so an export marks the records it read.
`planExport()`, `unfilledRequired()` and the export job read through it.
`bindingView()` also lists records with no match, keys more than one joined
record holds, and the problems that stop a view from applying, such as a
missing column or a value its column cannot compare; such a view keeps no
records, and `presetReadiness()` blocks its presets. `parseFilter()` and
`formatFilter()` read and write the CLI's `--where` text, such as
`points>=100`. A workspace with a view is written at format 1.2; a 1.1 reader
opens it without the view, with a warning.

```ts
import { boundDataset } from "@freshcoat-js/workspace";

const binding = {
  datasetId: "d_members",
  fields: { city: { kind: "column", column: "club_city" } },
  view: {
    filters: [{ column: "joined", op: "gte", value: "2024-01-01" }],
    join: { datasetId: "d_clubs", on: "club", key: "code", prefix: "club_" },
  },
};
const records = boundDataset(binding, workspace.datasets)?.records;
```

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
reports the families it found no bytes for as `result.fonts.missing`. Undeclared
families are not looked up on Google Fonts unless `fontOptions` sets
`guessGoogle: true`. It
renders one item at a time on the calling thread, or through `pool`, a
`JobPool` of the host's own, such as worker threads that each hold a
`createItemRenderer` and the fonts; `renderer` still checks glyphs then. The renderer is the host's, so its `load`
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
field left empty is not reported. An image that prints below the preset's
`minImageDpi` (default 300, 0 for no check) at its `dpi` is listed too, as
"Image prints at 200 DPI, under 300: photo".

A vector PDF page draws a layer it cannot express, such as one with a
shadow, grain or halftone, as an image. A layer that loses a spot ink by it
is warned in its item's `warnings`, naming the layer and the ink, as
"Spot colour Pink lost: the fill of pink is drawn as an image in the PDF
(shadow)", since the separation does not print. The others go in the item's
`rasterized`, and `result.rasterized` gathers them once per side, each layer
with every reason (`rasterizedSides` does it for a list of items). The
report ends with an `info` row per such side, as "Drawn as images in the
PDF: soft (shadow, grain); backdrop blur" (`describeRasterized`).

`runExportJob` is the layer below, for a host with its own pool: Studio
passes a pool of workers, each holding a `createItemRenderer` over its own
renderer, and an `OutputSink` such as `createStreamZipSink` over a writable
stream.

`createWorkerPool(size, factory)` is that pool. `factory` makes a worker:
anything with `postMessage`, `terminate`, `onmessage` and `onerror`, such as a
web `Worker` or an adapter over a Node `worker_threads` one. Each worker calls
`serveRenders(scope, createRenderer)` with its own scope and a function that
makes its renderer, with the CanvasKit and image loader of its platform.
`init(fonts)` hands every worker the fonts and waits for each, workers start
when first needed and a failed one is replaced, and a template is sent to a
worker only when it changes. Studio runs it over module workers and the CLI
over threads, and either pool can be passed to `exportWorkspace` as `pool`.
`exportPoolSize` picks how many workers from the cores, memory and
`largestImagePixels` of the job.

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

A `png-zip` preset with `pngAlpha: "keep"` writes every image as RGBA, even
an opaque card, for a consumer that requires a 32-bit PNG. The default,
`auto`, writes an opaque card as RGB.

For PDFs, `assemblePdf()` accepts rendered PNG or JPEG images, or one-page
PDFs. It can place one per page or impose cards on sheets with crop marks and
duplex backs. A preset's `pdfPageImage` picks what each page holds: a PNG or a
JPEG at the chosen density, or `vector`, which draws each card as PDF vectors
through the engine's [PDF output](../engine/README.md#pdf-output): text in its
embedded font, and any layer a PDF cannot express, such as a shadow, as an
image. A card printed with correction is rendered as a PNG. Each font file is
stored once in the assembled PDF, however many cards use it. A preset's
`pdfText: "outline"` draws the text of vector pages as the outlines of its
glyphs instead, so the PDF holds no font (see the engine's
[Text as outlines](../engine/README.md#text-as-outlines)); a sheet's slug,
when asked for, is still set in Helvetica. A gray or RGB
JPEG carrying an ICC profile, as the engine's JPEGs carry sRGB, is drawn in an
`ICCBased` space holding that profile, each distinct profile stored once.

Every assembled PDF declares an output intent, as the engine's
[Output intent](../engine/README.md#output-intent) describes: sRGB by default,
with each page's `/DefaultRGB` set to the same sRGB profile. `assemblePdf()`
takes `outputIntent`, the engine's `{ profile, identifier?, info?, registry? }`
for a press's profile such as FOGRA39, or `false` for none; an unusable profile
fails before anything is embedded. The profile streams that vector pages carry
are folded into one per distinct profile.

A preset's `outputIntent` is `{ kind: "srgb" }` (the default),
`{ kind: "none" }`, or `{ kind: "profile", sha256 }`, which names one of the
workspace's `profiles`. `readOutputProfile(bytes, name, identifier?)` checks a
file and gives the `IccProfileAsset` to keep there, and
`presetOutputIntent(workspace, preset)` turns a preset's choice into what
`assemblePdf()` takes, throwing `MissingProfileError` when the profile is not
in the workspace. An export job asks for it before it renders anything. A
profile is written to the archive once, under `profiles/<sha256>.icc`, however
many presets name it, and one no preset names is left out. A workspace with an
output intent is written at format 1.3; a 1.2 reader opens it without the
intents, with a warning.

A sheet layout's `copies` repeats each card that many times before the next
one, for step and repeat; `"fill"` repeats it once per slot, so each record
fills a sheet. `imposeSheets()` resolves it into the imposition's `copies`, and
`sheetSummary()` adds "· 10 copies each". Under duplex each copy's back sits
in the mirrored slot behind its own front. `assemblePdf()` embeds each image
once however many slots it fills.

A preset with `bleed: true` asks the host to render each card with its
template's bleed. Pass that bleed to `assemblePdf()` as `bleedMm`
(coatfile's `bleedMm(pixels, dpi)` converts it). On sheets, each card is placed by its
trim with the bleed outside the slot. The gap between cards is widened to
`minGapMm(bleed)`, twice the bleed, when the layout's is narrower, and crop
marks sit on the trim and start outside the bleed. One card per page, each
page gets a trim box inside its bleed box.

### Printer's marks

A sheet layout's `cropMarks` (on by default) draws crop marks on fronts.
Three more marks are off unless asked for, and each is drawn only where its
margin has room:

- `registrationMarks`: a 6 mm crosshair over a 2 mm circle, centred in each
  margin at least 8 mm deep, on fronts and backs. A target that would cross
  a crop mark moves along its edge until it clears it. A back's targets are
  its front's mirrored as the flip mirrors the sheet and moved by
  `backOffsetMm`, so held to the light they land on each other.
- `colorBar`: twelve 4 mm patches along the bottom margin, from the cards'
  left edge: black at 100, 75, 50, 25, 10 and 0 percent, then cyan, magenta,
  yellow, red, green and blue, in an outline.
- `slug`: one 6 pt Helvetica line along the top margin, such as "Members ·
  Sheet 2 of 5 · Back · 2026-10-13": the PDF's title, the sheet, the side
  under duplex, and the PDF's date. A slug wider than its room is cut with
  an ellipsis.

The colour bar and slug sit outside the crop marks and stop short of a
target. `sheetMarks(imposition, layout, side)` gives every mark of a page in
millimetres, as `assemblePdf()` draws them and Studio previews them, and
`slugText(imposition, page, { job, date })` the slug's words. Crop marks,
registration targets, the colour bar's outline and the slug are drawn in
registration colour, a `/Separation /All` space named `Registration` whose
alternate is RGB black, so they print on every plate. The colour bar's
patches keep their process colours.

### Slice pieces

A preset with `split: "pieces"` exports each slice of a side as its own file
instead of the whole side (see Slices in the
[coatfile README](../coatfile/README.md#slices)). For each record, variant and
side, `planExport()` resolves the slices with that record's values and variant
and plans one item per slice whose `output` is `piece`, in slice order, with
the slice's name as `piece` and its size in design units as `pieceSize`. A
slice a value hides, or a variant hides or moves, is planned accordingly. A
side with no pieces exports whole, as it does without `split`. Keys end in the
slice (`record:side:piece`, then the variant when every variant is exported).

The file name token `{{slice}}` is the slice's name, empty for a side exported
whole. A pattern that does not name it gets `-{{slice}}` appended, without a
dangling `-` for a whole side. A piece is rendered at its box plus the slice's
own bleed, at the preset's scale; it replaces the preset's `bleed`. With a size
from an image, a piece is scaled by the factor its side would be.

In a PDF, a single layout makes one page per piece, sized by its own pixels at
the preset's `dpi`. On sheets, every card is one size, so the pieces are
imposed when all the job's items share one size, taken as the card with no
bleed since it is baked in; otherwise the job is refused with a
`SheetLayoutError` ("Sheets need one piece size"). Pieces are raster only:
`pdfPageImage: "vector"` with pieces is refused.

### Cut files

A cutter needs the outline of what it cuts, not the picture. A slice with an
`edge` other than `none` is a cut line, and a preset can write those lines
with its images.

- `cutFile: "svg" | "dxf"` (default `none`), for the image zips: beside each
  image, a file of its cut lines with the image's base name, so
  `poster-1-front-left.png` gets `poster-1-front-left.svg` (the `@2x` of a
  scaled export stays in the name). An item with no cut line gets no file. A
  PDF ignores it.
- `cutLines: true` (default `false`), for a PDF: the lines are stroked over each
  page's art, 0.25 pt wide, in an optional content group named Cut that a
  viewer can switch off. On sheets each card's lines sit on its art, bleed
  and all, and are drawn on backs too. `assemblePdf()` draws the lines of any
  `PdfPage.cut`. Each kind is stroked in its own spot colour, a `/Separation`
  that overprints, as print-and-cut RIPs expect (see
  [Spot colours for cutters](#spot-colours-for-cutters)).
- `cutSpots` (PDF with `cutLines`): the spot colour name of each kind, as
  `{ through: "CutContour", kiss: "KissCut" }`. A kind left out, or named
  with only spaces, takes its default.

`itemCuts(template, item, { bleed, resize, pathOp })` works out the lines of
one item, in the item image's own design units with the origin at its top-left
corner:

- A whole side has a line for every shown slice with an edge, moved by the
  bleed when the image includes it.
- A piece has its own outline, if its edge is not none, with the slice box at
  the slice's own bleed, plus every `output: "none"` slice with an edge that
  lies wholly inside the piece's box (a fold line across a card, say). One that
  only crosses the box is left out, not clipped.

Author a fold, score or perforation as an open `vector` path with `output: "none"`
(see Slices in the [coatfile README](../coatfile/README.md#slices)): an open
subpath stays open in the SVG (no `Z`), the DXF (a polyline that is not
closed) and the PDF stroke, so the cutter runs along it once. A rect is always
closed, so a thin rect would be cut along both long edges.

Lines keep their kind and the slice's name. Slices are resolved with the
record's values and variant, so a slice a value hides has no line.

| Edge | SVG group, PDF stroke | PDF spot (default) | DXF layer (ACI colour) |
|---|---|---|---|
| `through` | `through`, red `#FF0000` | `CutContour` | `THROUGH` (1) |
| `kiss` | `kiss`, magenta `#FF00FF` | `KissCut` | `KISS` (6) |
| `score` | `score`, blue `#0000FF` | `Crease` | `SCORE` (5) |
| `perforate` | `perforate`, green `#00A000` | `Perfcut` | `PERFORATE` (3) |

`CUT_STYLES` holds the colours and layers, `DEFAULT_CUT_SPOTS` the spot
names, and `cutSpotNames(cutSpots)` the names a PDF uses. `cutSvg(cuts, dpi)` writes an SVG sized in
millimetres (design units / `dpi` x 25.4) with a viewBox in the item's design
units, so it lies exactly over the item's image; it has a group per kind
present and unfilled hairline paths, curves kept. `cutDxf(cuts, dpi)` writes
ASCII DXF R12 (`AC1009`) in millimetres (`$INSUNITS` 4, `$MEASUREMENT` 1), y up,
with a layer per kind present. Each line is a closed or open POLYLINE, the only
polygon R12 has: LWPOLYLINE arrived with R13, and R12 is what the oldest
importers still read. Curves are flattened to chords within 0.05 mm.

The job writes the sidecars as the images go into the zip, working the lines out
where it renders, so a live boolean on a vector is the shape it is rendered as.
The files share the image's size and origin, whatever its pixel density.

#### Cricut and Silhouette

- Cricut Design Space: upload the PNG piece for Print Then Cut, or the SVG for
  a cut-only job.
- Silhouette Studio Basic Edition: open the DXF for the cut lines and the PNG
  for the art. Basic reads DXF but not SVG.
- Silhouette Studio Designer Edition and above: open the SVG, or the PDF with
  its lines, and cut by line colour: red through, magenta kiss, blue score,
  green perforate.

To register the art and the lines, place both at the same top-left corner:
they share size and origin.

#### Spot colours for cutters

Print-and-cut RIPs such as Roland VersaWorks, Mimaki and Summa find the cut
path by its spot colour name, usually `CutContour`. In the PDF each kind of line is stroked in a `/Separation` colour space of its
spot name, tint 1, whose alternate is the kind's colour from the table in
`DeviceRGB`, so a viewer without the ink still shows red, magenta, blue or
green. An ExtGState with `/OP true /op true /OPM 1` makes the lines overprint:
the cut never knocks a hairline out of the art, and a RIP that prints the
separation does not leave a white line. The lines stay in the Cut optional
content group.

Most RIPs cut along `CutContour` by default. Names for the other kinds
differ from one RIP to the next, so set `cutSpots` to the names in your RIP's
cut settings.

In Acrobat, Output Preview lists each name under Separations, and Overprint
Preview shows the art beneath the lines.

Card-printer correction options use [`@freshcoat-js/for-print`](../for-print).
A preset's `print.target` names the for-print print target; absent reads as
`ymcko-dye-sub`, and an id this build does not know renders the item plain,
with the reason, through the print fallback.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
