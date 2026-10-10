# @freshcoat-js/cli

The `freshcoat` command line for [Freshcoat](../../README.md): render a
template to images, check it, list what it holds and run a workspace's export
presets, without writing a script. It is built on
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
freshcoat render card.coat --format pdf --dpi 300 --out out
```

Renders each frame and prints the path of every file it writes. Files are named
after the frame, with the scale as a suffix for anything but 1x: `front.png`,
`front@2x.png`. JPEG files use `.jpg`. `--format pdf` writes each frame as one
page of vectors, `front.pdf`, sized at `--dpi` design units to the inch. Text
is set in its embedded font, and a layer a PDF cannot express, such as a
shadow, is drawn as a 600 dpi image with a note on stderr.

| Flag | |
|---|---|
| `--values <file>` | a JSON object of field values |
| `--set <key=value>` | one field value; repeat it, and it overrides `--values` |
| `--variant <id>` | render a variant of the template |
| `--frame <name>` | render only this frame; repeat it for several |
| `--scale <n>` | pixel density, default 1; repeat it for several |
| `--format <png\|jpeg\|webp\|pdf>` | default `png` |
| `--dpi <n>` | design units per inch of a PDF page, default 300 |
| `--out <dir>` | directory to write to, created if needed; default the current one |

Values are checked against the template's fields, with their defaults filled
in. A font the template declares loads from its source; any other family is
looked up on Google Fonts by name, and both cases are reported on stderr when
a family is guessed or no font data is found. Relative image paths resolve
against the template's directory, and nothing outside it is read.

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

### export

```sh
freshcoat export club.coatworkspace --preset "All cards" --out cards.zip
freshcoat export club.coatworkspace --preset "Print sheet" --out cards.pdf --vector
```

Runs an export preset from a `.coatworkspace`, chosen by id or by a name no
other preset has, and writes the zip or PDF to `--out`. Progress goes to
stderr and a one-line summary to stdout. The command also warns about text the
fonts have no glyphs for, and exits 1 when an item fails. `--vector` draws a
PDF preset's cards as vectors, as its `pdfPageImage: "vector"` does.

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
