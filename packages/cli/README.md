# @freshcoat-js/cli

The `freshcoat` command line for [Freshcoat](../../README.md): render a
template to images, once per spreadsheet row, or a workspace's export preset
to a zip or PDF, check a
template and list what it holds, without writing a script. It is built on
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

## Commands

### render

```sh
freshcoat render card.coat --set displayName="Alex" --out out
freshcoat render card.coat --values alex.json --variant amber --frame front
freshcoat render card.json --scale 1 --scale 2 --format webp --out out
freshcoat render card.coat --data people.csv --out cards.zip
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
| `--out <dir>` | directory to write to, created if needed; default the current one |

Values are checked against the template's fields, with their defaults filled
in. A font the template declares loads from its source; any other family is
looked up on Google Fonts by name, and both cases are reported on stderr when
a family is guessed or no font data is found. Relative image paths resolve
against the template's directory, and nothing outside it is read.

#### Spreadsheets

With `--data <file>`, the template renders once per row of a CSV, TSV, Excel,
`.ods`, JSON or NDJSON file, and `--out` names a `.zip` of images and an
`export-report.csv`, or a `.pdf`. The first row names the fields, matched by
key or title ignoring case and punctuation; columns no field matches are
reported and left out, and only the first sheet of a workbook is read. A photo
named in an image field's column is read from the data file's directory. Files
are named `<template id>-<row>-<frame>`, with the scale as a suffix for
anything but 1x.

`--set` and `--values` fill a field the same way in every row, over its
column. `--variant`, `--frame` and `--format` work as above, `--format` for a
zip only, and `--scale` takes one value. A required field no column or `--set`
fills is reported and uses its default. Progress and the summary are those of
a workspace export, below.

#### Workspaces

Runs an export preset from a `.coatworkspace`, chosen with `--preset` by id or
by a name no other preset has, and writes the zip or PDF to `--out`; both flags
are required and the template flags are refused. Progress goes to stderr and a
one-line summary to stdout. The command also warns about text the fonts have no
glyphs for, and exits 1 when an item fails.

### validate

```sh
freshcoat validate card.coat
```

Prints `card.coat is valid`, or lists each issue on stderr and exits 1.

### inspect

```sh
freshcoat inspect card.coat
freshcoat inspect card.coat --json
```

Lists the frames and their sizes, the fields with their type, requirement and
default, the variants, and the font families the template uses, with whether it
declares each. `--json` prints the same as one object with `frames`, `fields`,
`variants` and `fonts` arrays.

## From code

`main(argv, io)` runs the same commands in-process and resolves to the exit
code, which is how the tests drive it. `io` supplies stdout, stderr, the
working directory and a `fetch` for fonts, so a test needs no network.

```ts
import { main } from "@freshcoat-js/cli";

const code = await main(["validate", "card.coat"]);
```

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
