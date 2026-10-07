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
and keep it; `dispose()` frees everything.

```ts
const renderer = await createRenderer({
  ck,
  fonts: { Geist: [geistBytes] },       // bytes, or srcs read through `load`
  load: fileLoader({ root: "./assets" }),
  cache: { maxImagePixels: 48_000_000 }, // or false
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

The `canvas` output keeps the painted canvas live for display. It needs a
`surface` factory, which makes the canvas each surface is painted on: a DOM
`<canvas>`, or an `OffscreenCanvas` in a worker. With a cache the renderer
reuses that canvas on the next paint.

Paints run one at a time. `images` on a render supplies bytes for that render
only; a src whose bytes change between renders is decoded again, so a
per-request logo is never served from an earlier request. Fonts can be added
later with `addFonts`, and `loadFonts` loads the families that font requests
describe, once per descriptor. `clear()` frees the cache, as after a lost GPU
context.

`prepare`, `compile` and `paint` are the steps `render` runs, for callers that
read the laid-out scene or the command list in between.

Images and local font files are read through the renderer's byte loader.
`fetchLoader` (the default) decodes `data:` URLs and fetches the rest;
`mapLoader(bytes, next)` serves bytes you hold first. In Node or Bun,
`fileLoader` from `@freshcoat-js/engine/node` reads relative paths and `file:`
URLs under a root directory and refuses anything outside it, passing other
URLs to `next`.

## Node IR

Eight node kinds — `rect | ellipse | path | image | bitmap | text | group |
mask` — describe shapes, assets, text and composition. Nodes share positioning
and compositing properties, with fills, strokes and other options appropriate
to each kind. Groups support flex and grid layout.

A stroke's `align` (`center`, `inside` or `outside`) is honored on every
stroked node. Rects, ellipses and masked images stroke their outline inset or
outset by half the width; a path strokes at twice the width, clipped to its
own interior or exterior under its `fillRule`. A clipping group's
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

Gradients, masks, blend modes (linear burn runs as a runtime blender, since
Skia has no native mode for it) and per-layer `Adjust` (color matrix, lookup
table and sharpening) are engine operations. `FrameFinish` applies operations
(a per-channel curve, white and black thresholds, dither) after the whole scene
is composited. The engine implements these operations;
the caller decides when and where to use them.

A node holds one `Adjust`. `composeAdjust(first, second)` folds a second one
onto a layer that already has its own, baking the second into a 3D lookup
table so the result matches applying them in turn.

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
raster or SVG. Text, `foreignObject`, video, audio and filters are not drawn;
each one used is reported once per source as an `svg_unsupported` warning.

`parseSvg` itself reads `<text>` and `<tspan>` as lines of styled runs (font
family, size, weight, style and fill, anchored at the baseline) for callers
that can shape them, such as coatfile's `svgToElements`. A pattern's tiles are
not clipped to the tile, and a pattern of more than 1,000 tiles uses its
fallback color.

## Subpaths

The barrel stays free of DOM and Node APIs; platform code lives on its own
subpath.

| Subpath | What it is |
|---|---|
| `@freshcoat-js/engine` | `createRenderer`, node types, `compileScene`, layout, adjust and export-scale math, byte loaders |
| `@freshcoat-js/engine/node` | `loadCanvasKit`, `initCanvasKit`, `fileLoader`, `canvasKitBinDir` for Node and Bun |
| `@freshcoat-js/engine/browser` | `loadCanvasKit(baseUrl)` for a page or a worker |
| `@freshcoat-js/engine/path` | SVG path data parsing and maths |
| `@freshcoat-js/engine/svg` | SVG documents read without a DOM: `parseSvg`, `svgToNode` |
| `@freshcoat-js/engine/svg/sniff` | `isSvg` alone, to sniff a source without loading the parser |

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

## Conformance

From this package directory, `bun run conformance` reports the golden-image
suite, and `bun run conformance:regen` authors cases and regenerates goldens.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
