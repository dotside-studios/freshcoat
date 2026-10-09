# Migrating to 0.4

0.4 renders through one object, a renderer, instead of environments assembled
by the caller. CanvasKit is the engine's only backend, and the engine now
depends on the `canvaskit-wasm` version its conformance goldens use.

## Replacements

| 0.3 | 0.4 |
|---|---|
| your own CanvasKit loader | `loadCanvasKit()` from `@freshcoat-js/engine/node`, or `loadCanvasKit(baseUrl)` from `@freshcoat-js/engine/browser` |
| `createHeadlessEnv({ fonts, images, encode })` | `createRenderer({ ck, fonts, load })`, with `output: { encode }` and `images` per render |
| `createBrowserEnv({ fonts })` | `createRenderer({ ck, fonts, surface })` and `output: { canvas: true }` |
| `renderSceneToPng(scene, { ck, width, height })` | `renderer.render(scene, { width, height })` |
| `env.paint(commands, ck)` | `renderer.paint(commands)` |
| `render(template, values, opts, { ck, env, fonts })` | `renderTemplate(renderer, template, values, opts)` |
| `renderCompiled(compiled, opts, runtime)` | `renderCompiled(renderer, compiled, opts)` |
| `createParagraphEngine`, `deriveFontMetrics`, `memoizeTextEngine`, `createPaintCache` passed in a runtime | owned by the renderer; `renderer.prepare` and `renderer.compile` use them |
| `env.loadImageBytes` | `load` on the renderer, `images` per render |
| `setBarcodeEncoder(bwipBarcodeEncoder)` | not needed: `compile` encodes barcodes itself |
| `bwipBarcodeEncoder` from `@freshcoat-js/coatfile/barcode`, `getBarcodeEncoder()` | `encodeBarcode` from `@freshcoat-js/coatfile` |
| `hasBarcode`, the `barcode_unavailable` warning | removed |
| `PaintWarning` kinds `barcode_invalid` and `gamut_compressed` | coatfile's `CompileWarning` and `PrintWarning`; a template frame's `warnings` are `FrameWarning[]` from `@freshcoat-js/coatfile` |
| the `qr_generate_failed` warning | removed; nothing emitted it |
| `"bytes" in result`, `as EncodedPaintedFrame[]` | not needed: the result's type follows `output` |
| `EncodedPaintedFrame`, `KeptPaintedFrame`, `RenderRuntime`, `ExportOptions` | `TemplateFrame<Output>`, `RenderTemplateOptions`, `RenderCompiledOptions` |

`@freshcoat-js/engine/headless`, `@freshcoat-js/engine/runtime`,
`@freshcoat-js/coatfile/headless` and `@freshcoat-js/coatfile/browser` are
removed, as are the `PaintRuntime`, `CanvasHost` and Canvas2D stand-in types.

## A server render, before and after

```ts
// 0.3
const ck = await myCanvasKitLoader();
setBarcodeEncoder(bwipBarcodeEncoder);
const env = createHeadlessEnv({ fonts, images, encode: { format: "webp" } });
const frames = (await render(template, values, { width, height }, { ck, env, fonts })) as EncodedPaintedFrame[];

// 0.4
const renderer = await createRenderer({ ck: await loadCanvasKit("full"), fonts });
const frames = await renderTemplate(renderer, template, values, {
  images,
  output: { encode: { format: "webp" } },
});
```

Keep the renderer for the life of the process or worker. It runs one paint at
a time, and bytes passed in `images` are decoded again when they change under
the same src.

## A live preview

```ts
const renderer = await createRenderer({ ck, fonts });
const [frame] = await renderTemplate(renderer, template, values, {
  frameNames: [side],
  exports: [{ constraint: { kind: "scale", value: devicePixelRatio } }],
  output: { pixels: true },
});
context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels.data), frame.width, frame.height), 0, 0);
```

A preview that only copies the result onto its own canvas no longer needs a
WebGL surface per paint.
