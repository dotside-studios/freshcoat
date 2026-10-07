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

Gradients, masks, blend modes (linear burn runs as a runtime blender, since
Skia has no native mode for it) and per-layer `Adjust` (color matrix, lookup
table and sharpening) are engine operations. `FrameFinish` applies operations
(a per-channel curve, white and black thresholds, dither) after the whole scene
is composited. The engine implements these operations;
the caller decides when and where to use them.

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
5. **Layer blur**.
6. **Shadows**: each cast from the silhouette steps 1 to 5 leave, never from
   another shadow. Drop shadows go under the content and inner shadows over it,
   each in its own `color`.
7. **Opacity**, on the whole layer, shadows included.
8. **Blend**: the layer composites onto its parent with `blendMode`.

Adjust does not recolor shadows. A shadow's color is set on the shadow, so a
LUT or matrix that also recolored it would make that color depend on the
grade: a warm grade would tint a neutral shadow and a gamma curve would darken
it, and the only way back to the color asked for would be to invert the grade.
Figma treats them the same way. Sharpen runs before blur, so a blurred layer is
never re-sharpened. Shadows follow the blur, so a blurred layer casts a soft
shadow; for drop shadows without spread this is the same as blurring the
shadow with the layer.

An image node's `crop` selects a region of its source, in fractions of the
source's width and height, before `fit` places it. `focus` is the point of that
region `cover` keeps centred in the box, held inside the source's edges.
`crop` does not apply to `tile`, which repeats the whole source.

## SVG images

An image node whose bytes are SVG paints as vector art, in the browser,
workers and headless runtimes alike. The painter reads it with `parseSvg`,
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
| `@freshcoat-js/engine/svg/sniff` | `isSvg` alone, to sniff a source without loading the parser |

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
  cache's background snapshots. Set it with `compileScene`,
  `renderSceneToPng` or a `createCanvas` command's `precision`.
- **Gradients.** Stops interpolate between unpremultiplied sRGB-encoded
  colors, which is Skia's default.
- **Luminance masks and LUTs.** A luminance mask's coverage is the Rec. 709
  luminance (0.2126, 0.7152, 0.0722) of the mask's encoded sRGB channels,
  times its alpha. A per-channel
  `lut`, a `lut3d` and the finish `curve` are indexed by 8-bit encoded sRGB
  levels, and their textures are unpremultiplied `RGBA_8888`. Under F16 a
  layer is still looked up by its nearest 8-bit level, so a LUT carries 8-bit
  precision whatever the working precision.
- **Output.** The output surface and every readback (`readPixels`, encoding)
  are 8-bit, unpremultiplied, sRGB. The engine's PNG writer adds no `sRGB`,
  `gAMA`, `iCCP` or `cHRM` chunk, and an untagged PNG is read as sRGB.
  Skia's PNG writer, used only as a fallback, writes an `sRGB` chunk. JPEG and
  WebP come from Skia's encoders, which embed the snapshot's sRGB ICC profile.
  JPEG is flattened over white first.

## Conformance

From this package directory, `bun run conformance` reports the golden-image
suite, and `bun run conformance:regen` authors cases and regenerates goldens.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
