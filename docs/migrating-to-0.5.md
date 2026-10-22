# Migrating to 0.5

0.5 is safer for hosts that render templates, fonts, images and spreadsheets
they did not write. Loaders refuse unsafe URL schemes, and the image, font and
spreadsheet readers refuse input over new size limits. Coatfile throws one
typed error, and the engine and coatfile package roots export only their
documented API. The [release notes](releases.md#unreleased-changes) list
every change.

## Replacements

| 0.4 | 0.5 |
|---|---|
| `fetchLoader` loading `http:`, `file:` or another scheme | `createFetchLoader({ unsafeAllowHttp: true })` for `http:`; your own `load` for anything else |
| `resolveTemplateFonts(template, { guessGoogle: false })` | `resolveTemplateFonts(template, { fallback: null })` |
| `guessGoogle: true` | drop it; `googleFonts()` is the default `fallback` |
| `catch (err) { if (err.message.startsWith("unknown_variant")) … }` | `if (err instanceof CoatError && err.code === "unknown_variant")` |
| `const out = saveTemplate(template, "json")` | `const out = await saveTemplate(template, "json")` |
| `saveTemplate` pack failure at `/format_version` | `write_failed` at the template root |
| `decodeTemplate` hash failure as `invalid_json` | `hash_failed`; other read failures `read_failed` |
| engine re-exports from `@freshcoat-js/coatfile` (`encodePng`, `Renderer`, `CR80_*`, `MM_PER_INCH` and the rest) | `@freshcoat-js/engine` |
| `@freshcoat-js/coatfile/assets`, `/define`, `/fields`, `/normalize`, `/slices` | `@freshcoat-js/coatfile` |
| engine and coatfile helpers listed as moved in the release notes | `@freshcoat-js/engine/internal`, `@freshcoat-js/coatfile/internal` (unstable) |
| `scalePathData` from `@freshcoat-js/engine` | `@freshcoat-js/engine/path` |
| `readIccProfile`, `resolveOutputIntent`, `SRGB_PROFILE` and the other ICC exports from `@freshcoat-js/engine` | `@freshcoat-js/engine/icc` |
| `setCpuFinish`, `setLayerBounds` | `switches: { cpuFinish, layerBounds }` per paint |
| `createPaintCache`, `PaintCache` | removed; a renderer makes its own from `cache` |
| `format_version: "1.7.0"` and other three-part or suffixed versions | `"1.7"` |
| a field `pattern` with nested repetition or a backreference | a pattern without them, or a check in your own code |
| images of any size | up to `maxImageDecodePixels` (200,000,000) on `createRenderer` |
| spreadsheets of any size | up to the `readTable` limits, raised with `limits` |
| `freshcoat render --data` with any number of rows | up to 500,000 records; `--max-rows <n>` or `--max-rows 0` |
| a CLI PDF of any page count | up to 2000 pages; `--max-pdf-pages <n>` or `--max-pdf-pages 0` |
| CSV and TSV export writing `=SUM(A1)` as is | `'=SUM(A1)`; `writeTable(dataset, format, { escapeFormulas: false })` for the old output |

Symbols that are no longer exported anywhere are listed in the
[release notes](releases.md#errors-and-api). Most were implementation details
with no public replacement. Copy the few you used, such as `hslToRgb`, into
your code.

## Loaders and URL schemes

The engine's default loader takes `data:`, `blob:` and `https:` only. To
fetch `http:` again for templates you trust:

```ts
import { createFetchLoader, createRenderer } from "@freshcoat-js/engine";

const renderer = await createRenderer({
  ck,
  load: createFetchLoader({ unsafeAllowHttp: true }),
});
```

For another scheme, pass a loader that handles it and hands the rest to
`fetchLoader`:

```ts
import { createRenderer, fetchLoader } from "@freshcoat-js/engine";

const load = (src: string) =>
  src.startsWith("s3://")
    ? myBucket.get(src.slice(5))
    : fetchLoader(src);

const renderer = await createRenderer({ ck, load });
```

In Node, `fileLoader` from `@freshcoat-js/engine/node` still reads paths under
a root. The CLI opts in to `http:` itself, so CLI users need nothing. See
[safer defaults](security-defaults.md) for relative URLs, redirects and fonts.

## Font fallback

`guessGoogle` is gone. `fallback` takes a `FontFallback`, `null` or nothing:

```ts
import { googleFonts, resolveTemplateFonts } from "@freshcoat-js/coatfile";

await resolveTemplateFonts(template);                           // Google Fonts, as before
await resolveTemplateFonts(template, { fallback: null });       // no lookup
await resolveTemplateFonts(template, { fallback: myMirror });   // { id, load(family, weights) }
```

`exportWorkspace` takes the same option as `fontOptions: { fallback: null }`.

## Typed errors and async `saveTemplate`

Everything coatfile throws is a `CoatError` with a `code` from
`CoatErrorCode`, an optional `path` and a `cause`. The message no longer starts
with the code, so match on the code:

```ts
import { CoatError, saveTemplate } from "@freshcoat-js/coatfile";

try {
  compile(template, values, { variantId });
} catch (err) {
  if (err instanceof CoatError && err.code === "unknown_variant") showVariants();
  else throw err;
}

const saved = await saveTemplate(template, "json");
if (!saved.ok) report(saved.errors);
```

`saveTemplate` returns a promise for both `"coat"` and `"json"`.

## Moved and removed exports

Each package root holds what its README documents, plus the types its
functions take and return. Fix imports in this order:

1. Anything engine-owned that you imported from `@freshcoat-js/coatfile`
   comes from `@freshcoat-js/engine` instead. Coatfile's subpaths such as
   `./bleed` and `./fonts` no longer re-export engine symbols either.
2. Imports from the removed coatfile subpaths `./assets`, `./define`,
   `./fields`, `./normalize` and `./slices` come from `@freshcoat-js/coatfile`.
3. ICC exports come from `@freshcoat-js/engine/icc`, `scalePathData` from
   `@freshcoat-js/engine/path` and `DEFAULT_MAX_IMAGE_DECODE_PIXELS` from
   `@freshcoat-js/engine/image`.
4. Helpers that only Freshcoat's own packages use are on `./internal`. That
   subpath is unstable and can change in any release; prefer copying the
   helper.

TypeScript reports each import that no longer resolves, so `tsc --noEmit`
gives the full list for your code.

## Limits

Each limit refuses input large enough to exhaust memory. Raise one only for
input you trust; `Number.POSITIVE_INFINITY` lifts it.

### Images

```ts
const renderer = await createRenderer({ ck, maxImageDecodePixels: 400_000_000 });
```

An image over the limit, or one whose header size cannot be read, paints a
placeholder and reports `image_load_failed`. The header reader handles PNG,
JPEG, GIF, WebP, BMP, ICO and CUR, WBMP and AVIF; HEIF is refused. Studio, the
CLI and `exportWorkspace`'s worker pools use the default. A decoded image
takes 4 bytes per pixel from CanvasKit's 2 GiB heap, so a 400,000,000-pixel
image needs about 1.6 GB of it.

### Fonts

WOFF and WOFF2 fonts that would unpack to more than 128 MiB, or whose table
lengths do not match, are refused with `font_load_failed`. This limit is
fixed; convert such a font to TTF or OTF to load it.

### Spreadsheets

```ts
import { readTable, TableLimitError } from "@freshcoat-js/workspace/tabular";

try {
  const table = await readTable(bytes, "people.csv", {
    limits: { maxRows: 2_000_000, maxCells: 40_000_000, maxBytes: 512 * 1024 * 1024 },
  });
} catch (err) {
  if (err instanceof TableLimitError) console.error(err.limit, err.actual, err.max);
  else throw err;
}
```

| Limit | Default | `err.limit` |
|---|---|---|
| `maxBytes` | 128 MiB | `bytes` |
| `maxUncompressedBytes` | 512 MiB | `uncompressed_bytes` |
| `maxZipEntries` | 10,000 | `zip_entries` |
| `maxRows` | 500,000 records below the header row | `rows` |
| `maxColumns` | 500 | `columns` |
| `maxCells` | 10,000,000 | `cells` |

`DEFAULT_TABLE_LIMITS` holds these values. Text longer than a JavaScript
string can hold, about 512 MB, is refused whatever the limits.

### CLI

```sh
freshcoat render card.coat --data people.csv --max-rows 2000000 --out cards.zip
freshcoat render card.coat --data people.csv --max-rows 0 --out cards.zip
freshcoat render club.coatworkspace --preset Print --max-pdf-pages 5000 --out cards.pdf
freshcoat render club.coatworkspace --preset Print --max-pdf-pages 0 --out cards.pdf
```

`--max-rows <n>` raises the record limit. Above the default it also raises the
file size, uncompressed size and cell limits in proportion. `--max-rows 0`
lifts all four. Columns and zip entries keep their limits.

`--max-pdf-pages` defaults to 2000. **A job that wrote a larger PDF in 0.4 now
exits 1 with no output.** Pass a higher limit or `--max-pdf-pages 0` to restore
the old behaviour. The CLI holds every page in memory until it builds the
PDF, so a very large one can still run out of memory; to avoid that, split the
export with `--where`.

For scripts that check exit codes: Ctrl-C now exits 130 and SIGTERM 143, and
a cancelled export removes its partial file.

## Templates

`format_version` must be `MAJOR` or `MAJOR.MINOR`. A file with `"1.7.0"` or
`"1.7-beta"` is `unsupported_format_version`; write `"1.7"`.

A field `pattern` fails `validate` with `unsafe_field_pattern` when it is over
512 characters, repeats a group that already repeats (`(a+)+`,
`^(\d+,)*\d+$`) or uses a backreference. Rewrite it without the nested
repetition, or check the value in your own code. At render time such a pattern
imposes no constraint.

`{{constructor}}`, `{{toString}}` and `{{__proto__}}` render empty unless the
values have them as their own keys, and an empty record no longer meets
`required: ["constructor"]`.

Generated schemas have the unversioned `$id`
`https://cdn.jsdelivr.net/npm/@freshcoat-js/coatfile/schema/coatfile.v1.schema.json`.
A `$schema` pinned to `@0.4.0` keeps working.

## Output that changes

Nothing here needs a code change, but goldens and byte comparisons will
differ:

- PDF text strings outside printable ASCII are UTF-16BE; they used to be `?`. The
  trailer has an `/ID`, and every PDF declares an sRGB output intent unless
  you pass `outputIntent: false` (`--no-output-intent` in the CLI). Fix
  `date` to keep the bytes repeatable.
- A font whose OS/2 `fsType` forbids embedding or subsetting is drawn as
  outlines in vector PDFs, with `font_embedding_restricted`, and its text
  cannot be selected or searched. There is no option to embed it, since its
  licence forbids that.
- Cut lines stroke in overprinting `/Separation` spots (`CutContour`,
  `KissCut`, `Crease`, `Perfcut`) instead of DeviceRGB. They look the
  same; `cutSpots` or `--cut-spot` renames the spots.
- CSV and TSV cells starting with `=`, `+`, `-`, `@`, a tab or a carriage
  return get a leading `'`. Machine consumers can pass `escapeFormulas: false`
  to `writeTable`; Studio always escapes.
- In Figma, a layer with several blurs of one kind keeps the first visible
  one and warns with `duplicate_blur_dropped`.
