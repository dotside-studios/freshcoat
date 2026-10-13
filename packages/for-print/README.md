# @freshcoat-js/for-print

Image analysis, correction planning and calibration for CR80 cards. The
printer-specific part is a [print target](#print-targets); the built-in one is
YMCKO dye-sublimation ribbon printers. This is the print policy used by
[Freshcoat](../../README.md) Studio's "Print target" option.

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
  (the target's `finish`, or `printFinish(balance, target)` with a measured
  cast → the coat engine's `FrameFinish`).
- **CR80 geometry**: crop fitting (`cr80Dimensions`, `fitCr80CropToImage`, …)
  at 300 dpi, from the engine's CR80 size (`cr80Pixels`).

Its only runtime package dependency is the engine. Printer-specific decisions
stay here, in a `PrintTarget`; the engine supplies the color matrices, lookup tables, sharpening
and frame-finishing operations that implement them.

## Usage

```sh
npm install @freshcoat-js/for-print @freshcoat-js/engine
```

### Plan a scene for print

```ts
import { planForPrint, type ImageSampler } from "@freshcoat-js/for-print";
import { sampleImageNode, compileScene } from "@freshcoat-js/engine";

// Analyze photos as displayed: their fit, crop and own adjustment.
const sample: ImageSampler = async (image) => {
  const pixels = await sampleImageNode(ck, image, loadBytes);
  if (!pixels) throw new Error(`Couldn't decode ${image.src}`);
  return pixels;
};

const { scene, finish } = await planForPrint(nodeTree, {
  sample,                     // omit for the target's fixed preset
  balance: profile?.balance,  // a measured printer, if you have one
  target: YMCKO_DYE_SUB,      // the default
});

// freshcoat does the output: per-layer adjust + the whole-frame finish.
const commands = compileScene(scene, { width, height, textEngine, finish });
```

These examples assume an initialized CanvasKit instance (`ck`), a scene and
text engine, and a `loadBytes(src)` function supplied by your application.
Paint the resulting commands through an engine runtime.

`planForPrint` also takes `policy`, `finish` (`false` keeps only the balance
curve), `onAnalysis`, `cache` and `srcKey`. The parts are available on their
own: `planScene` (sync, preset), `analyzeScene` (per-photo analysis) and
`printFinish(balance)`.

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
attaches photo corrections only to photos. In `PlanPolicy`, an intent set to
`null` stays untouched and one left `undefined` takes the default. It walks containers and applies
corrections to leaves. Whole-frame finishing, including a profile's channel
balance, acts on the composited image.

For exceptions, pass `PlanPolicy.intentFor`. For example, classify a rasterized
logo as `graphic` so it remains pristine, or apply a specific graphic policy to
it. The resolver is also honored by `analyzeScene`, so an overridden image is not
decoded and analyzed as a photo.

## Print targets

A `PrintTarget` bundles what one kind of printer needs:

```ts
interface PrintTarget {
  id: string;                     // "ymcko-dye-sub"
  name: string;                   // for UI
  shortName?: string;             // for tight UI, such as a closed select
  preset: PrintOptimizeOptions;   // photos, without per-image analysis
  recommend(stats: ImageStats): { recommendation; notes };
  finish: FrameFinish;            // the whole-frame finish
  policy?: PlanPolicy;            // intent defaults; the caller's policy wins
}
```

`YMCKO_DYE_SUB` is the only built-in target and the default everywhere a
target is optional: `planForPrint`, `planScene`, `analyzeScene`,
`analyzePixels`, `buildRecommendation` and `printFinish`. It extracts near
black for the resin K panel and dithers in monochrome against dye-sub banding.
`YMCKO_PRESET` and `YMCKO_FINISH` are its `preset` and `finish`.
`PRINT_TARGETS` lists the built-in targets and `printTarget(id)` looks one up
(`undefined` reads as the default).

A custom target is plain data plus a `recommend` function. Other printers need
tuning against real test prints, so none ship yet. Rather than hand-tuning a
new target's `preset`, derive it from printed charts with `fitTargetPreset`
(see [Tuning a target's preset](#tuning-a-targets-preset)).

```ts
const plan = await planForPrint(nodeTree, { sample, target: myTarget });
```

## Mapping

`printAdjust(PrintOptimizeOptions)` → a coat engine `Adjust`:

- saturation + contrast → color **matrix**
- gamma + darkness → per-channel **LUT**
- sharpness → **sharpen**

The conjunctive white-clamp / black-extraction and gradient dither aren't per-layer
expressible; they live in the coat engine's whole-frame `FrameFinish`, which for-print
requests via the target's `finish`.

## Calibration profiles

The chart, measurement and fitting tools live in a separate entry point,
`@freshcoat-js/for-print/calibration`: chart specs (`grayBalanceChart`,
`chartScene`, …), reading a photographed chart (`readChart`, `homographyFrom`),
quality checks (`assessCalibration`) and fitting (`fitChannelBalance`,
`fitTargetPreset`).

`profileFromPhoto(photo, corners, details)` is the whole flow in one call: it
reads a photo of the printed gray balance chart, given the four fiducial
centers picked in it, and returns `{ ok: true, profile, assessment, reading }`
or a `reason` it couldn't (`unreadable-corners`, `unsafe-reading`, …).

`createPrintProfile(reading, details)` does the second half for a reading you
already have. Either way, a profile is only emitted when the capture is usable,
and it records the quality assessment plus printer, media (ribbon, ink or
toner) and stock details beside the fitted balance. Pass `target` in the
details to record which print target the profile was measured on.

`parsePrintProfile` returns `{ ok: true, profile }` or `{ ok: false, message }`.
It remains compatible with older profiles and normalizes them to the current
`version: 1` schema. A profile without `target` reads as `ymcko-dye-sub`
(`profileTarget(profile)`). Older profiles name the ribbon in
`conditions.ribbon`; it is kept as written, and `profileMedia(conditions)`
reads `media` or else `ribbon`.

Profiles describe measured channel balance for a printer, ribbon and stock
combination. They are not ICC profiles. A target's tone and chroma preset is
fitted separately by `fitTargetPreset` and is not stored in a profile. A profile's `balance` corrects the
composited card, never a layer: pass it to `planForPrint` or `printFinish()`,
which apply it as the whole-frame finish's curve.

### Tuning a target's preset

`fitTargetPreset` turns photographed charts into a suggested `preset` for a
new printer, ribbon and stock. Print a tone chart (`toneWedgeChart` or
`grayBalanceChart`) and a chroma chart (`chromaRampChart`, or `hueSweepChart`
as a weaker substitute), read each with `readChart`, and fit:

```ts
import { fitTargetPreset } from "@freshcoat-js/for-print/calibration";

const fit = fitTargetPreset({ tone: toneReading, chroma: chromaReading });
if (fit.ok) {
  fit.preset;  // PrintOptimizeOptions, a starting point for PrintTarget.preset
  fit.fitted;  // which of "gamma" | "darkness" | "saturation" were measured
  fit.notes;   // what was measured, and what was left at a default and why
} else {
  fit.reason;  // "no-charts" | "unsafe-reading" | "not-enough-data" | "implausible-response"
}
```

- **gamma, darkness** come from how the printer renders sent levels. The
  correction pre-compensates it: a printer that returns tones too dark gets
  `gamma` below 1 (the tone LUT lifts them), one that returns them too light
  gets `gamma` above 1. The search runs through `printAdjust`'s own LUT, so
  the number is what the render does. `darkness` is kept only when the shadows
  come back lighter than gamma alone explains; otherwise it stays 0.
- **saturation** is the inverse of the share of sent chroma the printer keeps.
  Each hue's ramp is read only below its gamut edge (the step where it stops
  following its early trend), and hues are combined by median. A hue sweep has
  no ramp, so it uses an upper quartile and says so in `notes`. When a tone
  chart is also given, chroma is read after undoing the measured tone response.
- **contrast** is never fitted and stays at its default: a printer that cannot
  reach black is not fixed by a contrast boost, and the notes say when that is
  the case. **sharpness** cannot be measured from these charts and stays at
  `options.defaults.sharpness` (0 if unset).

A missing chart leaves its knobs at `options.defaults` (neutral if unset). An
unusable capture (clipped stock, missed patches, uneven light or print, too few
levels, an implausible response) is refused rather than fitted around. The
result is a starting point for `PrintTarget.preset`, to be checked against a
real print; it is not a per-image correction, and it is separate from the cast
`balance` below.

## License

Apache-2.0, see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). Part of
[Freshcoat](../../README.md).
