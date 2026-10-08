# Coat engine conformance

The coat engine is the `@freshcoat-js/engine` package, the renderer under the freshcoat
editor.

What a second backend must do, as cases that fail rather than prose that is not
read. `Command[]` has no written specification: most of its semantics are
defined operationally by `src/canvaskit.ts`, and some of them (the blur sigma
constants) appear nowhere a second implementer would look. This corpus is that
specification. The order layer effects compose in is written down, below.

## Running it

```sh
bun test tests/conformance.test.ts        # grade the reference backend
bun run conformance/src/report.ts         # the same, as a readable report
bun run conformance/src/report.ts --goldens
bun run conformance/src/author-cases.ts   # re-emit cases/ from the authoring script
bun run conformance/src/generate-goldens.ts
```

## Grading another backend

A backend is a `Painter`: `(Command[], PaintRuntime) => Promise<PaintOutput>`.
Compiling is not its job. Text arrives **baked** (per-line `y`, an explicit
`baseline`, per-span `x`/`width`), so a backend inherits line breaking,
shrink-to-fit and `maxLines` rather than owning a shaper. That is the reason the
seam is here and not at the `Node` tree.

```ts
import { runConformance } from "./conformance/src/run";   // in-package; there is
                                                          // no published subpath

const report = await runConformance({
  painter: myPainter,
  capabilities: {
    profiles: ["core"],
    fidelity: { "fill.angular": "approximated", "export.scale": "n/a" },
  },
  textEngine, fontMetrics, fonts, images,   // from createFixture()
});
```

There is no second backend today and no plan for one. The seam exists because
it is how the reference backend is graded, and because the alternative was
leaving these semantics undocumented.

**Profiles**, not a forty-entry matrix, because a backend needs to answer "am I
done" with something better than a percentage:

| Profile | What it covers |
|---|---|
| `core` | shapes, fills, strokes, corners, clips, masks, images, bitmaps, groups, baked text, blend modes, shadows, blur |
| `raster` | the whole-frame finish pass, export density, supersampling, the LUT/sharpen adjust components |

Profiles are a set that can grow. A backend with a genuinely different output
model would want its own, defined against what that backend actually does rather
than guessed at in advance.

**Fidelity** says *how*, not merely whether: `native`, `approximated`,
`rasterized`, `refused`, `n/a`. Absent means `native`, so a complete backend
declares nothing, which is what the reference backend does. Two rules carry the
weight:

- **A profile is claimed only when every case in it passes**, skips included. A
  backend cannot reach `core` by declaring part of it `n/a`.
- **Anything not `native` must emit a `PaintWarning`.** A silent no-op is
  indistinguishable from support, which is the failure the whole model exists to
  make impossible. `tests/conformance.test.ts` asserts this directly.

## Cases are JSON

`cases/*.json` is the source of truth and is what the harness reads. A harness in
another language needs a JSON parser and a base64 decoder, not a port of the Node
types. `src/author-cases.ts` is the ergonomic way to write them and regenerates
the directory; it is not read at run time.

Binary fields (bitmap pixels, adjust LUTs) are `{ "__u8": "<base64>" }`, revived
anywhere they appear, so the encoding stays schema-free.

Four assertion kinds. `pixel` and `differ` are the common ones; `warning` takes
an optional `match` so a case can require the warning to name WHICH component was
dropped on WHICH layer, since a warning naming neither is barely better than
silence; `hue` exists because `gamut: "preserve-hue"` is a claim about hue rather
than about any particular triple, and its `awayBy` form asserts the opposite
(that the clipping mode does rotate).

Assertions are **reftest-style**: cases are built so a correct renderer produces
large flat areas of known colour, and the expected values are derived rather than
observed. `blend-multiply` expects `(0,128,0)` because multiply is the
per-channel product, not because CanvasKit produced it. That is what keeps the
corpus a specification instead of a record of the incumbent.

## Goldens

`expected/*.json` carries the lowered `Command[]` in full plus a **digest** of the
pixels, stamped with the CanvasKit version that produced it.

The command stream is stored rather than hashed so an IR change reviews as a text
diff. The pixels are hashed rather than stored because a committed raster per case
is megabytes that churn on every CanvasKit bump, and the authored assertions
already carry the semantics; the digest is the regression gate. 84 KB for the
whole corpus.

Exact comparison is justified by measurement, not hope: CanvasKit output is
bit-identical in-process and across processes (verified over the full corpus on
x64 Linux), and `tests/conformance.test.ts` keeps checking the in-process half.
Cross-architecture stability is **unverified** — see Gaps.

## Layer effect order

For one drawable, in this order:

0. backdrop blur: what the enclosing layer already holds beneath the drawable's
   shape is replaced by its blur, under the drawable's `rotation` and at its
   `opacity`, before anything of the drawable is drawn
1. content, under the drawable's `rotation`
2. clip and mask
3. color adjust: `colorMatrix`, the `preserve-hue` gamut map, the per-channel
   `lut`, the 3D `lut3d`
4. sharpen
5. layer blur
6. shadows, each cast from the silhouette of steps 1 to 5 in its own color:
   drop shadows under the content, inner shadows over it
7. opacity, over the layer and its shadows
8. blend into the parent

Adjust does not recolor shadows: a shadow's color is set on the shadow, and a
grade that changed it would leave no way to ask for a color without inverting
the grade. Figma behaves the same. The order holds whichever path a backend
takes for a component: in the reference backend a matrix is an image filter on
the layer and a LUT or sharpen is an offscreen shader pass, and both feed the
same blur, shadow, opacity and blend stages. `../README.md` gives the reasoning
in full.

## Coverage

72 cases.

| Covered | Cases |
|---|---|
| Fills | `fill-solid`, `fill-linear`, `fill-radial`, `fill-angular` |
| Compositing | `blend-multiply`, `blend-screen`, `blend-darken`, `blend-lighten`, `blend-overlay`, `blend-difference`, `blend-plus`, `blend-linear-burn`, `opacity` |
| Clipping and masking | `clip-circle`, `clip-per-corner`, `mask-alpha`, `mask-invert`, `mask-luminance`, `mask-luminance-opaque-shape`, `mask-luminance-alpha` |
| Shapes | `ellipse`, `path-viewbox`, `path-fill-rule`, `corner-radius`, `corner-radius-per-corner` |
| Strokes | `stroke-centered`, `stroke-inside`, `stroke-outside-ellipse`, `stroke-inside-path`, `stroke-outside-path-evenodd`, `stroke-inside-image-mask` |
| Shadows | `shadow-spread`, `shadow-inset`, `shadow-stacked` |
| Raster primitives | `bitmap-nearest`, `image-cover`, `image-contain`, `image-missing` |
| Containers | `group-fills`, `group-isolate`, `group-pass-through` |
| Text | `text-basic`, `text-align-right`, `text-align-justify`, `text-direction-rtl`, `text-font-features`, `text-max-lines` |
| Adjust | `adjust-color-matrix`, `adjust-gamma-lut`, `adjust-saturation-zero`, `adjust-lut3d`, `adjust-sharpen`, `adjust-preserve-hue`, `adjust-preserve-hue-with-lut`, `adjust-alpha-matrix-falls-back`, `adjust-in-rotated-group`, `adjust-lut-keeps-blend` |
| Effect order | `adjust-lut-keeps-shadow-color`, `adjust-matrix-keeps-shadow-color` |
| Backdrop blur | `backdrop-blur`, `backdrop-blur-under-fill`, `backdrop-blur-in-isolated-group` |
| **Painter semantics (D6)** | `rotation-rotates-the-shadow`, `clip-shapes-the-shadow`, `blur-sigma` |
| Frame finish | `finish-white-clamp`, `finish-black-extract`, `finish-dither` |
| Export | `export-scale`, `supersample` |

The three D6 cases are the ones worth understanding, because each pins a
semantic that a backend can miss while implementing every individual feature
correctly:

- **`rotation-rotates-the-shadow`** — `rotation` is applied to the canvas matrix
  *outside* `saveLayer`, so the layer and every filter on it work in rotated
  space and a shadow's offset rotates with the element. The case asserts the
  shadow is to the left and that the position an *unrotated* shadow would occupy
  is empty.
- **`clip-shapes-the-shadow`** — the clip is applied *inside* `saveLayer`, so the
  shadow is cast from the clipped silhouette. The case samples a box corner the
  circle never covers: a backend clipping outside the layer casts a rectangular
  shadow and lands ink there.
- **`blur-sigma`** — pins `LAYER_BLUR_SIGMA = blur / 2.2727`. A step edge reads
  half intensity at the edge whatever the sigma, and about 85% one sigma inside
  it. A backend passing `blur` straight to a Gaussian sits near 66% at that
  distance, which the band separates.

## Gaps

Honest list of what is not covered yet, so a backend author knows what passing
does and does not prove.

- **Strokes**: `dash`, `cap`, `join` and trims. Width and `align` are covered; the
  rest are geometry whose exact coverage is harder to assert on a flat sample.
- **Shapes**: `cornerSmoothing` (squircles). The corner of a smoothed rect
  differs from a circular arc by a couple of pixels, which needs a sample chosen
  against the superellipse rather than eyeballed.
- **Images**: `fill` and `tile`.
- **Text** beyond placement and truncation: `verticalAlign`, `fit: shrink|clip`,
  `decoration`, per-span fonts, `letterSpacing`, `leadingTrim`,
  `autoLineHeight`, and any non-Latin script.
- **`FrameFinish`**: the per-channel `dither` shorthand (the object form with a
  seed is covered).
- **Cross-architecture determinism.** Verified on x64 Linux only. The first CI
  run on other hardware is the real test; a mismatch means the goldens need a
  platform stamp, not that the suite is wrong.
`adjust-in-rotated-group` is the fifth painter semantic worth knowing, alongside
the three D6 cases: the offscreen adjust pass composites in device coordinates,
so it must inherit the canvas transform exactly once. The case asserts both where
the layer belongs and where a doubly-rotated snapshot would have put it.

One case exists because of a bug it found. `mask-luminance-opaque-shape` and
`mask-invert` both failed on first run: `lowerMask` took the `clipPath` fast path
whenever the mask was a plain shape, and a clipPath carries neither `invert` nor
`channel`. An inverted mask rendered as an ordinary clip, and an opaque black
mask under `luminance` kept content that zero luminance must drop. The predicate
read the mask and not the mask node's own flags.

- **`drawQr` is vestigial.** `types.ts` declares it and `canvaskit.ts` handles it,
  but nothing emits it: `compileScene` does not, and coatfile lowers QR to a
  bitmap. Deliberately uncovered. Delete the op rather than write a case for it.
