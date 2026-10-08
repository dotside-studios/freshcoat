# @freshcoat-js/coatfile

The template format, validator and compiler for
[Freshcoat](../../README.md). A template describes named frames, layers,
fields and variants; a `.coat` file packages that document with its embedded
fonts and images.

Use this package when you want to render a design with different values,
read or write template files, or build an authoring tool. Freshcoat Studio
and the Figma plugin both use it, but it has no dependency on either app or
on a UI framework.

`compile()` resolves fields, variants and template sizing into a
[`@freshcoat-js/engine`](../engine) node tree. The engine then resolves scene layout,
shapes text and paints it. The main entry contains the format and compiler;
the rendering helpers live on the `render` subpath.

## Quick start

For template-to-image output, use `renderTemplate()` with a renderer from the
coat engine. It loads the fonts the template describes through the renderer,
loads the barcode encoder when the template draws a barcode, and paints each
side at the template's own size unless you give another.

```ts
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/node"; // or /browser
import { renderTemplate } from "@freshcoat-js/coatfile/render";

const renderer = await createRenderer({ ck: await loadCanvasKit() });

const [front] = await renderTemplate(renderer, template, { displayName: "Alex" }, {
  variantId: "amber",
  frameNames: ["front"],
});
// front.bytes: PNG by default; front.name, front.width, front.height, front.warnings
```

`output` picks what comes back, as on the renderer: `{ encode: { format: "webp" } }`,
`{ pixels: true }`, or a live `{ canvas: true }`. `images` supplies bytes for
one render, such as a logo that changes per request.

Need the node tree first (e.g. to read its image srcs)? Use `compile()` for the
tree and `renderCompiled()` to paint it:

```ts
import { compile } from "@freshcoat-js/coatfile";
import { renderCompiled } from "@freshcoat-js/coatfile/render";

const compiled = compile(template, { displayName: "Alex" }, { width: 1012, height: 638 });
// compiled.frames[i].root: an engine GroupNode
// compiled.frames[i].assets.images: the srcs it draws
const [result] = await renderCompiled(renderer, compiled, { frameNames: ["front"] });
```

`renderCompiled()` does not load the barcode encoder, since the barcodes were
drawn when the template compiled; register it before compiling (see
[Barcodes](#barcodes)).

### Rendering many records

`compile()` keeps the value-independent work (validation, embedded assets, the
variant and `resize`) per template object, so compiling one template for many
records validates and prepares it once. `prepareTemplate(template, { variantId,
resize })` exposes that step. The cache is keyed by object identity: do not
mutate a template after compiling it; pass a new object instead.

Keep one renderer for the batch. Its text engine reuses shaping across
records, and its paint cache keeps decoded images, SVG pictures, paths and the
font provider. A paint frees the cached images it did not draw; with
`maxImagePixels` it keeps them, least recently used first out, until the cache
fits that many decoded pixels and at most `maxImages` entries (256 by default).
An SVG picture counts as the rasters it embeds plus a fixed cost for its
recorded drawing.

```ts
const renderer = await createRenderer({ ck, cache: { maxImagePixels: 48_000_000 } });
for (const record of records)
  await renderTemplate(renderer, template, record, { frameNames: ["front"] });
renderer.dispose();
```

To render a compiled node tree yourself, use the coat engine's renderer or
`compileScene(root, ...)` directly.

`variantId` draws one of the template's variants; see [Variants](#variants).

### Export settings

`width`/`height` are the size the template is **compiled** at — layout, wrapping
and text shaping all happen there. `exports` is the density that compiled scene is
**rasterized** at, exactly like a row in Figma's export panel:

```ts
const results = await renderTemplate(renderer, template, values, {
  width: 1012,
  height: 638,
  exports: [
    {},                                                        // 1×
    { constraint: { kind: "scale", value: 2 }, suffix: "@2x" }, // 2024×1276
    { constraint: { kind: "width", value: 600 }, suffix: "-thumb" },
  ],
});
// one result per frame PER setting, grouped by frame, in export order:
// { name: "front", scale: 2, suffix: "@2x", width: 2024, height: 1276, bytes, format, … }
```

Every result includes its frame name, export `scale`, `suffix` and actual pixel
`width`/`height` after clamping, plus what `output` asked for. Omitting
`exports` produces a single 1× export per frame.

The layout is the compile's at every density: a 2× export is a 2× raster of the
*same* 1012-wide layout, not the layout a 2024-wide compile would produce. Text and
vectors re-rasterize and images resample from their source, so the extra pixels
carry real detail. Each frame is compiled once and painted once per setting, so an
extra size costs a paint, not a re-bake.

`{ kind: "width" | "height" }` derives the scale from the design size (aspect
preserved); a density large enough to exceed the coat engine's `MAX_EXPORT_DIMENSION`
is lowered to fit, and the `scale` on the result is the one actually used.

`@freshcoat-js/coatfile/render` holds `renderTemplate` and `renderCompiled`,
so the main entry stays free of the painter.

### PNG size

PNG is written by the coat engine's own encoder.
`output: { encode: { format: "png", effort: "best" } }` also searches filtered
encodings for a smaller file, at the cost of more encoding work. Compression
gains depend on the image.

## Canvas and `product`

A template's `width` and `height` are positive integers. There is no product
registry, size table or aspect-ratio whitelist. `product` is optional metadata;
it does not affect compilation. A consumer can require it for its own catalog
or ordering workflow. `template_data` needs at least one frame, with unique
frame names; `front` and `back` are card conventions.

Two constraints do apply:

- `compile()` scales freely but reshapes only when asked. It throws if the
  target `width`/`height` ratio differs from the template's by ≥0.005, unless
  `resize` is set (see [Constraints](#constraints)).
- A frame's `background` must fill it — `pos` `{x:0, y:0}` (or absent) and
  `size` equal to the template dims (or absent).

The figma plugin's custom export mode produces exactly this shape.

## Bleed and safe area

`bleed` and `safeArea` (1.5) are insets from the trim in design units: one
number for every side, or `{ top, right, bottom, left }`. Both are optional
and must be non-negative. The safe area must leave room inside the trim
(`safe_area_exceeds_trim`); the bleed has no upper bound.

```jsonc
{ "width": 1012, "height": 638, "bleed": 35, "safeArea": { "top": 35, "right": 35, "bottom": 35, "left": 35 } }
```

The trim stays at `0, 0` to `width`, `height`, so a layer placed at `0, 0` is at
the trim's corner whether or not a render includes the bleed. `safeArea` is a
guide for authoring tools and never changes a render.

A render includes the bleed only when asked: `compile(t, values, { width,
height, bleed: true })` or `render(…, { …, bleed: true }, …)`. `width` and
`height` stay the trim's size, and the scene grows by the bleed at the same
scale. The compiled template's `trim`, and each painted result's `trim`, give
the trim's box inside the output. Without the option, and for a template
without bleed, the output is exactly what it was.

With bleed:

- The background covers the whole bleed box.
- A top-level `rect`, `image`, or `frame` without a stroke or auto-layout,
  unrotated, that runs to a trim edge (within half a unit) grows past it by
  the bleed on that side. A frame's children keep their place on the card.
- Anything else keeps its box. Whatever of it lies past the trim is drawn,
  so a layer that should bleed and is not one of the above can be drawn past
  the trim by hand.

`bleedSize(t)`, `templateBleed(t)` and `templateSafeArea(t)` resolve the
insets; `extendIntoBleed` is the edge rule on its own.

## Inline assets

A template normally points at its rasters by URL. An authoring tool has none —
only bytes it just exported — so it can instead src an image `asset:<sha256>`
and carry the bytes in an optional top-level `assets` array:

```jsonc
{
  "format_version": "1.0",
  "id": "aurora", "name": "Aurora", "product": "card_cr80",
  "width": 1013, "height": 638,
  "fields": { "type": "object", "properties": {}, "required": [] },
  "template_data": [
    { "name": "front", "background": { … },
      "elements": [{ "id": "photo", "type": "image",
                     "properties": { "src": "asset:deadbeef", "fit": "cover" } }] }
  ],

  "assets":   [{ "sha256": "deadbeef", "base64": "…", "contentType": "image/png" }],
  "source":   { "kind": "figma", "importedAt": "…", "picks": { … }, "variants": { … } },
  "warnings": [{ "severity": "warn", "code": "…", "message": "…" }]
}
```

That is a `Template` — it validates, compiles and renders unchanged, because
`compile()` resolves `asset:` srcs against `assets` itself:

```ts
import { render } from "@freshcoat-js/coatfile/render";
const [result] = await render(exported, {}, { width: 1013, height: 638 }, { ck, env, fonts });
```

A consumer that wants a template backed by real URLs uploads the bytes and ends
the inline state:

```ts
import { detachAssets, readAssets } from "@freshcoat-js/coatfile/assets";

const urlByHash = await upload(readAssets(template));   // [{ sha256, blob, contentType }]
const stored = detachAssets(template, urlByHash);       // srcs → URLs, `assets` gone
```

`detachAssets` throws `unresolved_asset: <sha>` rather than emit a template that
has silently lost an image. `collectAssetRefs` lists what still needs
resolving; `resolveAssetSrcs` is the non-throwing variant for previews.

### The three fields

All optional, all additive — a template without them is unchanged, and a
consumer that ignores them draws the same picture.

| Field | Who writes it | Who clears it |
|---|---|---|
| `assets` | an authoring tool, via `attachAssets` | `detachAssets`, after upload |
| `source` | an authoring tool | the consumer, if it stores provenance elsewhere |
| `warnings` | an authoring tool | the consumer, once surfaced |

`source` fixes only `kind`; every other key round-trips unread, so a design
tool's vocabulary — file keys, node ids, component instances — stays in that
tool's exporter rather than in the format.

## Packages (`.coat`)

`@freshcoat-js/coatfile/coat` reads and writes the packaged form. Base64 makes every
carried image and font about a third larger and forces a full parse to read
anything; a package holds the same template with its bytes in their own entries.
It is a zip:

```text
mimetype                    application/x-freshcoat+zip
template.json               the template, each `assets` entry without `base64`
assets/<sha256>.<ext>       one entry per asset, named by the sha256 of its bytes
```

| | |
|---|---|
| Extension | `.coat` |
| Media type | `application/x-freshcoat+zip`; template JSON is `application/x-freshcoat+json` |
| First entry | `mimetype`, stored uncompressed, so the media type starts at byte 38 |
| Asset key | lowercase hex sha256 of the entry's bytes |
| Asset extension | cosmetic, from `contentType`; a reader matches on the part before the first `.` |

`template.json` keeps `contentType` on each `assets` entry. Unpacking puts each
`base64` back, so the result validates, compiles and renders exactly as the JSON
form does. A reader rejects a package whose `mimetype` names another type (the
TemplateKit `application/vnd.davi.templatekit+zip` still reads), whose
`template.json` is missing or not JSON, or whose listed asset is missing or does
not hash to its name. Unlisted entries are ignored. A package and template JSON
are told apart by their first bytes (`PK\x03\x04` against `{`), not by name.

| Extension | Holds | |
|---|---|---|
| `.coat` | the zip package | written by `packTemplate` |
| `.coat.json` | template JSON, assets inline | written by `serializeTemplate` |
| `.tkit`, `.tkit.json` | the same two, under their TemplateKit names | read, never written |
| `.json` | template JSON, or the old Figma wrapper | read, never written |

The compound `.coat.json` keeps the file JSON to every editor, and lets one match
it by pattern to attach the JSON Schema (VS Code: `json.schemas` with
`"fileMatch": ["*.coat.json"]`). Both writers refuse a template from a newer 1.x
minor.

```ts
import { decodeTemplate, packTemplate } from "@freshcoat-js/coatfile/coat";

const bytes = await packTemplate(template);        // Uint8Array, deterministic
const read = await decodeTemplate(bytes);          // or JSON text, or JSON bytes
if (read.ok) validate(healElementIds(read.document));
```

`packTemplate` re-keys every asset by the real hash of its bytes first
(`rehashAssets`), because that hash becomes its entry name and `unpackTemplate`
rejects an entry that does not match. Template JSON never had that check, so a
template keyed `deadbeef` still validates and renders; `verifyAssets` lists those
keys without changing anything.

Hashing defaults to `crypto.subtle`, which exists only in a secure context. A
Figma plugin's iframe is not one, so the plugin passes its own `sha256`.

## Format versions

`FORMAT_VERSION` is what a writer stamps; `formatVersionStatus(v)` says whether
this kit reads `v` (`"current"`), reads it but would lose fields writing it back
(`"newer"`), or refuses it (`"unsupported"`). `validate` accepts every 1.x;
`packTemplate` refuses a `"newer"` template, because validation already stripped
what that minor added.

| Minor | Adds |
|---|---|
| 1.0 | the original format |
| 1.1 | `product` and `version` optional; `$schema` kept |
| 1.2 | linear fill `from` / `to`; element `constraints` |
| 1.3 | the `barcode` element |
| 1.4 | variant deltas: `pos`, `size`, `rotation`, `opacity`, `hidden` |
| 1.5 | grid layout; element `adjust`; image `focus` and `crop`; template `bleed` and `safeArea`; text `justify`, `start` and `end` alignment, `alignLast`, `direction`, `paragraphSpacing` and font `features`; per-corner frame `cornerRadius`; `linear-burn` blend mode; barcode `bearerBars` |
| 1.6 | frame `isolate`; text `arc`; element `backdropBlur` |
| 1.7 | gradient stroke `color` |

A writer that re-saves a template it did not create keeps the version the file
was opened with, so a 1.2 file that gains a barcode would still say 1.2, and a
1.2 kit would re-save it and drop the barcode. `minimumFormatVersion(t)` names
the lowest minor that covers every field `t` uses, and `raiseFormatVersion(t)`
stamps it when it is higher than `t.format_version`. It never lowers the
version, leaves a `"newer"` or `"unsupported"` one untouched, and returns `t`
itself when nothing changes. Call it before `packTemplate` or
`serializeTemplate`.

```ts
import { raiseFormatVersion } from "@freshcoat-js/coatfile";

const bytes = await packTemplate(raiseFormatVersion(template));
```

`schema/coatfile.v1.schema.json` is the JSON Schema derived from the zod schema
`validate` runs. `bun run schema` regenerates it, and a test fails when it
drifts. Its `$id` is the copy the npm CDN serves from the published package,
`https://cdn.jsdelivr.net/npm/@freshcoat-js/coatfile@0.1.0/schema/coatfile.v1.schema.json`,
which is also what a template's `$schema` should point at. The package version
in this URL is independent of the template format version. The file is exported
as `@freshcoat-js/coatfile/schema/coatfile.v1.schema.json` for a host that serves
its own copy.

## Reading a file in

A file that came from an authoring tool is often *nearly* a template.
`decodeTemplate` takes whatever was handed over (a `.coat` or `.tkit`, JSON
bytes, JSON text) and flattens the `{ schemaVersion: 1, template, assets, … }` wrapper the figma
plugin wrote before it emitted templates directly. `./normalize` carries the
remaining fix. Both are idempotent, so running them over already-clean input is
free.

```ts
import { healElementIds, validate } from "@freshcoat-js/coatfile";
import { decodeTemplate } from "@freshcoat-js/coatfile/coat";

const read = await decodeTemplate(fileBytes);
const result = read.ok ? validate(healElementIds(read.document)) : null;
```

- `healElementIds` suffixes ids that repeat within a frame. `validate` rejects
  those, and a design with three layers named "Vector" produces three elements
  called `Vector` — so this is the common case, not the exotic one.

`healElementIds` renames layers, so a consumer that shows the file to a person
should say what changed rather than heal silently.

## Gradients

A `fill` is a colour string or a gradient: `linear`, `radial` or `angular`,
each with two or more `stops` (`offset` in `[0, 1]`). Positions are fractions of
the drawable's box, so a gradient follows the box when it is resized.

```jsonc
{ "kind": "linear", "angle": 90, "stops": [ … ] }                        // through the centre, downwards
{ "kind": "linear", "angle": 45, "from": [0, 0], "to": [1.2, 1.2], "stops": [ … ] }
{ "kind": "radial", "center": [0.5, 0.3], "radius": 0.6, "radiusY": 0.3, "rotation": 20, "stops": [ … ] }
{ "kind": "angular", "center": [0.5, 0.5], "rotation": 90, "stops": [ … ] }
```

A linear fill with only `angle` runs through the box's centre, 0 pointing right
and 90 down, reaching the edges. `from` and `to`, set together, place it
exactly; they may lie outside the box, and equal points fail validation
(`gradient_degenerate`). A writer that sets points also sets `angle` to
`linearGradientAngle(from, to)`, so a reader older than 1.2 draws the nearest
thing it can; `linearGradientPoints(angle)` goes the other way. A radial
`radius` is a fraction of the box's longest side, and an angular `rotation` has
0 at twelve o'clock.

## Patterns

A `pattern` fill is a procedural texture drawn by a CanvasKit shader, not an
image, so it costs no asset and stays sharp at any export density.

```jsonc
{ "kind": "pattern", "pattern": "noise", "scale": 1.5, "density": 0.5, "seed": 3, "colors": ["#ffffff00", "#00000040"] }
{ "kind": "pattern", "pattern": "paper", "scale": 24, "density": 0.35, "colors": ["#f7f3ea", "#d9d0bd"] }
{ "kind": "pattern", "pattern": "hatching", "scale": 8, "angle": 45, "density": 0.25 }
{ "kind": "pattern", "pattern": "dots", "scale": 10, "density": 0.2 }
```

| Field | Meaning |
|---|---|
| `pattern` | `noise` (film grain), `paper` (fibres and tooth), `hatching` (parallel lines) or `dots` (a grid of dots) |
| `scale` | feature size in template units: grain, fibre length, line spacing or dot pitch |
| `angle` | degrees, 0 pointing right and 90 down |
| `density` | `[0, 1]`, how much of the second colour covers the first: line width over spacing, dot area over cell area, or the noise bias |
| `seed` | integer; picks a different noise or paper texture |
| `colors` | `[background, ink]` |

Omitted fields take the pattern's defaults (`PATTERN_DEFAULTS` in the engine).
Unlike gradients, a pattern is measured in template units from the drawable's
top-left: resizing the box shows more of it rather than stretching it, and
`compile` scales it with the target size like every other length. The same
seed paints the same texture in every renderer.

## Constraints

`constraints` on any element says how it follows its parent when the parent is
laid out at another size, per axis, as in Figma:

```jsonc
{ "constraints": { "horizontal": "end", "vertical": "end" } }   // pinned bottom-right
```

| Value | Keeps |
|---|---|
| `start` (default) | the offset from the left / top |
| `end` | the offset from the right / bottom |
| `center` | the centre's offset from the parent's centre |
| `stretch` | both offsets; the size changes |
| `scale` | position and size as fractions of the parent |

Nothing moves unless something is resized. `compile(t, values, { width,
height, resize: { width, height } })` lays each frame out at `resize` design
units, then scales that to `width` x `height`; the aspect check is skipped, so
pick `resize` with the target's aspect. `fitDesignSize(t, w, h)` is that size
for a `w` x `h` target: the target's aspect, with its shorter axis as long as
the template's shorter side, so a mark keeps its size relative to a photo's
short edge. `resizeTemplate(t, w, h)` does the same re-placing on the document
itself and returns a template at the new size. Its variants come along: every
`pos` and `size` a delta already had, and every override background, takes the
value it has once that variant is laid out at the new size. A vector's delta
also takes its laid-out `d` when it already set one, or when its own `size`
leaves the path different from the resized base's.

- A frame or mask whose box changed re-places its own children the same way.
- An auto-layout frame's flow children ignore constraints, because the layout
  places them; an `absolute` child follows its own.
- A rotated element is constrained by its unrotated box.
- A QR code, Data Matrix or Aztec that would come out non-square takes the
  shorter side of its box, centred in it. 1D barcodes and PDF417 stretch.
- Images re-fit (`cover`, `contain`) and text rewraps in the new box; a frame's
  background always covers it.
- A vector's `d` scales with its box on each axis, arcs included. Path data
  that does not parse keeps its authored coordinates.

## Vectors and blend modes

A `vector` element's `d` is SVG path data with any number of subpaths, arcs
included. `fillRule: "evenodd"` keeps the hole in a ring drawn as two subpaths
wound the same way; the default is SVG's nonzero.

`svgToElements` from `@freshcoat-js/coatfile/svg` converts SVG markup into one
frame of editable `vector`, `frame`, `mask`, `image` and `text` elements in
design px, and returns the features it skipped. Images embedded as `data:`
URLs (directly or through a same-document reference) become `image`
elements; `<text>` and `<tspan>` become `text` elements with the SVG's font
family, size, weight, style, fill and anchor, and spans where the styles
differ. A text box is sized from an estimate of the line's width, placed so
the baseline lands where the SVG put it. Markers become vectors, and a pattern
fill becomes a mask of its tiles. An `image` element can also point at an SVG
source directly; the engine draws it as vector art.

`blendMode` is any of Figma's layer modes: `multiply`, `screen`, `overlay`,
`darken`, `lighten`, `color-dodge`, `color-burn`, `linear-burn` (1.5),
`hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`,
`color`, `luminosity`, and `plus` (linear dodge).

A frame's `isolate` (1.6) is Figma's Normal on a container: its children
composite in a layer of their own, so a blended child mixes only with the
frame's own content. Without it the frame is pass-through, and its children
blend with whatever is under it. `isolate` is separate from `blendMode`, which
picks the formula the composited frame blends with. A frame with `opacity`
below 1, `blendMode`, `blur`, `shadow` or `adjust` composites as one layer
anyway, so `isolate` changes nothing there. Files written before 1.6 have no
`isolate`, and read as pass-through, as they always rendered.

```jsonc
{
  "id": "card", "type": "frame",
  "pos": { "x": 0, "y": 0 }, "size": { "width": 400, "height": 300 },
  "properties": {
    "isolate": true,
    "children": [
      { "id": "tint", "type": "rect", "blendMode": "multiply", /* … */ }
    ]
  }
}
```

## Barcodes

A `barcode` element draws one of eight symbologies from a mustache `value`,
like `qr_code` does:

| `symbology` | Kind | Carries |
|---|---|---|
| `code128` | 1D | ASCII and Latin-1 |
| `ean13` | 1D | 12 digits, or 13 with the check digit |
| `upca` | 1D | 11 digits, or 12 with the check digit |
| `code39` | 1D | digits, capitals, space and `-.$/+%` (lower case is uppercased) |
| `itf14` | 1D | 13 digits, or 14 with the check digit |
| `pdf417` | 2D | text; `errorCorrection` is the level, 0 to 8 |
| `datamatrix` | 2D | text |
| `aztec` | 2D | text; `errorCorrection` is a percentage, 5 to 95 |

```jsonc
{
  "id": "ticket", "type": "barcode",
  "pos": { "x": 40, "y": 700 }, "size": { "width": 360, "height": 120 },
  "properties": {
    "value": "{{ticket_id}}", "symbology": "code128",
    "foreground": "#000000",   // default; "background" is none unless set
    "showText": true,          // 1D: the human-readable line; default true
    "textSize": 16,            // default 14% of the height, at least 8
    "fontFamily": "Inter",     // default the template's first font
    "quietZone": 10            // modules each side; default the symbology's minimum
  }
}
```

An `itf14` code takes `bearerBars` (1.5): `"none"` (the default), `"frame"`, or
`"horizontal"` for bars above and below only. The bars are 5 modules thick,
GS1's recommended 4.8 mm at the nominal 1.016 mm module and more than the two
narrow bars it requires. They sit outside the quiet zone and inside the box, so
the modules get narrower to make room. Other symbologies ignore the property.

A GS1 number (EAN-13, UPC-A, ITF-14) may leave its check digit off, and gets it
added, in the bars and the text. One with the wrong check digit is refused with
the digit it should be.

**The encoder is registered, not imported.** The main entry does not carry
bwip-js, which is ~87 KB gzipped. `renderTemplate()` loads it on first use when
a template draws a barcode. A consumer that compiles directly registers it
once, before compiling:

```ts
import { setBarcodeEncoder } from "@freshcoat-js/coatfile";
import { bwipBarcodeEncoder } from "@freshcoat-js/coatfile/barcode";

setBarcodeEncoder(bwipBarcodeEncoder);
```

A code that can't be drawn still compiles, and says why in the frame's
`warnings`, which `renderTemplate()` passes on with the painter's own:

| Case | Draws | Warning |
|---|---|---|
| No encoder registered | a hatched box naming the symbology | `barcode_unavailable` |
| The encoder refuses the value | the same box | `barcode_invalid`, with its `message` |
| An empty value (an unfilled field) | the code's shape, faint | none |

The quiet zone is kept inside the element's box. 1D bars fill the height the
text line leaves; 2D codes keep square modules, centred. When a code is drawn
upright, the painter floors its module size to whole output pixels and centres
it, so every bar edge falls on a pixel boundary at any export scale.

## Masks

A `mask` element shows its `children` through the coverage of its `mask`
element. Both are positioned relative to the mask element, as a frame's children
are.

```jsonc
{
  "id": "avatar", "type": "mask",
  "pos": { "x": 40, "y": 40 }, "size": { "width": 120, "height": 120 },
  "properties": {
    "mask": { "id": "blob", "type": "vector", "size": { "width": 120, "height": 120 },
              "properties": { "d": "M60 0 C…Z", "fill": "#000" } },
    "children": [{ "id": "photo", "type": "image", "size": { "width": 120, "height": 120 },
                   "properties": { "src": "{{photo}}", "fit": "cover" } }],
    "channel": "alpha"   // or "luminance"; "invert": true shows the outside instead
  }
}
```

A single opaque rect or ellipse renders as a clip. Anything else (a path, an
image's alpha, a gradient, text, luminance, `invert`) renders through an
offscreen layer. The figma plugin emits one for every Figma "Use as mask" layer
and the layers above it.

## Grid layout

A frame's `layout` is a flex layout (`direction`, as before) or a grid:

```jsonc
"layout": {
  "type": "grid",
  "columns": [120, "1fr", "2fr"],   // px, "auto" or "<n>fr"
  "rows": ["auto", 80],             // optional; extra rows are "auto"
  "gap": [8, 12],                   // one number, or [row gap, column gap]
  "padding": { "top": 16, "left": 16 }
}
```

Children fill cells row by row. A child's `layoutChild.column` and
`layoutChild.row` pin it to a 1-based track, or span an inclusive
`[first, last]` range. A column span has to lie within `columns`; rows are
added as needed. A child with `width` or `height` set to `fill` stretches to
its cell, `hug` takes its content's size, and otherwise it keeps its own size
at the cell's top left. `fr` tracks need the frame's size on that axis, and
`auto` tracks size to their largest single-track child.

## Adjustments

Any element, and the background, can carry `adjust`: per-layer tone applied as
the layer composites. On a frame or mask it adjusts the composited result.

```jsonc
"adjust": {
  "saturation": 1.2,   // 1 = unchanged, 0 = grey
  "contrast": 1.1,     // 1 = unchanged, about the mid grey
  "brightness": 0.95,  // 1 = unchanged, a multiplier
  "gamma": 0.9,        // 1 = unchanged, below 1 lifts the mid tones
  "sharpen": 0.5,      // 0 = none
  "preserveHue": true  // give up saturation rather than hue when a boost clips
}
```

It compiles through the engine's `buildAdjust`. A print render composes its
correction after it rather than replacing it.

## Background blur

Any element can carry `backdropBlur` (1.6): what lies beneath it is blurred
inside its shape before the element paints, so a translucent fill over it reads
as frosted glass. The value uses the same scale as `blur` and scales with the
element. The shape is the element's outline: a frame's rounded box, a rect's
corners, an ellipse, a vector's fill, an image's mask, else its box. It is
painted at render time, so it follows whatever is placed beneath it, such as a
record's photo. It sees only what has been composited into the layer it is
drawn into: inside a frame with `isolate`, `opacity` below 1, `blendMode`,
`blur`, `shadow` or `adjust`, that is the frame's own content.

```jsonc
{ "id": "glass", "type": "rect", "backdropBlur": 24,
  "properties": { "fill": "#ffffff40", "cornerRadius": 16 } /* … */ }
```

## Image focus and crop

`crop` selects part of an image's source before `fit` places it, as fractions of
the source's width and height; it has to lie inside the image. `focus` is the
point, as `[x, y]` fractions, that `cover` keeps centred, as near as the
source's edges allow. `tile` repeats the whole source and ignores `crop`.

```jsonc
"properties": {
  "src": "{{photo}}", "fit": "cover",
  "focus": "{{photo_focus}}",                           // or [0.4, 0.3]
  "crop": { "x": 0.1, "y": 0, "width": 0.8, "height": 1 }
}
```

Photos differ per record, so `focus` also takes an `"x,y"` string, which is how a
field supplies it. A value that does not read as a point in `[0, 1]` falls back
to the centre; `parseImageFocus` and `formatImageFocus` convert between the two
forms.

## Strokes and corners

A stroke's `align` is `center` (the default), `inside` or `outside`, and every
stroked `rect`, `image`, `vector` and `frame` honors it. A rect, frame or
image strokes its outline inset or outset by half the width, following its
corners or mask. A vector strokes at twice the width, clipped to its own
interior or exterior under its `fillRule`, so an `evenodd` hole counts as
outside.

A stroke's `color` is a colour string or, from 1.7, a `linear`, `radial` or
`angular` gradient (see [Gradients](#gradients)). The gradient is placed in
the element's box exactly as a fill is, so an inside, centred or outside
stroke and its dashes all sample the same gradient as a fill would.

```jsonc
"stroke": { "width": 4, "align": "inside", "color": { "kind": "linear", "angle": 0, "stops": [ … ] } }
```

A `rect` or `frame` takes `cornerRadius` as one number or per corner,
`[topLeft, topRight, bottomRight, bottomLeft]`. A frame applies it to its
fill, its stroke and, with `clipsContent`, its clip. A clipping frame draws
an `outside` stroke beyond its clip, so the clip never hides it.

## Ellipses

There is no ellipse element. An ellipse is a `vector` whose `d` is two arcs
across its box, which the engine draws exactly as it would an ellipse node, and
which every 1.x reader already renders. A separate element would add nothing
to the picture and would make those files unreadable to older kits.

## Field patterns

A field's `pattern` is a JavaScript regular expression that `validateValues`
and workspace column checks enforce. It compiles with the `u` flag, so
`^\p{L}+$` matches letters in any script. A pattern that only parses without
`u`, such as `^\#\d+$` or `^[\w-.]+$`, compiles without flags instead. A
pattern invalid in both modes imposes no constraint, and the editor flags it as
not a valid regular expression.

## Conditional visibility

`visibleWhen` on any element shows it only while a field is set, and drops it
before layout otherwise, so an auto-layout frame closes the gap it leaves:

```jsonc
{ "visibleWhen": { "field": "show_badge" } }                  // set
{ "visibleWhen": { "field": "title", "not": true } }          // not set
{ "visibleWhen": { "field": "tier", "equals": "gold" } }      // exactly "gold"
{ "visibleWhen": [{ "field": "show_badge" }, { "field": "photo" }] }  // all hold
```

"Set" means non-blank, except for a **toggle**: a field with `format: "boolean"`,
whose value is the string `"true"` or `"false"` and which is set only when
`"true"`. Values stay strings everywhere, so a toggle rides the same order,
share and validation paths as every other field. An unset toggle is its
`default` (or off), so it is never reported missing even when listed in
`required`.

`isElementVisible` and `fieldIsSet` are exported for a consumer that needs the
same answer compile gets.

## Variants

A variant is one version of the design, such as a colourway or a role: `{ id,
label, swatch?, overrides }`. Every variant shares the base's layers. Each
override names a side and may replace its `background` whole and carry element
deltas, matched by id at any depth, inside frames and masks too:

```jsonc
{
  "id": "title",
  "properties": { "color": "#ffffff" }, // merged into the element's own
  "pos": { "x": 40, "y": 24 },          // 1.4: replace the element's own
  "size": { "width": 200, "height": 32 },
  "rotation": 0,
  "opacity": 0.8,                       // 0..1
  "hidden": true                        // 1.4: leave the element out
}
```

`properties` is required even when a delta changes only the shell, so write
`{}`. A 1.3 reader then still accepts the file, drops the keys it does not know
and draws the variant as a recolour only. A frame resized in a variant does not
re-place its children; a writer that moves them writes each move as its own
delta.

`applyVariant(template, variantId, { hidden })` returns the template with one
variant applied, which is what `compile` draws for `variantId`. A hidden element
and everything inside it is removed by default (`hidden: "drop"`); `"keep"`
leaves it in, for an editor that still lists it. A mask's shape is never drawn
itself, so hiding it has no effect. The input is not mutated, `variants` is
kept, and an unknown id throws `unknown_variant: <id>`. `compile` applies the
variant before `resize`, so its backgrounds and moved layers are laid out with
everything else.

`validate` checks `{{field}}` references in variant backgrounds and deltas as it
does in the design, with paths under `/variants/<i>/overrides/<j>/`.
`checkVariants(template)` is a separate lint that never fails validation; it
returns `VariantIssue`s with the variant id, the side, the element id and a path:

| Code | Means |
|---|---|
| `variant_orphan_override` | a delta whose id is no element on its side; it is skipped when drawing |
| `variant_empty_override` | a delta with empty `properties` and no other field |

## Rendering

The supplied rendering path uses CanvasKit (WASM Skia). Text layout and painting
use CanvasKit Paragraph, keeping measurement and shaping on the same
implementation. See [`@freshcoat-js/engine`](../engine) for the scene model and runtimes.

## Fonts

A `local` font's files travel inside the template, so handing someone the
template hands them the font. Embed only a font whose license allows that.

`collectFontBytes(template)` fetches every family a template uses as bytes;
`collectFontRequests` lists the families it needs and where each is declared.
Both include the families a variant's deltas bring in.

A `google` / `fontsource` descriptor points at a **stylesheet**, not a font
file, and what that stylesheet contains depends on who asks. Servers send an old
user-agent and get one unsubsetted TTF back. Browsers can't — `user-agent` is a
forbidden header there — so they get the modern answer: one `@font-face` per
weight × unicode subset, with `latin-ext` listed *before* `latin`. The coat engine
loads every face and orders the Latin-covering ones first, so `Map<family,
bytes[]>` holds several faces per family in the browser and one on a server.
Both are normal. (Taking the stylesheet's first url instead gives you a face
whose range starts at U+0100 — no A–Z — and every ASCII glyph paints as .notdef
with perfectly correct metrics.)

A **variable** family answers every requested weight with the *same* file, so
`Map<family, bytes[]>` holds one face covering 300–700 rather than three. The
weight is applied when the text is shaped, via the font's `wght` axis — see
the coat engine's `paragraph-layout`. Nothing here has to distinguish the two cases.

### Weights and variation axes

`weight` is any step from 100 (Thin) to 900 (Black). `variations` sets
variable-font axes by OpenType tag: `{ "wdth": 85, "opsz": 14, "GRAD": -50 }`.
A `wght` entry overrides `weight`, which is how a weight between steps (350) is
written: the step stays as the value a static face is picked by. A span's
`variations` are merged over the element's. A static face ignores every axis,
and the stylesheet a `google` descriptor points at must request the axes a
template uses.

### OpenType features

`features` sets OpenType features by tag, on the element's `font` or a span's:
`{ "tnum": 1, "liga": 0, "ss01": 1, "salt": 2 }`. 1 turns a feature on, 0 off,
and a larger whole number picks an alternate. A span's `features` are merged
over the element's. A feature the face doesn't have is ignored.

### Vertical trim

`leadingTrim: true` on a text element is Figma's "Vertical trim: cap height to
baseline" — the cap line tucks against the box top. It is an **opt-in**, as in
Figma: without it the first baseline sits at half the leading plus the ascent,
which is where Figma puts it. (Compiling the trim by default lifted every block
by about `ascent − capHeight` — 0.39em in Vend Sans — above the layer it came
from.)

### Text on an arc

`arc` (1.6) sets a text element along a circle centered on its box, for seals,
badges and circular labels. Each hard line is one ring and nothing wraps.

```json
"arc": { "direction": "inside", "startAngle": 180, "align": "center" }
```

| Field | Meaning | Default |
|---|---|---|
| `radius` | Baseline radius of the first ring, in design units | Fits the glyphs inside the box |
| `startAngle` | Degrees clockwise from 12 o'clock where `align` anchors the ring | `0` |
| `direction` | `outside` reads clockwise with tops outward; `inside` reads counter-clockwise with tops inward | `outside` |
| `align` | `start`, `center` or `end` of the ring at `startAngle` | `center` |
| `sweep` | Spreads each ring's glyphs across this many degrees | Natural spacing |

Glyphs come from the same shaping as straight text, so ligatures, variable
axes and per-glyph font fallback carry over. Decorations are not drawn on an
arc.

### Per-span line height

A span's `font.lineHeight` (a number or `"auto"`) is that span's own line box,
not decoration: Figma lets one text layer set 132% on its first line and Auto on
the rest, and each line is stacked by the box its own spans ask for. Font sizes
come through fractional (Figma's are routinely 14.11, and rounding one to 14
costs a pixel per line down a block).

### `lineHeight: "auto"`

A text element may say `lineHeight: "auto"` instead of a number: the font's own
line box (typo ascent + descent + line gap), which is what a design tool shows
as "Auto" and what its auto-height layers are sized by. It is per family — Vend
Sans is 1.48 — so it can only be resolved once the font is known, which the
render does. `compile()` marks the node and leaves `1.2` on it as the value a
consumer that ignores the mark will use, so a family whose metrics never arrive
renders exactly as it did before.

## Text layout

A newline in `value` or a span's `text` is a hard line break; other runs of
whitespace collapse to one space (CSS `white-space: pre-line`).
`paragraphSpacing` adds that much space after each hard break, in the same units
as `size`, and shrink-to-fit and a hug height both count it.

`fit: "shrink"` lowers the font size, in whole pixels down to 8, until the text
fits the box's height. With `spans`, every span's size and letter spacing scale
by the same factor, searched on the largest span's size, so their proportions
hold.

`direction` is the paragraph's base direction for bidirectional text: `ltr`
(the default), `rtl`, or `auto`, which takes the first letter of the resolved
text (after `{{field}}` substitution), as HTML's `dir="auto"` does.

`align` is `left`, `center`, `right`, `justify`, `start` or `end`. `start` and
`end` follow the direction; `left` and `right` never flip. Without `align`, text
sets to `left`, or to `start` when a `direction` is given. A justified paragraph
stretches the spaces of every line but its last, which `alignLast` sets
(`start` by default, or any other `align` value). A line with no space to
stretch stays at its natural width.

## Spec

The format is defined by the zod schemas in `src/schemas.ts`; `validate()` is
the reference check, including the cross-field rules zod alone does not express.

## Fixtures

`@freshcoat-js/coatfile/fixtures` exports two canonical templates and their expected
compile outputs for snapshot testing in consumers.

## Test runner

`bun test` runs the suite (vitest-style tests, run natively by bun).

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
