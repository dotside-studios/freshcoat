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
`2` the command line was wrong. `-q` or `--quiet` hides warnings and progress;
`--version` prints the version and `--help` works on the tool and on every
command.

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
import { defineTemplate } from "@freshcoat-js/coatfile/define";

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
freshcoat render club.coatworkspace --preset "All cards" --out cards.zip
```

Takes a template (a `.coat` file or template JSON) or a `.coatworkspace`.

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
| `--scale <n>` | pixel density, default 1; repeat it for several |
| `--format <png\|jpeg\|webp>` | default `png` |
| `--out <path>` | directory to write to, created if needed, default the current one; or a `.zip` or `.pdf` file |

An `--out` ending in `.zip` or `.pdf` writes the frames as one zip, with an
`export-report.csv`, or one PDF, through the same export as `--data` below;
files in the zip are named after the frame, and `--scale` takes one value.

Values are checked against the template's fields, with their defaults filled
in. A photo given to an image field is read from the working directory with
`--set`, or from the values file's directory with `--values`. A font the
template declares loads from its source; any other family is looked up on
Google Fonts by name, and both cases are reported on stderr when a family is
guessed or no font data is found, as is text the fonts have no glyphs for.
Relative image paths in the template resolve against its directory, and
nothing outside it is read. An image field left empty is not reported.

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

`--set` and `--values` fill a field the same way in every row, over its
column. `--variant`, `--frame` and `--format` work as above, `--format` for
images only, and `--scale` takes one value. A required field no column or `--set`
fills is reported and uses its default. Progress and the summary are those of
a workspace export, below.

#### Export options

These shape a zip, PDF or directory written from a template, with or without
`--data`, as an export preset's settings do in Studio.

| Flag | |
|---|---|
| `--name <pattern>` | file names, such as `{{member_id}}-{{side}}`: any field, or `{{template}}`, `{{index}}`, `{{side}}`, `{{record}}` and `{{variant}}`; default `{{template}}-{{index}}-{{side}}` with `--data` and `{{side}}` without |
| `--quality <n>` | JPEG and WebP quality, 0 to 100, default 90; for a PDF with `--pdf-pages jpeg` |
| `--bleed` | include the template's bleed around each card |
| `--dpi <n>` | PDF only: pixels per inch, which sets the page or card size; default 300 |
| `--pdf-pages <png\|jpeg\|vector>` | PDF only: what each page holds, default `png` |
| `--sheets <paper>` | PDF only: lay the cards out at their trim size with crop marks on `a4`, `letter`, `legal`, `a3`, `tabloid` or `<width>x<height>` millimetre paper, in whichever orientation fits more |
| `--duplex <long\|short>` | with `--sheets`: put each back behind its front, for a printer that flips on that edge |
| `--margin <mm>`, `--gap <mm>` | with `--sheets`: the paper's margin, default 10, and the space between cards, default 0 |
| `--no-crop-marks` | with `--sheets`: leave out the crop marks |

A flag that does not fit the output, such as `--dpi` for a zip or `--quality`
for PNG, is refused, as is `--bleed` for a template without one, a `--name`
token the template does not have, and sheets the cards do not fit.

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
read and checked, and sheets that cannot be laid out still fail, but no font is
fetched and nothing is rendered.

### validate

```sh
freshcoat validate card.coat
freshcoat validate club.coatworkspace --strict
```

Prints `card.coat is valid`, or lists each issue on stderr and exits 1. It also
warns about what Studio's Issues list shows, without failing:

- a variant change that names a layer its side does not have, or changes
  nothing;
- a top-level layer with an edge between the trim and the template's safe area,
  or for a `card_cr80` template with none, the printer's 3 mm;
- a `format_version` newer than this freshcoat reads, or older than the fields
  the template uses.

A `.coatworkspace` is checked as a whole: each template as above, a binding to
a dataset the workspace does not have, a preset whose template is missing or
whose sheets the cards do not fit, and, as a warning, required fields no column
fills. `--strict` exits 1 on warnings too.

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
the dataset it is bound to and the required fields no column fills; each
dataset with its records by status and its columns; and each preset with its
template, format, record filter, how many items it exports and, on sheets, how
they lay out or why they cannot. `--json` prints `templates`, `datasets` and
`presets` arrays, each template with its own inspection as above.

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
or id, and without it every template goes into a `.zip`.

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
