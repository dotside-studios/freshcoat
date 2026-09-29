# @freshcoat-js/engine

The 2D rendering engine behind [Freshcoat](../../README.md), named
`@freshcoat-js/engine` in the workspace. It lays out a scene graph,
shapes text and paints with CanvasKit (Skia compiled to WASM).

Use it directly when your application supplies its own scene: previews,
generated images or an interactive canvas. For `.coat` templates and field
substitution, start with [`@freshcoat-js/coatfile`](../coatfile), which compiles
templates into engine nodes.

The scene and command types are independent of the backend; the supplied
painter uses CanvasKit. Browser and headless environments share that paint
path. Template fields, variants and frame selection belong to coatfile;
card-printer correction policy belongs to
[`@freshcoat-js/for-print`](../for-print).

## Quick start

With an initialized CanvasKit instance (`ck`), render a scene offscreen:

```ts
import type { RectNode } from "@freshcoat-js/engine";
import { renderSceneToPng } from "@freshcoat-js/engine/headless";

const root: RectNode = {
  kind: "rect",
  pos: { x: 0, y: 0 },
  size: { width: 640, height: 360 },
  fills: [{ kind: "solid", color: "#1f6fe8" }],
};

const result = await renderSceneToPng(root, { width: 640, height: 360, ck });
// result.bytes — PNG bytes by default; result.warnings — paint diagnostics
```

You supply CanvasKit initialization and the WASM file location for your host.
For text, also supply a `fonts` map of family names to font byte arrays; the
helper derives font metrics and creates the Paragraph text engine.

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
executes. Use this lower-level path when you need to inspect commands or keep
a runtime alive across renders. The types in [`src/node.ts`](src/node.ts)
define the scene model.

```ts
import { compileScene } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";

const commands = compileScene(root, { width, height, textEngine });
const env = createHeadlessEnv({ fonts });
const result = await env.paint(commands, ck);
```

## Painting and text

The supplied text engine uses CanvasKit Paragraph for layout and shaping,
keeping measurement and painting on the same text implementation. On the
lower-level path, pass a `textEngine` to resolve layout and unbaked text, or
supply a scene with resolved geometry and baked text.

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

Gradients, masks, blend modes and per-layer `Adjust` (color matrix, lookup
table and sharpening) are engine operations. `FrameFinish` applies operations
after the whole scene is composited. The engine implements these operations;
the caller decides when and where to use them.

A node holds one `Adjust`. `composeAdjust(first, second)` folds a second one
onto a layer that already has its own, baking the second into a 3D lookup
table so the result matches applying them in turn.

An image node's `crop` selects a region of its source, in fractions of the
source's width and height, before `fit` places it. `focus` is the point of that
region `cover` keeps centred in the box, held inside the source's edges.
`crop` does not apply to `tile`, which repeats the whole source.

## SVG images

An image node whose bytes are SVG paints as vector art, in the browser,
workers and headless runtimes alike. The painter reads it with `parseSvg`,
lowers it with `svgToNode` and draws it with the node's fit, mask and stroke,
so it stays sharp at every export density. Text, embedded images, patterns,
filters and markers are not drawn; each one used is reported once per source
as an `svg_unsupported` warning.

## Subpaths

The barrel stays free of DOM and WASM weight; the paint target lives on its
own subpath.

| Subpath | What it is |
|---|---|
| `@freshcoat-js/engine` | node types, `compileScene`, layout, adjust and export-scale math |
| `@freshcoat-js/engine/browser` | a runtime backing a live DOM canvas — the editor's preview |
| `@freshcoat-js/engine/headless` | offscreen painting to PNG, napi-free — server previews, OG images |
| `@freshcoat-js/engine/runtime` | the backend seam: `Painter` and `makeRuntime` |
| `@freshcoat-js/engine/path` | SVG path data parsing and maths |
| `@freshcoat-js/engine/svg` | SVG documents read without a DOM: `parseSvg`, `svgToNode` |

## Staying warm

For repeated renders, reuse a paint runtime with `createPaintCache` and a
text engine wrapped by `memoizeTextEngine`. The paint cache retains the
surface, font provider and decoded images; the text cache reuses unchanged
paragraph layouts. Studio's render session uses both. See
[Studio performance](../../apps/editor/docs/performance.md) for historical
integration benchmarks and their conditions.

For exports, `exportPixelSize` resolves density within
`MAX_EXPORT_DIMENSION`. The headless runtime encodes PNG by default, with
JPEG and WebP available through its `encode` options. Export scale changes
the output pixel dimensions; supersampling renders at a higher density and
reduces to the requested output size.

## Conformance

From this package directory, `bun run conformance` reports the golden-image
suite, and `bun run conformance:regen` authors cases and regenerates goldens.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
