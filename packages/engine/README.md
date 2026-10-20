# @freshcoat-js/engine

The 2D rendering engine behind [Freshcoat](../../README.md), named
`@freshcoat-js/engine` in the workspace. It lays out a scene graph,
shapes text and paints with CanvasKit (Skia compiled to WASM).

Use it directly when your application supplies its own scene: previews,
generated images or an interactive canvas. For `.coat` templates and field
substitution, start with [`@freshcoat-js/coatfile`](../coatfile), which compiles
templates into engine nodes.

The scene and command types are independent of the backend; the painter uses
CanvasKit, the same in Node, a page and a worker. Template fields, variants and frame selection belong to coatfile;
card-printer correction policy belongs to
[`@freshcoat-js/for-print`](../for-print).

## Quick start

```sh
npm install @freshcoat-js/engine
```

Create a renderer with a CanvasKit instance and render a scene:

```ts
import { createRenderer, type RectNode } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/node"; // or /browser

const renderer = await createRenderer({ ck: await loadCanvasKit() });

const root: RectNode = {
  kind: "rect",
  pos: { x: 0, y: 0 },
  size: { width: 640, height: 360 },
  fills: [{ kind: "solid", color: "#1f6fe8" }],
};

const result = await renderer.render(root, { width: 640, height: 360 });
// result.bytes: PNG by default; result.warnings: paint diagnostics
```

The engine depends on the `canvaskit-wasm` version its conformance goldens were
made with. `loadCanvasKit` from `@freshcoat-js/engine/node` creates the
instance in Node or Bun; from `@freshcoat-js/engine/browser` it loads
`canvaskit.js` and `canvaskit.wasm` from a URL on a page or in a worker.

## Renderer

A renderer owns its CanvasKit instance, its fonts, the Paragraph text engine
and metrics built from them, and a paint cache that keeps the surface, font
provider and decoded images between renders. Create one per process or worker
and keep it; `dispose()` frees everything once any paint in flight finishes.

```ts
const renderer = await createRenderer({
  ck,
  fonts: { Geist: [geistBytes] },       // bytes, or srcs read through `load`
  load: fileLoader({ root: "./assets" }),
  cache: { maxImagePixels: 48_000_000 }, // or false
  maxImageDecodePixels: 8192 * 8192,     // the default; see "Size limits"
});
```

The output is chosen per render, and the result's type follows it:

```ts
await renderer.render(scene, { width, height });                     // { bytes, format }
await renderer.render(scene, { width, height, scale: 2, output: { encode: { format: "webp", quality: 90 } } });
await renderer.render(scene, { width, height, output: { pixels: true } }); // { pixels }
```

`scale` sets the density of the result; `export` takes a Figma-style export
setting instead. JPEG and WebP need the `full` CanvasKit build; a build
without the encoder answers in PNG and says so in `format`.

A fully opaque frame is written as an RGB PNG unless `effort: "best"` finds
RGBA smaller. `alpha: "keep"` always writes RGBA, for a consumer that requires
a 32-bit PNG, such as a Google Play store icon. It applies to PNG only, and
`encodePng` takes the same option:

```ts
await renderer.render(scene, { width, height, output: { encode: { format: "png", alpha: "keep" } } });
await encodePng(pixels, width, height, { alpha: "keep" });
```

The `canvas` output keeps the painted canvas live for display. It needs a
`surface` factory, which makes the canvas each surface is painted on: a DOM
`<canvas>`, or an `OffscreenCanvas` in a worker. With a cache the renderer
reuses that canvas on the next paint.

Paints run one at a time. `images` on a render supplies bytes for that render
only; a src whose bytes change between renders is decoded again, so a
per-request logo is never served from an earlier request. Fonts can be added
later with `addFonts`, and `loadFonts` loads the families that font requests
describe, once per descriptor. `clear()` frees the cache, as after a lost GPU
context, once any paint in flight finishes.

`prepare`, `compile` and `paint` are the steps `render` runs, for callers that
read the laid-out scene or the command list in between.

Images and local font files are read through the renderer's byte loader.
`fetchLoader` (the default) decodes `data:` URLs and fetches `blob:` and
`https:` URLs. It refuses every other scheme, `http:` and `file:` included, with
an error that names it, because a template chooses these URLs. A relative URL
resolves against `location` in a browser and is refused where there is none.
Pass your own `load` to allow more. Font URLs follow the same policy unless you
pass your own `fetch` to `fontBytes`.

`createFetchLoader({ unsafeAllowHttp: true })` also allows `http:`. It is
unsafe: http is plaintext, and a template can aim it at internal services such
as `http://localhost:6379/` or a cloud metadata address. Use it only when you
trust every template you render. It never allows `file:`, `ftp:` or other
schemes, and fonts loaded through that loader get the same allowance. Its
`fetch` option swaps the global `fetch`. See
[safer defaults](../../docs/security-defaults.md).
`mapLoader(bytes, next)` serves bytes you hold first. In Node or Bun,
`fileLoader` from `@freshcoat-js/engine/node` reads relative paths and `file:`
URLs under a root directory and refuses anything outside it, passing other
URLs to `next`.

### Size limits

Untrusted bytes are checked before they are decoded, so a small file cannot
make the decoder allocate a huge buffer.

- **Image pixels.** The width and height in an image's header (PNG, JPEG, GIF,
  WebP, BMP, ICO, WBMP, AVIF) are read first, and an image over
  `maxImageDecodePixels` is never handed to CanvasKit. It paints as a
  placeholder and the frame carries an `image_load_failed` warning. The default is 8192 * 8192 (about 67 million
  pixels), a square at the 8192 export edge cap and about 268 MB of RGBA once
  decoded; raise it for a renderer that needs larger sources. The same check
  guards images nested in SVG and `decodePixels` / `sampleImageNode`
  (`maxPixels`), which throw. `maxImagePixels` on `cache` is a different
  setting: it only decides which decoded images stay cached.
- **Unreadable headers.** An image whose header cannot be read is refused, the
  same way: truncated or corrupt files, and formats the header reader does not
  know (BMP, ICO, AVIF). Their dimensions cannot be checked, and a refused
  format costs a warning where an unchecked one can cost the WASM heap.
- **WOFF and WOFF2 fonts.** No more than 128 MiB may unpack from one font. A WOFF
  table's `origLength` and the sum over its tables are checked against that cap
  before anything is inflated, and each table inflates into a buffer of exactly
  its declared length, so a stream that is longer or shorter than declared is
  rejected. A WOFF2 file's declared table sizes are summed and checked against
  the cap, the Brotli stream is decoded into a buffer of exactly that size, and
  a stream that overflows or falls short is rejected. A rejected font reports
  `font_load_failed`.

## Node IR

Eight node kinds — `rect | ellipse | path | image | bitmap | text | group |
mask` — describe shapes, assets, text and composition. Nodes share positioning
and compositing properties, with fills, strokes and other options appropriate
to each kind. Groups support flex and grid layout.

A stroke's `align` (`center`, `inside` or `outside`) is honored on every
stroked node. Rects, ellipses and masked images stroke their outline inset or
outset by half the width; a path strokes at twice the width, clipped to its
own interior or exterior under its `fillRule`. `trimStart`, `trimEnd` and
`trimOffset` draw part of the stroke, as fractions of the outline's length. A
rect trims clockwise from its top left, an ellipse clockwise from its top and a
path along its own direction. The trim cuts the outline before the `dash`
pattern, so dashes start at the trimmed start and caps sit on the trimmed
ends. A text node's `stroke` takes `color` or `gradient`, `width`, `join` and
`align`: `center` strokes over the fill, `outside` draws twice the width under
it and `inside` twice the width kept where the glyphs cover.

A rect's stroke can carry `sides`, a width for each of `top`, `right`,
`bottom` and `left`, in place of `width` (which then holds the widest, for
anything that reads one). The rect paints the band between its outline moved
out and moved in by each side's width as `align` places it, as one even-odd
filled path. A rounded corner's radius moves by its two adjacent widths, one
on each axis, so it turns elliptical where they differ; with
`cornerSmoothing` it moves by their mean. A sharp corner stays sharp, so
`join` does not apply. A `dash` or a trim runs along the middle of the band,
around the whole outline from the top left, and is cut to the band, so each
dash is as thick as the side it lies on. Other nodes ignore `sides`.

A clipping group's
`cornerRadius` can be one number or per-corner `[tl, tr, br, bl]`.

`compileScene()` lowers a node tree to the flat `Command[]` list the painter
executes. With `approxEngine` as its text engine it needs no CanvasKit, which
suits a rough preview drawn some other way. The types in
[`src/node.ts`](src/node.ts) define the scene model.

## Painting and text

The supplied text engine uses CanvasKit Paragraph for layout and shaping,
keeping measurement and painting on the same text implementation. A renderer
builds it from its fonts.

A text node's `align` is `left`, `center`, `right`, `justify`, `start` or
`end`, and its `direction` (`ltr`, `rtl` or `auto`, from the first letter) sets
the base direction the paragraph is shaped in and what `start` and `end` mean.
Justified lines are baked with a per-line `wordSpacing` that the painter shapes
with, so every line but a paragraph's last meets both edges of the box;
`alignLast` sets that last line. A right-to-left line is baked with
`direction: "rtl"`, and the painter shapes it in that direction so bidi runs
land where the baked span boxes say. A font's `features` (OpenType tags to
values) are passed to shaping for both measurement and paint. A newline is a
hard break, and `paragraphSpacing` is baked into the line positions after
each one. `fit: "shrink"` works on styled spans as well as single-style text,
scaling every span by one factor; the approximate engine, which cannot shape
spans together, does not shrink them.

The Paragraph engine reports the codepoints no registered font covers as
`missing` on each layout, and `missingGlyphs(commands)` lists the text commands
that would paint them as boxes, with their node ids, without shaping again.

Gradients, masks, blend modes (linear burn runs as a runtime blender, since
Skia has no native mode for it) and per-layer `Adjust` (color matrix, lookup
table and sharpening) are engine operations. `FrameFinish` applies operations
(a per-channel curve, white and black thresholds, dither) after the whole scene
is composited. The engine implements these operations;
the caller decides when and where to use them.

A `pattern` fill is a procedural texture: `noise`, `paper`, `hatching` or
`dots`, each a runtime effect compiled once per CanvasKit instance. Noise and
paper sample `Shader.MakeFractalNoise` and `Shader.MakeTurbulence` with the
fill's `seed`. A pattern is measured in design units from the drawable's
top-left, so the canvas matrix carries it to every export density and
supersample level, and the same fill paints the same texture in every
renderer. Hatching and dots antialias their edges over one device pixel, and
any pattern whose features shrink below a pixel fades to its mean coverage
instead of aliasing. `patternFill(kind, params)` builds one with
`PATTERN_DEFAULTS` for the parameters it omits.

A luminance mask's coverage is its luminance times its alpha, as in SVG 1.1
masking. Luminance uses Rec. 709 weights on the sRGB-encoded color, not on
linearRGB as SVG's default `color-interpolation` would.

A node holds one `Adjust`. `composeAdjust(first, second)` folds a second one
onto a layer that already has its own, baking the second into a 3D lookup
table so the result matches applying them in turn.

### Layer effect order

Every paint path applies one drawable's effects in this order:

0. **Backdrop blur**: what lies beneath the drawable's shape is replaced by its
   blur before the drawable draws. The shape is its clip, else its outline (a
   rect's rounded corners, a path's fill) or a group's rounded box, else its
   box. It follows the drawable's `rotation` and `opacity`, not its blend mode.
   It reads only the layer it is drawn into, so inside an isolated group, a
   group with its own layer effects or a mask it sees that group's content.
1. **Content**: the drawable's fills, strokes, text or children, under its
   `rotation`.
2. **Clip and mask**: a clipping group's shape or a mask node's coverage.
3. **Color adjust**: `colorMatrix`, then the `preserve-hue` gamut map, then the
   per-channel `lut`, then the 3D `lut3d`. Colors are adjusted unpremultiplied,
   so alpha is untouched unless the matrix has alpha terms.
4. **Sharpen**: the unsharp mask, on the adjusted colors.
5. **Halftone**: the layer redrawn as dots or lines (see below).
6. **Grain**.
7. **Layer blur**.
8. **Shadows**: each cast from the silhouette steps 1 to 7 leave, never from
   another shadow. Drop shadows go under the content and inner shadows over it,
   each in its own `color`.
9. **Opacity**, on the whole layer, shadows included.
10. **Blend**: the layer composites onto its parent with `blendMode`.

Adjust does not recolor shadows. A shadow's color is set on the shadow, so a
LUT or matrix that also recolored it would make that color depend on the
grade: a warm grade would tint a neutral shadow and a gamma curve would darken
it, and the only way back to the color asked for would be to invert the grade.
Figma treats them the same way. Sharpen runs before blur, so a blurred layer is
never re-sharpened. Shadows follow the blur, so a blurred layer casts a soft
shadow; for drop shadows without spread this is the same as blurring the
shadow with the layer.

### Grain and halftone

`grain` and `halftone` on a node are texture effects, painted by an offscreen
SkSL pass over the layer's own pixels. Both are measured in design units, so a
2× export draws the same grains and dots on four times the pixels. Grain is in
the layer's own space, after its `rotation` and any parent transform, and
moves with the layer. A halftone's `anchor` picks its space:

- `"page"` (the default) lays one screen over the whole scene, in scene units
  from `origin` (default `0, 0`), as a printed page has one screen at fixed
  angles. Neighbouring layers share a grid, so two halftoned shapes that meet
  show no seam, and neither a layer's `rotation` nor a parent's turns the
  screen. A scene that adds bleed around the page, or is one piece cut from
  it, sets `origin` to where the page's top-left lands, so every such render
  draws the same screen. The painter's own `origin` (a PDF raster tile, a
  panned view) does not move it.
- `"element"` starts the grid at the layer's `pos` and turns it with the
  layer.

```ts
createRect({
  // ...
  grain: { amount: 0.3, size: 1, monochrome: true, blendMode: "overlay", seed: 7 },
  halftone: { mode: "mono", shape: "round", cellSize: 6, angle: 45, invert: false, anchor: "page", color: "#000" },
});
```

- **Grain** adds one hashed value per `size`-unit square, blended into the
  layer's colors by `blendMode` (`normal`, `overlay`, `soft-light`,
  `multiply` or `screen`) at `amount` (0 to 1). The hash is integer arithmetic
  in floats, not `Math.random` or a `sin` hash, so a `seed` paints the same
  pixels in every run, worker and backend. Seeds repeat every 83,521.
- **Halftone** samples the layer over each `cellSize` cell of a screen turned
  by `angle` and draws a `round`, `square` or `line` dot whose area is the
  cell's darkness (its lightness with `invert`), in `color` over an optional
  `background`. Dot edges are box-filtered, so the tone holds at any density.
  `mode: "cmyk"` draws four screens at C 15°, M 75°, Y 0° and K 45° (each plus
  `angle`) in process-ink colors, multiplied together. It is a look, not
  colour separations. Dots stay inside the layer's own coverage.

  A cell's colour is the alpha-weighted mean of its samples, so the
  transparent part of a cell on a shape's edge doesn't lighten it: a solid
  fill or bold text keeps full dots up to its outline, which clips them.
  Alpha that jumps across one device pixel is read as that outline. Any other
  alpha (a fade to transparent, a blur) is translucency: the dot's area is the
  cell's tone times its most opaque sample's alpha, and the dot is drawn
  unfaded, so soft content breaks into smaller dots in proportion to its
  alpha.

Both need runtime effects (`RuntimeEffect.Make`), which the default CanvasKit
build has; the `full` build is not required. A build without them, or a
shader that fails to compile, paints the layer without the effect and reports
an `effect_unsupported` warning. In a PDF they are rasterized at `rasterDpi`.

An image node's `crop` selects a region of its source, in fractions of the
source's width and height, before `fit` places it. `focus` is the point of that
region `cover` keeps centred in the box, held inside the source's edges.
`crop` does not apply to `tile`, which repeats the whole source.

## SVG images

An image node whose bytes are SVG paints as vector art, on a page, in a
worker and in Node alike. The painter reads it with `parseSvg`,
lowers it with `svgToNode` and draws it with the node's fit, mask and stroke,
so it stays sharp at every export density. Markers and pattern fills are
expanded into ordinary paths, and images embedded as `data:` URLs are drawn,
raster or SVG. Filters built from `feGaussianBlur`, `feDropShadow`,
`feOffset`, `feColorMatrix`, `feFlood`, `feMerge`, `feComposite` (except
`arithmetic`) and `feBlend` are applied, in sRGB or linearRGB as
`color-interpolation-filters` asks; an element whose filter uses any other
primitive is drawn unfiltered, with a warning naming the primitive. Text,
`foreignObject`, video and audio are not drawn; each one used is reported once
per source as an `svg_unsupported` warning.

`parseSvg` itself reads `<text>` and `<tspan>` as lines of styled runs (font
family, size, weight, style and fill, anchored at the baseline) for callers
that can shape them, such as coatfile's `svgToElements`. A pattern's tiles are
not clipped to the tile, and a pattern of more than 1,000 tiles uses its
fallback color.

## PDF output

`renderer.renderPdf(scene, { width, height, dpi })` lays the scene out as
`render` does and writes one PDF page, `dpi` design units to the inch.
`renderer.paintPdf(commands)` does the same for a compiled scene. Shapes,
solid fills, linear and radial gradients (elliptical and focal ones too, with
transparent stops drawn through a soft mask), solid and gradient strokes
(aligned, dashed, capped, joined and trimmed, and a rect's per-side band), clips, opacity, isolated groups,
the blend modes PDF defines, images and SVG images are drawn as vectors. A gray
or RGB JPEG is embedded as it is, in `DeviceGray` or `DeviceRGB` when it
carries no ICC profile and in an `ICCBased` space holding its own profile when
it does, each distinct profile stored once per PDF. A JPEG whose profile cannot
be read or does not match its components, and a CMYK or EXIF-rotated one, is
decoded to sRGB instead, as other images are. Text is shaped by CanvasKit
exactly as it renders and set in its own font file, embedded with a ToUnicode
map so it stays selectable, each glyph placed along its circle or path when the
text follows a curve. A solid text stroke is drawn with the glyphs in
stroke mode (`1 Tr`), an `inside` one clipped to them (`7 Tr`). That takes a TrueType, OpenType, WOFF or WOFF2 file. A
variable TrueType font is fixed at the instance the text uses before it is
embedded.

Any other layer is drawn by the CanvasKit painter into a transparent image at
`rasterDpi` (600 by default) and placed where it belongs, so it matches the
preview: shadows, blurs, `adjust`, grain, halftones, masks, pattern and angular fills, gradients
with a spread, strokes aligned to a path, embedded gradient-filled or
gradient-stroked text, synthetic bold, the `plus` and `linear-burn` blend
modes, text whose outlines do not read, and SVG images holding text or
filters. Bitmaps are drawn without smoothing.
Everything beneath a backdrop blur, or the whole page under a frame finish, is
one image. Each image layer is reported once as a `vector_rasterized` warning,
or, for each spot ink it or a layer it holds paints, as `spot_rasterized`
(`{ feature, layer, spot, paint }`) in its place, as the image loses the
Separation.

### Text as outlines

`text: "outline"` on `renderPdf` and `paintPdf` draws every glyph as a filled
path instead, so the file holds no font at all, as print shops that ask for
outlined text want. A text node's `pdfText: "outline"` does the same for that
layer alone, whatever the option says. The outlines are read from the font
file the text was shaped with (CanvasKit's wasm build exposes no glyph paths):
TrueType outlines, a variable font's fixed at its instance first, and CFF and
CFF2 charstrings, a CFF2 font's blended at its instance. Each glyph is placed
exactly where the embedded font would put it, along a curve too. Span
colours, decorations, opacity and blend modes are drawn as for embedded text,
and a solid or gradient stroke along the outlines, under the fill for
`outside` and clipped to it for `inside`. A gradient fill, which embedded text
draws as an image, is painted through the glyphs as a clip and stays vector.
Outlined text cannot be selected or searched.

Text in a font a PDF cannot embed, the first face of a font collection or a
CFF2 variable font, is drawn as outlines without asking.

A font's OS/2 `fsType` licensing flags are honoured too. A font with the
restricted license bit (0x0002), the no subsetting bit (0x0100, as the writer
always subsets) or the bitmap embedding only bit (0x0200) is not embedded: its
text is drawn as outlines, with a `font_embedding_restricted` warning naming the
family and layer. Preview & Print (0x0004), Editable (0x0008), installable (0)
and a font with no OS/2 table, which is common practice to allow, are embedded.

### Output intent

Every PDF declares an output intent in its catalog's `/OutputIntents`: a
`GTS_PDFX` intent whose `/DestOutputProfile` is the sRGB IEC61966-2.1 profile
the engine bundles ([`icc/sRGB-v2-magic.icc`](icc/sRGB-v2-magic.icc), 736
bytes, CC0), with `/OutputConditionIdentifier` and `/Info` set to
`sRGB IEC61966-2.1` and `/RegistryName` to `http://www.color.org`. No
`GTS_PDFXVersion` or PDF/A metadata is written, so the file claims neither
PDF/X nor PDF/A conformance; the intent only tells a RIP what the content was
prepared for.

The `outputIntent` option of `renderPdf` and `paintPdf` takes another
profile, such as a print shop's FOGRA39 or GRACoL CMYK profile:

```ts
await renderer.renderPdf(scene, {
	width,
	height,
	outputIntent: { profile: fogra39, identifier: "FOGRA39", registry: "http://www.color.org" },
});
```

`identifier` and `info` default to the profile's own description. Content stays
RGB; the intent names the condition the RIP converts it to. `false` writes no
intent. The profile must be an ICC v2 to v4 printer (`prtr`) or display
(`mntr`) profile in gray, RGB or CMYK, whose header size matches its length and
carries the `acsp` signature; anything else is refused with an error naming
what is wrong. `readIccProfile` on `@freshcoat-js/engine/icc` runs the same
checks and reads the description.

While an intent is declared, the page's resources map `/DefaultRGB` to an
`ICCBased` sRGB space and its transparency groups blend in it, so the
`DeviceRGB` fills, gradients and images are read as sRGB under a CMYK intent
too. The profile is one stream per PDF, shared with the intent when that is
sRGB and with any JPEG carrying the same bytes. With `false`, everything stays
`DeviceRGB` and nothing is tagged.

## Subpaths

The barrel stays free of DOM and Node APIs; platform code lives on its own
subpath.

| Subpath | What it is |
|---|---|
| `@freshcoat-js/engine` | `createRenderer`, node types, `compileScene`, layout, adjust and export-scale math, byte loaders, CR80 card size (`CR80_LONG_MM`, `CR80_SHORT_MM`, `cr80Pixels(dpi)`, …) |
| `@freshcoat-js/engine/node` | `loadCanvasKit`, `initCanvasKit`, `fileLoader`, `canvasKitBinDir` for Node and Bun |
| `@freshcoat-js/engine/browser` | `loadCanvasKit(baseUrl)` for a page or a worker |
| `@freshcoat-js/engine/path` | SVG path data parsing and maths |
| `@freshcoat-js/engine/pdf` | `paintPdf`, the PDF painter `renderPdf` and `paintPdf` call, for a runtime of your own; `mergeFontSubsets` and `subsetTag` for joining the font subsets of several PDFs |
| `@freshcoat-js/engine/svg` | SVG documents read without a DOM: `parseSvg`, `svgToNode` |
| `@freshcoat-js/engine/svg/sniff` | `isSvg` alone, to sniff a source without loading the parser |
| `@freshcoat-js/engine/icc` | `SRGB_PROFILE`, the bundled sRGB profile; `readIccProfile`, which checks a profile can be a PDF's destination output profile and reads its description; `SRGB_OUTPUT_INTENT` and `resolveOutputIntent` |
| `@freshcoat-js/engine/image` | PNG, JPEG, GIF, WebP, BMP, ICO, WBMP and AVIF size, EXIF orientation and capture time read from the file header, image type sniffing, `rgbIdat` for passing an RGB PNG's data through as is, and `jpegFrame`, `jpegIccProfile` and `iccComponents` for passing a JPEG through with its ICC profile |

## Staying warm

For repeated renders, keep one renderer. Its paint cache retains the surface,
font provider and decoded images, and its text engine reuses unchanged
paragraph layouts. Studio's render session and export workers each keep one.
See
[Studio performance](../../apps/editor/docs/performance.md) for historical
integration benchmarks and their conditions.

For exports, `exportPixelSize` resolves density within
`MAX_EXPORT_DIMENSION`. Export scale changes
the output pixel dimensions; supersampling renders at a higher density and
reduces to the requested output size.

## Color policy

Every surface and image the painter allocates gets its `ImageInfo` from
[`src/color-policy.ts`](src/color-policy.ts), which assigns each buffer a role.
Skia's [color guide](https://docs.skia.org/docs/user/color/) covers the
underlying model.

- **Working space.** Everything is sRGB, and blending and filtering run on
  sRGB-encoded values, not linear light. Blend modes, opacity, blur, shadows,
  color matrices and supersample reduction all work on encoded values, and so
  does the frame finish. Every surface is tagged `ColorSpace.SRGB`, so Skia
  does no color conversion between them.
- **Precision.** By default (`precision: "u8"`) the scene and every offscreen
  layer (adjust passes, `saveLayer` groups, masks and supersample levels) are
  premultiplied `RGBA_8888`. With `precision: "f16"` the scene composites
  into an `RGBA_F16` working surface, and its layers and reduction levels are
  F16 too. The result is quantized to 8 bits once, when it is copied to the
  output. Use F16 when a layer goes through several passes in sequence, such as
  stacked adjusts or a deep group of color-filtered layers, where each 8-bit
  pass would round again and band smooth gradients. Skia's image filters (layer
  blur, shadows, and a layer's color matrix when it has to run before those or
  before opacity) still produce 8-bit results, so F16 does not help those
  steps. It costs twice the memory per layer, and it turns off the paint
  cache's background snapshots. Set it with the `precision` option of
  `renderer.render`, the `precision` option of `compileScene` (or
  `renderer.compile`), or a `createCanvas` command's `precision`.
- **Gradients.** Stops interpolate between unpremultiplied sRGB-encoded
  colors, which is Skia's default.
- **Patterns.** A pattern mixes its two colors premultiplied, so a
  transparent color never tints the other's edge.
- **Luminance masks and LUTs.** A luminance mask's coverage is the Rec. 709
  luminance (0.2126, 0.7152, 0.0722) of the mask's encoded sRGB channels,
  times its alpha. A per-channel
  `lut`, a `lut3d` and the finish `curve` are indexed by 8-bit encoded sRGB
  levels, and their textures are unpremultiplied `RGBA_8888`. Under F16 a
  layer is still looked up by its nearest 8-bit level, so a LUT carries 8-bit
  precision whatever the working precision.
- **Output.** The output surface and every readback (`readPixels`, encoding)
  are 8-bit, unpremultiplied, sRGB. The engine's PNG writer tags every PNG
  with an `sRGB` chunk (perceptual intent) and the `gAMA` and `cHRM` values
  the PNG spec gives alongside it, for readers that do not know `sRGB`.
  Skia's PNG writer, used only as a fallback, writes an `sRGB` chunk. JPEG and
  WebP come from Skia's encoders, which embed the snapshot's sRGB ICC profile.
  JPEG is flattened over white first. A PDF declares an sRGB output intent and
  tags its RGB content as sRGB through `/DefaultRGB` (see
  [Output intent](#output-intent)). A caller's CMYK intent changes what the
  PDF says it was prepared for, not its content: no colour is converted to
  CMYK here, and there is no soft-proof.
- **Spot colours.** A solid fill or a solid stroke can carry a `spot`
  (`{ name, tint, overprint }`). A vector PDF paints it in a `/Separation`
  colour space of that name, whose tint transform runs from white to the
  fill's or stroke's own `color` in `DeviceRGB`, so a viewer without the ink
  shows that alternate. With `overprint`, an ExtGState sets `/OP true /op true
  /OPM 1` so the ink prints over what lies beneath it rather than knocking it
  out. Every other output paints the alternate at the tint, mixed with white
  as the tint transform runs, so a raster render matches the PDF. A layer the
  PDF painter has to rasterize loses its spot colour, with a `spot_rasterized`
  warning. Names are the caller's
  own: there is no Pantone or other library.

## Conformance

From this package directory, `bun run conformance` reports the golden-image
suite, and `bun run conformance:regen` authors cases and regenerates goldens.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
