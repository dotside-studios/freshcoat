# @freshcoat-js/cli

The `freshcoat` command line for [Freshcoat](../../README.md): render a
template to images, once per spreadsheet row, or a workspace's export preset
to a zip or PDF, check a
template or workspace and list what it holds, and package a template, without
writing a script. It is built on
[`@freshcoat-js/coatfile`](../coatfile), [`@freshcoat-js/engine`](../engine)
and [`@freshcoat-js/workspace`](../workspace), and runs on Node.

```sh
npm install --global @freshcoat-js/cli
freshcoat --help
```

Results go to stdout; progress, warnings and errors go to stderr. Exit codes:
`0` done, `1` the work failed (an invalid template, a failed export item) and
`2` the command line was wrong. Ctrl-C (SIGINT) or SIGTERM cancels a running
export, removes a partly written `.zip` or `.pdf`, and exits `130` or `143`;
a second signal exits at once. `-q` or `--quiet` hides warnings and progress;
`--version` prints the version and `--help` works on the tool and on every
command. `render --help` leaves out `--png-alpha` and `--no-crop-marks`;
`render --help-all` lists them too. An option given twice with different
values, or options that undo each other, such as `--output-intent` with
`--no-output-intent` or `--no-crop-marks` with `--marks crop`, are refused
rather than letting the last one win; the repeatable options are `--set`,
`--frame`, `--scale`, `--cut-spot` and `--where`.

A template is read the way Studio opens it: duplicate element ids are renamed
rather than refused. `render`, `inspect`, `validate` and `pack` warn, naming the
file, about the ids renamed, a `format_version` newer than this freshcoat reads,
and assets whose key is not the hash of their bytes.

Fonts fetched from the network, such as Google Fonts, are kept in a cache for
30 days, so later runs work offline and start faster: `~/.cache/freshcoat` (or
`$XDG_CACHE_HOME/freshcoat`), `~/Library/Caches/freshcoat` on macOS and
`%LOCALAPPDATA%\freshcoat\Cache` on Windows. `FRESHCOAT_CACHE_DIR` moves it,
and `--no-cache` fetches them again without reading or writing it.

## Template modules

A template can also be a script: a `.ts`, `.mts`, `.cts`, `.js`, `.mjs` or
`.cjs` file whose default export, or `template` export, is a template object,
a promise of one, or a function that returns either.
[`defineTemplate`](../coatfile/README.md#template-modules) types it. Each command that reads
a template runs the script in a separate runtime, takes the JSON its export
resolves to and reads that as it would a template JSON file, so the result is
validated the same way and relative image paths resolve against the script's
directory.

```ts
// card.coat.ts
import { defineTemplate } from "@freshcoat-js/coatfile";

export default defineTemplate(async () => {
	const response = await fetch("https://example.com/badge.json");
	return { ...(await response.json()), name: `Badge ${new Date().getFullYear()}` };
});
```

```sh
freshcoat render card.coat.ts --set displayName="Alex" --out out
freshcoat pack card.coat.ts --out card.coat
```

The script runs in the runtime running freshcoat, or the `node`, `bun` or
`deno` command or path that `FRESHCOAT_RUNTIME` names, with the working
directory and environment of freshcoat. TypeScript needs a runtime that runs
it: Bun, Deno, or Node 22.18 or later. What the script prints goes to stderr.
A script runs with your permissions, so render only scripts you trust.

## Commands

### render

```sh
freshcoat render card.coat --set displayName="Alex" --out out
freshcoat render card.coat --values alex.json --variant amber --frame front
freshcoat render card.json --scale 1 --scale 2 --format webp --out out
freshcoat render card.coat --set photo=alex.jpg --out card.pdf
freshcoat render card.coat --data people.csv --out cards.zip
freshcoat render card.coat --data people.csv --name "{{member_id}}-{{side}}" --format jpeg --quality 85 --out cards
freshcoat render card.coat --data people.csv --sheets a4 --duplex long --bleed --out sheets.pdf
freshcoat render card.coat --set name=A --sheets a4 --copies fill --out cards.pdf
freshcoat render club.coatworkspace --preset "All cards" --out cards.zip
freshcoat render club.coatworkspace --preset "All cards" --where tier=gold --out gold.zip
```

Takes a template (a `.coat` file or template JSON), a `.coatworkspace`, or a
templates `.zip` that `pack` or Studio's Export all templates wrote.

#### Templates

Renders each frame and prints the path of every file it writes. Files are named
after the frame, with the scale as a suffix for anything but 1x: `front.png`,
`front@2x.png`. JPEG files use `.jpg`.

| Flag | |
|---|---|
| `--values <file>` | a JSON object of field values |
| `--set <key=value>` | one field value; repeat it, and it overrides `--values` |
| `--variant <id>` | render a variant of the template |
| `--frame <name>` | render only this frame; repeat it for several |
| `--scale <n>` | pixel density from 1 to 4, the range a preset's scale takes; default 1; repeat it for several |
| `--format <png\|jpeg\|webp>` | default `png` |
| `--png-alpha <auto\|keep>` | PNG only: `keep` writes RGBA even for an opaque frame, for a consumer that requires a 32-bit PNG; default `auto`, RGB when the frame is opaque |
| `--dpi <n>` | design units per inch, the print size that image resolution, print checks and PDF pages are measured at; default 300. For a PDF it sets the page or card size |
| `--out <path>` | directory to write to, created if needed, default the current one; or a `.zip` or `.pdf` file |

An `--out` ending in `.zip` or `.pdf` writes the frames as one zip, with an
`export-report.csv`, or one PDF, through the same export as `--data` below;
files in the zip are named after the frame, and `--scale` takes one value.

A templates `.zip` renders each template in it into a directory of `--out`
named after the template, `out/Badge/front.png`, with the flags above applied
to each. `--data`, the export options and a `.zip` or `.pdf` `--out` take one
template, so they are refused for it.

Values are checked against the template's fields, with their defaults filled
in. A photo given to an image field is read from the working directory with
`--set`, or from the values file's directory with `--values`. A font the
template declares loads from its source; any other family is looked up on
Google Fonts by name, and both cases are reported on stderr when a family is
guessed or no font data is found, as is text the fonts have no glyphs for.
Relative image paths in the template resolve against its directory, and
nothing outside it is read. An image field left empty is not reported.

Each image is checked for the resolution it prints at: its pixels over the
inches its layer covers at 300 design units to the inch (or `--dpi`), after
its crop and fit, on the axis with fewer. One under 300 is
reported, as `warning: front: Image prints at 200 DPI, under 300: photo`, and in
an export's `warnings` and `export-report.csv`. `--min-dpi <n>` sets the
threshold, and `--min-dpi 0` turns the check off. It applies to a workspace
preset too, over the preset's own `minImageDpi`.

Text and strokes get the print checks at the same DPI, with the record's
values: text below 6 pt (7 pt for a light face), strokes under 0.25 pt, and
text under 12 pt in a rich black, as `warning: front: Text is 4.8 pt at print
size, below 6 pt: fine_print`, and in an export's `warnings` and
`export-report.csv`. A QR code gets the checks `validate` makes, with its
values: colours under 3:1 contrast, modules lighter than their background, a
quiet zone under 2 modules, and a logo past the largest size drawn.

With `--pdf-pages vector`, a layer the PDF draws as an image (a shadow, a
blur, grain, a halftone, a gradient text stroke) and that carries a spot ink
is warned for each item, as `warning: front.png: Spot colour Pink lost: the
fill of pink is drawn as an image in the PDF (shadow)`, since the separation
does not print. The other layers drawn as images are listed once per side
after the export, as `front: Drawn as images in the PDF: soft (grain)`, and
as an `info` row per side in `export-report.csv`.

#### Spreadsheets

With `--data <file>`, the template renders once per row of a CSV, TSV, Excel,
`.ods`, JSON or NDJSON file, and `--out` names a `.zip` of images and an
`export-report.csv`, a `.pdf`, or a directory that gets the images and the
report. The header row names the fields, matched by
key or title ignoring case and punctuation; it is the first row with its first
three cells filled, as in Studio's import, and the rows above it are skipped.
Columns no field matches are reported and left out, and only the first sheet
with rows of a workbook is read. A photo
named in an image field's column is read from the data file's directory. Files
are named `<template id>-<row>-<frame>`, with the scale as a suffix for
anything but 1x, unless `--name` says otherwise.

A data file of any size is read. Past 128 MiB it warns, for example
`warning: people.csv is 300.0 MB, and reading it takes many times that in
memory, a workbook more than a CSV; if it runs out of memory, split the file`,
and goes on. Memory grows with cells: a 500,000 by 20 file peaks near 2 GB
while it is read, and a workbook takes two to three times a CSV's memory. A
workbook over 500 columns or 10,000 zip entries is refused. Under Node a text
file over about 512 MB is refused with a size limit message, as it is longer
than a JavaScript string can be.

`--where` keeps the rows that match, by field key, as for a workspace below.

`--set` and `--values` fill a field the same way in every row, over its
column. `--variant`, `--frame`, `--format` and `--png-alpha` work as above, the last two for
images only, and `--scale` takes one value. A required field no column or `--set`
fills is reported and uses its default. Progress and the summary are those of
a workspace export, below.

#### Export options

These shape a zip, PDF or directory written from a template, with or without
`--data`, as an export preset's settings do in Studio.

| Flag | |
|---|---|
| `--name <pattern>` | file names, such as `{{member_id}}-{{side}}`: any field, or `{{template}}`, `{{index}}`, `{{side}}`, `{{record}}`, `{{variant}}` and `{{slice}}`; default `{{template}}-{{index}}-{{side}}` with `--data` and `{{side}}` without |
| `--quality <n>` | JPEG and WebP quality, 0 to 100, default 90; for a PDF with `--pdf-pages jpeg` |
| `--bleed` | include the template's bleed around each card |
| `--size-from <field>` | size each file as the photo in this image field, after its EXIF orientation, as Studio's Match image does; in place of `--scale`, `--bleed` and `--sheets` |
| `--max-edge <px>` | with `--size-from`: cap each file's long edge at this many pixels, as Studio's Limit long edge does |
| `--pieces` | write each slice of a frame as its own file instead of the whole frame; see below |
| `--cut <svg\|dxf>` | images only: write the cut lines of each image beside it, as `<name>.svg` or `<name>.dxf`; see below |
| `--cut-lines` | PDF only: draw the cut lines over each page's art; see below |
| `--cut-spot <[kind=]name>` | PDF only: the spot colour a kind of cut line is drawn in, `through` when no kind is named; repeatable, implies `--cut-lines` |
| `--pdf-pages <png\|jpeg\|vector>` | PDF only: what each page holds, default `png` |
| `--pdf-text <embed\|outline>` | with `--pdf-pages vector`: `embed` sets text in its fonts, selectable; `outline` draws each glyph as a shape, so the PDF holds no font, as print shops that want outlined text ask. Default `embed`. See [Text as outlines](../engine/README.md#text-as-outlines) |
| `--sheets <paper>` | PDF only: lay the cards out at their trim size with crop marks on `a4`, `a5`, `a6`, `letter`, `legal`, `a3`, `tabloid` or `<width>x<height>` millimetre paper |
| `--orientation <auto\|portrait\|landscape>` | with `--sheets`: turn the paper this way; default `auto`, whichever fits more cards, portrait on a tie |
| `--duplex <long\|short>` | with `--sheets`: put each back behind its front, for a printer that flips on that edge |
| `--margin <mm>`, `--gap <mm>` | with `--sheets`: the paper's margin, default 10, and the space between cards, default 0 |
| `--copies <n\|fill>` | with `--sheets`: repeat each card `n` times before the next, or `fill` a sheet with each; default 1 |
| `--marks <list>` | with `--sheets`: the printer's marks, `none` or any of `crop`, `registration`, `colorbar` and `slug`, such as `crop,registration,slug`; default `crop`. See [Printer's marks](../workspace/README.md#printers-marks) |
| `--no-crop-marks` | with `--sheets`: leave out the crop marks, whatever `--marks` says; kept for older scripts, `--marks` without `crop` does the same |
| `--back-offset <x,y>` | with `--sheets` and `--duplex`: move every back page this many millimetres, for a printer that drifts; `y` is measured down the page, so `0.5,-1` moves the backs right and up. Each is from -50 to 50, as in Studio, and an offset that moves a back off the paper is refused with exit code 2, naming the range that keeps them on |
| `--blank-backs` | with `--sheets` and `--duplex`: give a one-sided template empty back pages, so every front lands on a front side |
| `--print-target <target>` | correct the cards for a printer, as an export preset's print target does in Studio: `none`, or a print target's id from [for-print](../for-print/README.md#print-targets), which `render --help` lists with its short name, such as `ymcko-dye-sub` (Card printer); default the `--print-profile`'s target, or `none` |
| `--print-profile <file>` | a measured printer profile, the JSON Studio's Export profile… writes from Measure printer or from a preset's Print profile; on its own it prints to the target it was measured on |
| `--no-analyze` | with a print target: apply the target's fixed correction to every photo instead of correcting each from its own analysis, as turning off Studio's Analyze photos does |
| `--output-intent <file>` | PDF only: declare this ICC profile, such as the print shop's FOGRA39 or GRACoL CMYK profile, as the PDF's output intent in place of sRGB. The cards stay RGB, tagged sRGB; the intent tells the printer what to convert them to |
| `--output-intent-id <name>` | with `--output-intent`: the condition's identifier, such as `FOGRA39`; default the profile's description |
| `--no-output-intent` | PDF only: declare no output intent and leave RGB untagged |

A flag that does not fit the output, such as `--pdf-pages` for a zip, `--quality`
for PNG or `--png-alpha` for JPEG, WebP or a PDF, is refused, as is `--bleed` for a template without one, a `--name`
token the template does not have, sheets the cards do not fit, and an
`--output-intent` file that is not a gray, RGB or CMYK printer or display
profile. Every PDF declares sRGB unless told otherwise; a workspace preset
carries its own output intent, set in Studio.

A PDF's title, and the job in its slug, is the template's name, or the
`--out` file's name without `.pdf` when the template has none; a workspace
preset's PDF takes the preset's name, as in Studio. Its creator and producer
name `Freshcoat CLI` and its version. While a PDF on sheets is assembled, the
progress counts cards, each embedded once, rather than pages.

A PDF is held in memory until it is built. Once an export has rendered 3 of
its items it estimates the whole PDF's size, and past 1 GiB, where Studio asks
first, it warns and goes on: `warning: this PDF is estimated at 3.4 GB, and it
is held in memory until it is built; if the export runs out of memory, split it
with --where`.

```sh
freshcoat render badge.coat --data crew.csv --sheets a4 \
  --output-intent PSOcoated_v3.icc --output-intent-id FOGRA51 --out print.pdf
```

```sh
freshcoat render card.coat --dpi 300 --pdf-pages vector --pdf-text outline --out card.pdf
```

`--print-target ymcko-dye-sub` runs each card through the card printer path of
[for-print](../for-print/README.md), as a preset with that print target does:
each photo is corrected from its own analysis, near-black and near-white snap to
the ribbon's black and white, and a `--print-profile` adds the cast its
measurement found. `--print-profile` on its own uses the target the profile
was measured on, and is refused when this build does not know that target;
with `--print-target` too, a profile measured on another target warns. A card
the path fails on is written uncorrected, and the report's `print` column says
`fallback`. On their own, the print options export into the `--out` directory,
the current one by default, with a report. The path corrects pixels, so with
`--pdf-pages vector` the pages are PNG and the command warns
`print target draws PDF pages as PNG, not vector`, as Studio's Checks do. A
template whose layers print in spot inks warns `spot ink White prints as plain
color` for any output but vector PDF pages.

```sh
freshcoat render member.coat --data members.csv --print-profile shop-printer.json --out cards
freshcoat render member.coat --data members.csv --sheets letter --duplex long \
  --back-offset 0.5,-1 --out duplex.pdf
```

`--pieces` splits a frame on the `slice` shapes of a template (see Slices in the
[coatfile README](../coatfile/README.md#slices)) into one file per piece, for
each row and variant: `front-left.png`, `front-right.png`. A frame with no
slices is written whole, and a template with none warns. The name gets
`-{{slice}}` appended unless `--name` uses `{{slice}}`, which is empty for a
whole frame. A piece is its slice's box plus the slice's own bleed, and it
replaces `--bleed`. On its own, `--pieces` exports into the `--out` directory,
the current one by default, with a report. A PDF has a page per piece, sized by
its pixels at `--dpi`; with `--sheets` the pieces are imposed as cards when all
the files share one size, and refused when they do not. `--pdf-pages vector` is
refused with `--pieces`, as pieces are raster only, and so is `--duplex`, as a
piece is not a side of a card. Each piece reports the warnings of the layers
inside its slice and its bleed, and those of no one layer, such as a font
that failed to load. `--pieces` also takes a workspace preset (below), over
the preset's own `split`, and is refused on one that prints duplex.

```sh
freshcoat render sticker.coat --pieces --out pieces
freshcoat render poster.coat --data editions.csv --pieces --name "{{edition}}_{{slice}}" --out posters.zip
```

`--cut` and `--cut-lines` write the cut lines of the slices that have an `edge`
(`through`, `kiss`, `score` or `perforate`), aligned with the art. With `--cut`,
each image of a zip or directory gets a file of the same base name: an SVG
sized in millimetres at its density, with a group per edge kind in red
(through), magenta (kiss), blue (score) and green (perforate), or an R12 DXF in
millimetres with a layer per kind. An image with no cut line gets no file, and
a template with no edge warns. A piece has its own outline and the lines of
`output: "none"` slices that lie wholly inside its box; one that only crosses it
is left out. With `--cut-lines`, a PDF draws the same lines as 0.25 pt strokes
over each page or card, in an optional content group named Cut. Each kind is
stroked in an overprinting spot colour, the `/Separation` a print-and-cut RIP
looks for: `CutContour` for through, `KissCut` for kiss, `Crease` for score
and `Perfcut` for perforate. `--cut-spot` renames one, as `--cut-spot Thru-cut`
for through cuts or `--cut-spot perforate=PerfCutContour`. The
[workspace README](../workspace/README.md#cut-files) has the details, and how
to open the files in Cricut Design Space and Silhouette Studio. `--cut` on
its own exports into the `--out` directory, the current one by default.

```sh
freshcoat render sticker.coat --pieces --cut svg --out pieces
freshcoat render sheet.coat --cut-lines --out sheet.pdf
freshcoat render sheet.coat --cut-spot CutContour --cut-spot kiss=KissCut --out sheet.pdf
```

#### Workspaces

Runs an export preset from a `.coatworkspace`, chosen with `--preset` by id or
by a name no other preset has, and writes the zip or PDF to `--out`, or into
`--out` as a directory when it does not end in `.zip` or `.pdf`; both flags
are required, the presets are listed when `--preset` is missing, and the
template flags are refused. Progress goes to stderr and a
one-line summary to stdout. The command also warns about text the fonts have no
glyphs for, and exits 1 when an item fails.

`--records all|pending|failed` exports those records in place of the preset's
choice, and `--save` writes each record's status back into the workspace, as
Studio does: `exported` with the time, or `failed` with the error. Together they
retry what failed:

```sh
freshcoat render club.coatworkspace --preset "All cards" --save --out cards.zip
freshcoat render club.coatworkspace --preset "All cards" --records failed --save --out retry.zip
```

`--pieces` exports the preset as one file per slice, as for a template above.
`--cut`, `--cut-lines` and `--cut-spot` set the preset's cut options, and are
refused on a preset of the other kind: `--cut` needs an image preset,
`--cut-lines` and `--cut-spot` a PDF one. `--cut-spot` renames only the kinds
it names, over the preset's own names.

`--where <filter>` exports only the records that match, over the records view
saved with the template's binding, if any; repeat it and every filter must
match. A filter is a column key, an operator and a value:

| Filter | Keeps records whose cell |
|---|---|
| `tier=gold` | equals `gold`: as a number, date or yes and no in those columns, else as text ignoring case |
| `tier=` | is empty |
| `name~ann` | contains `ann`, ignoring case |
| `points<10`, `points<=10`, `points>10`, `points>=10` | is a number or date below or above the value |
| `tier!=gold`, `tier!=`, `name!~ann`, `not points>10` | does not match |

Quote a filter with `<` or `>` so the shell does not read it as a redirect.
`--where` applies to this run only: `--save` writes the record statuses and
leaves the saved view alone. A filter on a missing column, or with a value its
column cannot compare, exits 1 before anything renders.

```sh
freshcoat render club.coatworkspace --preset "All cards" --records pending --where "joined>=2024-01-01" --out new.zip
```

#### Threads

An export from a template or a workspace renders on worker threads, each with
its own CanvasKit and the fonts, the way Studio's export uses web workers: as
many as the cores and memory allow, at most four and two when the photos are
over 24 megapixels, and one per eight items, since starting a thread costs more
than a few renders. `--jobs <n>` sets the number, and `--jobs 1` renders on the
main thread. The files are the same either way.

#### Dry runs

`--dry-run` lists what a render would write and writes nothing: a directory
render's paths, or an export's file names and a line such as `4 items would be
exported to cards.zip, 8 per sheet · 1 sheet`. Data, values and photos are still
read and checked, and sheets that cannot be laid out still fail. No font is
fetched and nothing is rendered, except for a PDF of more than 3 items: its
first 3 are rendered to give the same size warning the export would.

### validate

```sh
freshcoat validate card.coat
freshcoat validate club.coatworkspace --strict
freshcoat validate templates.zip
```

Prints `card.coat is valid`, or lists each issue on stderr and exits 1. It also
warns about what Studio's Issues list shows, without failing, each warning
ending in the code Studio gives it, such as `(safe_area)`, `(image_dpi)`,
`(small_text)` or `(format_low)`, to search the docs by:

- a variant change that names a layer its side does not have, or changes
  nothing;
- a top-level layer with an edge between the trim and the template's safe area,
  or for a `card_cr80` template with none, the printer's 3 mm;
- an image that prints below 300 DPI, such as a 600 px wide image placed 3 in
  wide, as `warning: front: "photo" prints at 200 DPI, under 300 (image_dpi)`.
  The layer is measured at `--dpi` design units per inch, the same print size
  `render --dpi` sets, default 300, and checked
  against `--min-dpi`, default 300, 0 for none. In a workspace each template
  takes its presets' lowest `dpi` and highest `minImageDpi` unless the flags
  say otherwise. Embedded images and images named by a path beside the file
  are checked; an image bound to a field is checked when it renders;
- a layer that may not print as it looks, at the same `--dpi`: text below 6 pt
  (7 pt for a light face), a stroke under 0.25 pt, text under 12 pt in a rich
  black, and with a bleed, art that runs to the trim but not into the bleed, as
  `warning: front: "fine_print": Text is 4.8 pt at print size, below 6 pt (small_text)`.
  Text bound to a field is checked again when it renders;
- a `format_version` newer than this freshcoat reads, or older than the fields
  the template uses.

A templates `.zip` from `pack` is checked template by template, each warning
naming the template, as `warning: Badge.coat: front: ...`.

A `.coatworkspace` is checked as a whole: each template as above, a binding to
a dataset the workspace does not have, a records view that cannot apply, a
preset whose template is missing or whose sheets the cards do not fit, and, as
warnings, required fields no column fills and keys more than one joined record
holds. `--strict` exits 1 on warnings too.

### inspect

```sh
freshcoat inspect card.coat
freshcoat inspect club.coatworkspace --json
```

Lists the frames and their sizes, the fields with their type, requirement and
default, the variants, and the font families the template uses, with whether it
declares each. `--json` prints the same as one object with `frames`, `fields`,
`variants` and `fonts` arrays.

For a `.coatworkspace` it lists each template with its size, frames, variants,
the dataset it is bound to, its records view (the join, the filters as
`--where` writes them and how many records they keep) and the required fields
no column fills; each
dataset with its records by status and its columns; and each preset with its
template, format, record filter, how many items it exports and, on sheets, how
they lay out or why they cannot. `--json` prints `templates`, `datasets` and
`presets` arrays, each template with its own inspection as above and, with a
view, a `view` object.

### pack

```sh
freshcoat pack card.json --out card.coat
freshcoat pack card.coat --out card.coat.json
freshcoat pack club.coatworkspace --out templates.zip
freshcoat pack club.coatworkspace --template Badge.coat --out badge.coat
```

Packages a template as Studio saves it: the `format_version` raised to the
lowest that covers the fields it uses, assets nothing uses left out, the result
validated (an invalid one is refused, listing its issues), and images
it names by a relative path read from its directory and embedded, so the
package renders anywhere. An image that cannot be read keeps its path, with a
warning. `--out` names a `.coat` or a `.coat.json`, which carries the assets
inline. From a `.coatworkspace`, `--template` packs one template, by file name
or id, and without it every template goes into a `.zip` of
`templates/<name>.coat`, the same zip as Studio's Export all templates, which
`render` and `validate` read.

## From code

`main(argv, io)` runs the same commands in-process and resolves to the exit
code, which is how the tests drive it. `io` supplies stdout, stderr, the
working directory and a `fetch` for fonts, so a test needs no network.

```ts
import { main } from "@freshcoat-js/cli";

const code = await main(["validate", "card.coat"]);
```

Only `src/main.ts` knows the argument parser, commander: it declares the
commands and their help and hands typed options to the commands in
`src/commands`, which take plain objects and an `io`. `planRender` decides
what `render` runs for a file and its options, and refuses options that do not
go together with a `UsageError`, which exits 2 and points at the command's
help. The value parsers in `src/args.ts` throw an `ArgumentError`. Each can be
tested without the command line.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
