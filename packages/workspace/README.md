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
| `impose` | cards on sheets of paper: paper sizes, crop marks, duplex backs |
| `pdf` | PDF assembly with pdf-lib, one page per item or one sheet per page |
| `zip-stream` | the streaming zip writer and reader an export needs |
| `assets` | photos as `ws:<sha256>` references, prepared once and stored once |
| `image-info` | a photo's size and orientation read from its file header, without decoding it |
| `ids` | the stable ids, keys and slugs the workspace is addressed by |

Most utilities are exported from `@freshcoat-js/workspace`. Tabular file I/O
lives at `@freshcoat-js/workspace/tabular`, and PDF assembly at
`@freshcoat-js/workspace/pdf`, keeping those dependencies off the main entry.

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
values, variants and file names. The host resolves output size from the preset,
renders those items through [`@freshcoat-js/coatfile`](../coatfile) and
[`@freshcoat-js/engine`](../engine),
writes the outputs and records successes or failures.

For PDFs, `assemblePdf()` accepts rendered PNG or JPEG images. It can place
one image per page or impose cards on sheets with crop marks and duplex
backs. The designs inside the PDF are raster images at the chosen density.

A preset with `bleed: true` asks the host to render each card with its
template's bleed. Pass that bleed to `assemblePdf()` as `bleedMm`
(`bleedMm(pixels, dpi)` converts it). On sheets, each card is placed by its
trim with the bleed outside the slot. The gap between cards is widened to
`minGapMm(bleed)`, twice the bleed, when the layout's is narrower, and crop
marks sit on the trim and start outside the bleed. One card per page, each
page gets a trim box inside its bleed box.
Card-printer correction options use [`@freshcoat-js/for-print`](../for-print).

## License

Apache-2.0; see the repository's [`LICENSE`](../../LICENSE) and
[`NOTICE`](../../NOTICE). Part of [Freshcoat](../../README.md).
