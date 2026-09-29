# @freshcoat-js/for-print

Image analysis, correction planning and calibration for CR80 cards printed
on YMCKO dye-sublimation ribbon printers. This is the print policy used by
[Freshcoat](../../README.md) Studio's "Optimize for card printer" option.

Use this package to recommend corrections from decoded pixels, apply a
print policy to a scene, or create profiles from measured print charts.
It returns analysis and [`@freshcoat-js/engine`](../engine) adjustment data; the engine
applies those adjustments and produces the image. It does not encode files
or communicate with a printer.

## What it does

- **Analyze** a decoded pixel buffer → a `PrintOptimizeOptions` recommendation
  tuned to brightness / saturation / contrast (`analyzePixels`,
  `buildRecommendation`).
- **Plan** a coat engine scene: classify each layer by print intent and attach a
  generic coat engine `Adjust` per layer, so correction happens **per-layer at
  paint time** instead of on the flattened card (`planScene`, `analyzeScene`,
  `classifyIntent`, `printAdjust`).
  A layer's own `Adjust` is kept: the correction is composed after it.
- **Recommend finishing**: the whole-frame output ops that aren't per-layer
  (`YMCKO_FINISH` → the coat engine's `FrameFinish`).
- **CR80 geometry**: format spec + crop fitting (`cr80Dimensions`,
  `fitCr80CropToImage`, …).

Its only runtime package dependency is the engine. Printer-specific decisions
stay here; the engine supplies the color matrices, lookup tables, sharpening
and frame-finishing operations that implement them.

## Usage

### Plan a scene (per-layer correction)

```ts
import { planScene, analyzeScene, YMCKO_FINISH, type ImageSampler } from "@freshcoat-js/for-print";
import { sampleImageNode, compileScene } from "@freshcoat-js/engine";

// Sync, policy-driven: photos get the YMCKO preset; text/QR/graphics stay pristine.
const presetScene = planScene(nodeTree);

// Or analyze photos as displayed, including their fit and crop.
const sample: ImageSampler = async (image) => {
  const pixels = await sampleImageNode(ck, image, loadBytes);
  if (!pixels) throw new Error(`Couldn't decode ${image.src}`);
  return pixels;
};
const analyzedScene = await analyzeScene(sample, nodeTree);

// freshcoat does the output: per-layer adjust + the whole-frame finish.
const commands = compileScene(analyzedScene, {
  width, height, textEngine, finish: YMCKO_FINISH,
});
```

These examples assume an initialized CanvasKit instance (`ck`), a scene and
text engine, and a `loadBytes(src)` function supplied by your application.
Choose `presetScene` for fixed corrections or `analyzedScene` for corrections
based on each photo. Paint the resulting commands through an engine runtime.

### Analyze a single image

```ts
import { analyzePixels } from "@freshcoat-js/for-print";
import { decodePixels } from "@freshcoat-js/engine";

const pixels = decodePixels(ck, bytes);
if (!pixels) throw new Error("Couldn't decode image");
const analysis = analyzePixels(pixels); // recommendation + notes
```

## Layer intent

`classifyIntent`: `image → photo`, `text → text`, `bitmap → code` (QR/pixel art),
`rect|ellipse|path → graphic`, `group|mask → container`. By default, the planner
attaches photo corrections only to photos. It walks containers and applies
corrections to leaves. An optional profile's channel balance applies to all
leaves, including text, vectors and codes. Whole-frame finishing acts on the
composited image.

For exceptions, pass `PlanPolicy.intentFor`. For example, classify a rasterized
logo as `graphic` so it remains pristine, or apply a specific graphic policy to
it. The resolver is also honored by `analyzeScene`, so an overridden image is not
decoded and analyzed as a photo.

## Mapping

`printAdjust(PrintOptimizeOptions)` → a coat engine `Adjust`:

- saturation + contrast → color **matrix**
- gamma + darkness → per-channel **LUT**
- sharpness → **sharpen**

The conjunctive white-clamp / black-extraction and gradient dither aren't per-layer
expressible; they live in the coat engine's whole-frame `FrameFinish`, which for-print
requests via `YMCKO_FINISH`.

## Calibration profiles

Use `createPrintProfile(reading, details)` to turn a Gray balance chart reading
into reusable profile data. It only emits a profile when the capture is usable,
and records the quality assessment plus printer, ribbon, and stock details beside
the fitted balance. `parsePrintProfile` remains compatible with older profiles and
normalizes them to the current `version: 1` schema.

Profiles describe measured channel balance for a printer, ribbon and stock
combination. They are not ICC profiles. Pass a profile's `balance` through
`PlanPolicy` to use it in scene planning, or use `withProfile()` to combine
it with a single-image recommendation.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
