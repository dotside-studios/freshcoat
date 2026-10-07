# Renderer API sketch

Status: draft for review. Nothing here is implemented yet.

## Decisions this builds on

1. CanvasKit is the only backend. `ck` is a typed `CanvasKit`, never `unknown`.
2. The scene types and the compiled command list stay backend-neutral, so a
   vector PDF painter can be added inside the engine later.
3. Only engine, for-print and coatfile are published. The `@freshcoat-js/canvaskit`
   package on the branch folds into engine, which depends on `canvaskit-wasm`
   directly at the version the conformance goldens use.
4. Engine subpaths name platforms only. The output (encoded bytes, pixels or a
   live canvas) is an option, not a subpath.

## What the consumers need

| Consumer | Platform | Needs |
|---|---|---|
| Davi worker | Bun server | One CanvasKit per process, PNG or WebP chosen per request, per-request image bytes, up to 2 renders at once, raw scenes and templates, print planning |
| Davi order-site preview | browser main thread | Paint one side at `devicePixelRatio` onto its own 2D canvas, every keystroke, without leaking WebGL contexts |
| Davi order-site skeleton | browser, no CanvasKit | `compileScene` with `approxEngine`, drawn as SVG |
| Davi tools-site | browser | Exact PNG bytes of a scene, no WebGL |
| preceipt signs | Bun server | Template at 300 dpi as PNG, local Geist files, a per-request logo |
| Studio preview | browser main thread and worker | Live canvas, layout geometry before paint, fonts that change while editing |
| Studio export worker | browser worker | Encoded frames per record, decoded images reused across records |

## Package surface after the change

### `@freshcoat-js/engine` (platform-neutral)

```ts
// New
createRenderer(options): Renderer
type Renderer, RendererOptions, RenderOptions, RenderedFrame

// Unchanged
scene types and builders (createRect, createText, createFrame, ...)
compileScene, prepareScene, sceneAssets, approxEngine   // CanvasKit-free path
ByteLoader, fetchLoader, mapLoader, dataUrlToBytes
color, css, adjust, export-scale, encode option types, PaintWarning, ...
```

### `@freshcoat-js/engine/node`

```ts
loadCanvasKit(build?: "default" | "full"): Promise<CanvasKit> // shared per build, retried on failure
initCanvasKit(build?): Promise<CanvasKit>                      // a new instance per call
fileLoader({ root, next? }): ByteLoader
canvasKitBinDir(build?): string
canvasKitVersion: string
```

### `@freshcoat-js/engine/browser`

```ts
loadCanvasKit(baseUrl: string): Promise<CanvasKit> // page: script tag, worker: fetch + eval
```

### Removed or made internal

| Today | After |
|---|---|
| `engine/headless`: `createHeadlessEnv`, `renderSceneToPng` | `createRenderer` (offscreen is the default surface) |
| `engine/browser`: `createBrowserEnv` | `createRenderer({ surface })`; the subpath now holds the loader |
| `engine/runtime`: `makeRuntime`, `Painter`, `paintCanvasKit` | internal, used by the conformance runner |
| `PaintRuntime`, `CanvasHost`, `KeptPaintResult` | internal |
| `createParagraphEngine`, `deriveFontMetrics`, `memoizeTextEngine` | internal, owned by the renderer |
| `CanvasLike`, `CanvasRenderingContext2DLike`, `CanvasGradientLike`, `CanvasPatternLike` | removed, no users |
| `coatfile/headless`, `coatfile/browser` | removed (re-exports only) |
| `coatfile/render`: `render`, `RenderRuntime` | `renderTemplate`; `renderCompiled` takes a renderer |

## `createRenderer`

```ts
type RendererOptions = {
  ck: CanvasKit;
  // Image bytes and local font files. Default: fetchLoader.
  load?: ByteLoader;
  // Fonts known up front, by family. Bytes, or srcs read through `load`.
  fonts?: Record<string, Array<Uint8Array | string>>;
  // Where surfaces live. Default "offscreen" (CPU raster, exact pixels).
  // A factory gives GPU-backed surfaces on that canvas.
  surface?: "offscreen" | ((width: number, height: number) => HTMLCanvasElement | OffscreenCanvas);
  // Decoded images, SVG pictures and paths kept across renders. Default on.
  cache?: PaintCacheOptions | false;
};

type Renderer = {
  readonly ck: CanvasKit;

  // Compile and paint one scene.
  render(scene: Node, options: RenderOptions): Promise<RenderedFrame>;

  // The two halves, for callers that read layout before painting (Studio).
  prepare(scene: Node, options: SceneSize): Node;         // resolved layout, baked text
  compile(scene: Node, options: CompileOptions): Command[];
  paint(commands: Command[], options?: PaintOptions): Promise<RenderedFrame>;

  // Fonts can be added while the renderer lives. The text engine is rebuilt
  // lazily on the next render after a change.
  addFonts(fonts: Record<string, Array<Uint8Array | string>>): Promise<void>;
  loadFonts(requests: FontRequest[]): Promise<FontLoadResult>; // descriptors, via `load`

  stats(): RendererStats;
  dispose(): void;
};
```

### Per-render options

```ts
type RenderOptions = {
  width: number;                   // design size: layout happens here
  height: number;
  scale?: number;                  // export density, or:
  export?: ExportSetting;          // a Figma-style setting (scale, width or height)
  supersample?: number;
  finish?: FrameFinish;
  images?: Map<string, Uint8Array>; // bytes for this render only
  output?: Output;                 // default { encode: { format: "png" } }
};

type Output =
  | { encode: EncodeOptions }      // -> { bytes, format }
  | { pixels: true }               // -> { pixels: DecodedPixels }
  | { canvas: true };              // -> { canvas, release() }; needs a surface factory
```

`render` is typed by `output`, so callers never narrow a union:

```ts
const png = await renderer.render(scene, { width, height });                          // bytes
const webp = await renderer.render(scene, { width, height, output: { encode: { format: "webp", quality: 90 } } });
const px = await renderer.render(scene, { width, height, output: { pixels: true } });  // px.pixels
```

`RenderedFrame` always carries `warnings`, `width`, `height`, `scale` and
`supersample`, plus the output-specific field.

Why output is per call: the Davi worker picks PNG or WebP per request on one
CanvasKit, tools-site wants bytes in a browser, and order-site's preview only
needs pixels to blit. Only the `canvas` output depends on how the renderer was
created.

## `renderTemplate` and `renderCompiled` (coatfile/render)

```ts
renderTemplate(
  renderer: Renderer,
  template: Template,
  values: Record<string, unknown>,
  options?: TemplateRenderOptions,
): Promise<TemplateFrame[]>;

renderCompiled(
  renderer: Renderer,
  compiled: CompiledTemplate,
  options?: CompiledRenderOptions,
): Promise<TemplateFrame[]>;

type TemplateRenderOptions = {
  width?: number;                  // default template.width
  height?: number;                 // default template.height
  variantId?: string;
  frameNames?: string[];           // default: every frame
  bleed?: boolean;
  exports?: ExportSetting[];       // one frame per side per setting; default 1x
  print?: boolean | PrintRenderOptions;
  analysisCache?: AnalysisCache;
  images?: Map<string, Uint8Array>;
  output?: Output;
};

type TemplateFrame = RenderedFrame & { name: string; suffix?: string; trim?: Rect };
```

What `renderTemplate` does that callers do by hand today:

1. Loads the template's fonts through `renderer.loadFonts(collectFontRequests(template))`.
   A family that fails becomes a `font_load_failed` warning on each frame.
2. Loads the bwip barcode encoder lazily, only when the template has a 1D barcode
   and none is registered.
3. Defaults the size to the template's own.
4. Compiles, plans print corrections when asked, and paints each side.

## How each consumer would look

### Davi worker (Bun)

```ts
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/node";
import { renderCompiled, renderTemplate } from "@freshcoat-js/coatfile/render";

const renderer = createRenderer({ ck: await loadCanvasKit("full") });

const output = { encode: { format: req.options.format ?? "png", quality: req.options.quality } };
const frames = isRawRequest(req)
  ? [await renderer.render(req.raw.root, { width, height, images, output, export: req.options.exports?.[0] })]
  : await renderTemplate(renderer, req.template, req.options.values ?? {}, {
      width, height, variantId: req.options.variantId, frameNames: req.options.frames,
      exports: req.options.exports, print: req.options.print, images, output,
    });
```

Gone: its CanvasKit loader, its font cache (`resolveFonts`), `setBarcodeEncoder`
at module load, the `as EncodedPaintedFrame[]` cast, and wrapping raw scenes as a
one-frame compiled template. The hash-keyed asset cache stays; it feeds `images`.

### Davi order-site preview (browser)

```ts
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/browser";
import { renderTemplate } from "@freshcoat-js/coatfile/render";

const renderer = createRenderer({ ck: await loadCanvasKit("/canvaskit"), fonts });

const [frame] = await renderTemplate(renderer, template, values, {
  variantId, frameNames: [side],
  exports: [{ constraint: { kind: "scale", value: devicePixelRatio } }],
  output: { pixels: true },
});
ctx.putImageData(new ImageData(frame.pixels.data, frame.width, frame.height), 0, 0);
```

Gone: the WebGL surface per keystroke and its `dispose` loop, the
`as KeptPaintedFrame[]` cast, the hand-written loader. Barcodes start rendering
because the encoder is loaded on demand.

### Davi order-site skeleton

Unchanged: `compile`, then `compileScene` with `approxEngine`. No renderer, no CanvasKit.

### Davi tools-site

```ts
const renderer = createRenderer({ ck: await loadCanvasKit("/canvaskit") });
const { bytes } = await renderer.render(chartScene(spec), { width: spec.width, height: spec.height });
```

### preceipt signs (Bun)

```ts
const renderer = createRenderer({
  ck: await loadCanvasKit(),
  load: fileLoader({ root: geistFontDir }),
  fonts: { Geist: ["Geist-Regular.ttf", "Geist-Medium.ttf", "Geist-SemiBold.ttf", "Geist-Bold.ttf"] },
});

const [frame] = await renderTemplate(renderer, buildSignTemplate(style, input), signValues(input), {
  exports: [{ constraint: { kind: "width", value: px.width } }],
  images: logo ? new Map([[SIGN_LOGO_SRC, logo]]) : undefined,
});
frame.bytes; // PNG, no narrowing, no `as never`
```

### Studio preview (main thread or worker)

```ts
const renderer = createRenderer({
  ck,
  surface: (w, h) => new OffscreenCanvas(w, h), // or a DOM canvas on the main thread
  fonts,
});

const prepared = renderer.prepare(frame.root, design);
const geometry = collect(prepared);
const commands = renderer.compile(prepared, { ...design, prepared: true, scale });
const { canvas, release } = await renderer.paint(commands, { output: { canvas: true } });
```

`addFonts` replaces the session's `textFor`/`envFor` rebuild logic.

### Studio export worker

```ts
const renderer = createRenderer({ ck: await loadCanvasKit(FULL_BASE), fonts, load: (src) => bytesOf(src, own) });
const frames = await renderCompiled(renderer, compiled, { exports, print, output: { encode } });
```

The decoded-image reuse it gets from `loadImage` today comes from the
renderer's paint cache.

## Open questions

1. **Per-call images and the cache.** The paint cache keys decoded images by
   `src`. preceipt sends a different logo under the same `SIGN_LOGO_SRC` on every
   request, so a shared cache would serve the previous merchant's logo. Options:
   per-call `images` bypass the cache; or they are keyed by content (a cheap hash
   or the `Uint8Array` identity); or callers must use unique srcs. I lean towards
   keying per-call images by array identity and documenting that srcs from `load`
   are assumed stable.
2. **Concurrent renders.** The Davi worker runs 2 renders at once on one
   CanvasKit. Nothing in the paint cache guards against two paints in flight.
   Either `render` serializes internally (simple, and CanvasKit is single-threaded
   anyway), or the cache is made safe for overlapping paints. I lean towards
   serializing inside the renderer.
3. **`canvas` output lifetime.** A live canvas has to be released by the caller.
   `release()` on the frame, or does the renderer reuse one canvas per size and
   own it? Studio's live preview wants the second.
4. **Fonts keyed by family only.** `fonts` and `addFonts` are by family. Studio
   and the Davi worker also see the same family re-pointed at a different URL.
   Should a renderer key fonts by family plus descriptor, as the Davi worker does?
5. **Print sizing helper.** preceipt, Davi print runs and Studio sheets all
   convert millimetres at a dpi into an export setting. Worth an
   `ExportSetting` constraint like `{ kind: "print", widthMm, dpi }`?
6. **Vector PDF.** Not part of this change. The command list stays
   backend-neutral so a PDF painter can read it later; `Output` would gain
   `{ pdf: true }` then.
7. **Version.** This is a breaking change to engine and coatfile. Ship as 0.3.0
   together, with a migration note for Davi and preceipt.
