# Releases

Freshcoat releases use one version for the core SDK and the Figma plugin.

| Deliverable | Distribution |
|---|---|
| `@freshcoat-js/engine` | npm: the rendering engine |
| `@freshcoat-js/for-print` | npm: print analysis and correction planning |
| `@freshcoat-js/coatfile` | npm: template files, validation, compilation and rendering helpers |
| `@freshcoat-js/workspace` | npm: datasets, bindings, archives, tabular I/O and batch export |
| `@freshcoat-js/cli` | npm: the `freshcoat` command for rendering, validating and exporting from a terminal |
| Freshcoat for Figma | GitHub release ZIP; Community updates are published separately in Figma |

Studio is deployed separately. The UI package remains internal.

Upgrading from 0.4? See [migrating to 0.5](migrating-to-0.5.md). From 0.3,
see [migrating to 0.4](migrating-to-0.4.md) first. Rendering
untrusted templates? See [safer defaults](security-defaults.md).

## Unreleased changes

These land in the next release's notes. Entries marked **(breaking)** need a
code or command change; entries marked **(output change)** change the bytes or
pixels Freshcoat writes for the same input.
[Migrating to 0.5](migrating-to-0.5.md) covers each one, and how to keep the
old behaviour where that is possible.

- **Supported runtimes.** The npm packages declare `"engines": { "node": ">=22" }`
  and run on Node 22 or later and Bun 1.3.13 or later. On Node 22, npm warns
  `EBADENGINE` for `hucre`, which declares Node 24; the warning is harmless.
- **Stricter loader URL checks.** The default loader and font fetch ignore
  tab, LF and CR when reading a scheme, allow a relative http URL only when it
  is same-origin with the page, and check every redirect hop against the
  policy (at most 5). See [safer defaults](security-defaults.md).

### SDK users

#### Errors and API

- **One typed error in coatfile (breaking).** Everything coatfile throws is
  now a `CoatError`, exported from the package root with its `CoatErrorCode`
  union, an optional `path` and a `cause`: an unknown variant, an aspect-ratio
  mismatch, a missing side or slice, an unresolved asset, invalid SVG and the
  rest no longer throw a plain `Error`. `saveTemplate` reports a pack failure
  as `write_failed` at the template root instead of at `/format_version`, and
  `decodeTemplate` reports a failed hash as `hash_failed` and any other
  read failure as `read_failed`, keeping `invalid_json` for text that does not
  parse. Migration: match on `err.code` (for example
  `err instanceof CoatError && err.code === "unknown_variant"`) instead of the
  message, which no longer starts with the code.

- **`saveTemplate` is always async (breaking).** `saveTemplate(template,
  "json")` now returns a promise, as the `"coat"` form already did. Migration:
  `await` it.

- **Narrower engine and coatfile APIs (breaking).** Each package root now
  holds what its README documents plus the types its public functions take
  and return. Helpers that only other Freshcoat packages use moved to a new
  `./internal` subpath, which is unstable and not for applications.
  - Engine, moved to `@freshcoat-js/engine/internal`: `applyAdjustColor`,
    `concatColorMatrix`, `contrastMatrix`, `identityColorMatrix`,
    `saturationMatrix`, `ColorMatrix`, `resolveDirection`, `combineShapes`,
    `BooleanOp` (coatfile's own `BooleanOp` template type stays on its root), `BooleanOperand`, `BooleanShape`, `cr80Pixels`, `mixColor`,
    `parseColor`, `toHex`, `MAX_SUPERSAMPLE`, `resolveExportScale`,
    `resolveSupersample`, `withExportScale`, `clearFontBytesCache`,
    `policyFetch`, `resolveFontRequest`, `createSharedFontProvider`,
    `makeParagraphBuilder`, `SharedFontProvider`, `getFontMetrics`,
    `readFontMetrics`, `registerFontMetrics`, `linearGradientAngle`,
    `linearGradientPoints`, `FALLBACK_LINE_HEIGHT`, `base64ToBytes`,
    `bytesToBase64`, `inheritLoaderPolicy`, `modulePixels`, `ellipsePath`,
    `isEllipsePath`, `outlineGeometry`, `outlinePath`, `outlineSvg`,
    `rectShape`, `sideStrokeGeometry`, `OutlineGeometry`,
    `SideStrokeGeometry`, `fitRect`, `strokeInset`, `resolveLayout`,
    `rotatedFootprint`, `roundCorners`, `applyCase`, `applySpanCase`,
    `ApplyCaseOptions`, `TextCase`, `spanTextStyle`, `toColor`, `strokeTrim`,
    `trimPath`, `StrokeTrim`.
  - Engine, now only on their own subpath: `scalePathData` on
    `@freshcoat-js/engine/path`; `readIccProfile`, `resolveOutputIntent`,
    `ResolvedOutputIntent`, `SRGB_OUTPUT_INTENT`, `SRGB_PROFILE`,
    `IccColorSpace`, `IccProfileInfo` and `IccProfileResult` on
    `@freshcoat-js/engine/icc`; `DEFAULT_MAX_IMAGE_DECODE_PIXELS` on
    `@freshcoat-js/engine/image`.
  - Engine, no longer exported: `brightnessMatrix`, `gammaLut`,
    `identityLut3d`, `bakeText`, `BakeTextOptions`, `resolveLeadingTrim`,
    `textClipOutset`, `hslToRgb`, `Rgba`, `DEFAULT_PRECISION`,
    `prepareScene`, `sceneAssets`, `ColorResolver`, `oklchToHex`,
    `parseCssColor`, `parseLinearGradient`, `drawImageToPixels`,
    `flattenOverWhite`, `autoLineHeight`, `MetricsLookup`, `metricsLookup`,
    `resolveAutoLineHeights`, `assertLoadableUrl`, `dataUrlToBytes`,
    `createPaintCache`, `PaintCache`, `DecorationMetrics`, `decorationLine`,
    `FitOptions`, `insetCorner`, `skipInkSegments`, `DEFAULT_JPEG_QUALITY`,
    `DEFAULT_WEBP_QUALITY`, `encodeDecodedPng`, `squircleSvg`,
    `FontWeightName`, `fontWeight`, `fontWeightName`, `IrIssue`,
    `validateCommands`. A renderer makes its own paint cache from `cache`.
  - Engine test switches: `setCpuFinish` and `setLayerBounds` are gone. The
    painter takes `switches: { cpuFinish, layerBounds }` per paint.
  - Coatfile no longer re-exports engine symbols. Import these from
    `@freshcoat-js/engine`: `approxEngine`, `encodePng`, `exportPixelSize`,
    `MAX_EXPORT_DIMENSION`, `fontRequestKey`, `googleCss2Url`,
    `googleFamilyParam`, `CR80_CORNER_MM`, `CR80_LONG_MM`, `CR80_SAFE_MM`,
    `CR80_SHORT_MM`, `MM_PER_INCH`, and every engine type coatfile passed
    through (`Command`, `DrawCommand`, `Renderer`, `TextEngine`, `Vec2`,
    `Size`, `FontRequest`, `GradientStop`, `ExportSetting`,
    `EncodePngOptions` and the rest). The others it re-exported
    (`applyCase`, `ellipsePath`, `isEllipsePath`, `linearGradientAngle`,
    `linearGradientPoints`, `MAX_SUPERSAMPLE`, `resolveExportScale`,
    `resolveSupersample`, `getFontMetrics`, `readFontMetrics`,
    `registerFontMetrics`, `base64ToBytes`, `bytesToBase64`) are on
    `@freshcoat-js/engine/internal`; `createPaintCache` is gone.
  - Coatfile subpaths removed, since everything on them is on the root and
    none was a lightweight entry: `./assets`, `./define`, `./fields`,
    `./normalize` and `./slices`. Import from `@freshcoat-js/coatfile`, which now also exports `FreeIdOptions`.
    `unwrapLegacyBundle` and `hasOpenSubpath` are no longer exported.
  - Coatfile, moved to `@freshcoat-js/coatfile/internal`: `applyBooleans`,
    `cachePathOp`, `barcodeBox`, `resizeVectorBoolean`, `resizeVectorPath`,
    `pieceSpec`, `sliceLayers`, `isOpenVector`, `resolveStrokeTrim`,
    `ResolvedStrokeTrim`, `textRuleBreaks`, `TextRuleBreak`,
    `activeVariantId`.
  - Coatfile, no longer exported: `constrainBox`, `resizeElements`,
    `fieldContext`, `isLightFace`, `POINTS_PER_INCH`, `generateMatrix`,
    `parseTrimValue`, `StrokeTrimInput`, `compiledPattern`.

#### Untrusted templates

- **Safer loader defaults (breaking).** The engine's default loader accepts
  only `data:`, `blob:` and `https:`; `http:`, `file:` and every other scheme
  throw, naming the scheme. `createFetchLoader({ unsafeAllowHttp: true })`
  opts back in to `http:`, and fonts follow the loader. A relative URL
  resolves against the page in a browser and throws where there is no page.
  Hosts that load other schemes pass their own `load`. See
  [safer defaults](security-defaults.md).
- **Pluggable font fallback (breaking).** `resolveTemplateFonts` takes a
  `fallback` option, a `FontFallback` (`{ id, load(family, weights) }`), for
  families the `fonts` block does not declare. The Google Fonts lookup stays
  on by default (`googleFonts()`, now exported). `fallback: null` turns it
  off. Migration: `guessGoogle: false` becomes `fallback: null`;
  `guessGoogle: true` can be dropped. Server hosts that do not want outbound
  requests to Google should pass `fallback: null` or their own fallback.
- **Field lookups stay off the prototype.** `{{constructor}}`,
  `{{toString}}` and `{{__proto__}}` render empty instead of reaching
  `Object.prototype`; a `__proto__` key in values does nothing; and
  `required: ["constructor"]` is no longer satisfied by an empty record.
  Substitution, visibility conditions and `validateValues` read own
  properties only.
- **Unsafe field patterns are rejected (breaking).** A field `pattern` longer
  than 512 characters, one that repeats a group that already repeats (such as
  `(a+)+` or `^(\d+,)*\d+$`), or one with a backreference fails `validate`
  with `unsafe_field_pattern` at `/fields/properties/<key>/pattern`. At render
  time such a pattern imposes no constraint, and a value over 10,000
  characters counts as `pattern_mismatch` without being tested. Dataset column
  patterns follow the same rule, and Studio's pattern inputs say why a pattern
  is refused.
- **Stricter format version parsing (breaking).** `format_version` must be
  `MAJOR` or `MAJOR.MINOR` in digits, surrounding spaces allowed. Values such
  as `1.7.3`, `1.0.0`, `1.7-beta` or `1.7garbage` used to be read as their
  leading `1.7` and are now `unsupported_format_version`. Every version
  Freshcoat itself writes is unaffected.

#### New limits

All of these are new in 0.5. Each refuses input large enough to exhaust memory
in the renderer or the importer.

- **Image decode cap (breaking).** An image whose width times height is over
  `RendererOptions.maxImageDecodePixels`, default 200,000,000
  (`DEFAULT_MAX_IMAGE_DECODE_PIXELS` on `@freshcoat-js/engine/image`), is not
  decoded. Neither is one whose size cannot be read from its header: truncated
  or corrupt data, or a format whose header Freshcoat does not parse, such as
  HEIF. The renderer paints a placeholder and reports `image_load_failed`;
  `decodePixels` and `sampleImageNode` throw. The header reader now
  understands BMP, ICO and CUR, WBMP and AVIF besides PNG, JPEG, GIF and WebP,
  and `.coat` packages save BMP, ICO and WBMP assets with their extensions.
  CanvasKit draws BMP, ICO and WBMP; AVIF is sized but still does not decode.
  Studio and the CLI use the default.
- **WOFF and WOFF2 size checks.** A WOFF or WOFF2 font whose tables would
  unpack to more than 128 MiB, or whose table lengths do not match what they
  declare, is refused with `font_load_failed`. The limit is fixed.
- **Spreadsheet import limits (breaking).** `readTable` refuses files over
  128 MiB, 512 MiB uncompressed (XLSX), 10,000 zip entries, 500,000 records
  below the header row, 500 columns or 10,000,000 cells, with a
  `TableLimitError` (code `limit_exceeded`, with `limit`, `actual` and `max`)
  from `@freshcoat-js/workspace/tabular`. A JSON list of objects counts its
  objects. Pass `limits` to `readTable` to raise one, or
  `Number.POSITIVE_INFINITY` to lift it; `DEFAULT_TABLE_LIMITS` holds the
  defaults. The limits were sized from measured peak memory, about 2 GB in a
  browser tab at the cell limit. Text too long for a JavaScript string, about
  512 MB in Node and Chromium, is refused with a size limit error rather than
  a raw Node error or Studio's "is empty". A workbook zip whose central
  directory cannot be read is refused with `invalid_file`.

#### Output

- **CSV and TSV export escape formula triggers (output change).** `writeTable`
  prefixes `'` to a text cell that starts with `=`, `+`, `-`, `@`, a tab or a
  carriage return, so a spreadsheet does not run it as a formula, and to one
  that starts with `'` and then a trigger. Number values and image cells are
  left alone. Phone numbers and signed amounts stored as text, such as
  `+63 912 345 6789` or `-1,200.00`, show the `'` in a spreadsheet.
  `writeTable(dataset, format, { escapeFormulas: false })` writes them as
  before. `readTable` drops the first `'` from a CSV or TSV cell that starts
  with `'` and a trigger, so a file Freshcoat wrote reads back exactly; pass
  `unescapeFormulas: false` to keep it. JSON, NDJSON and XLSX are unchanged.
- **PDF strings and trailer (output change).** Text strings in PDF metadata
  and names that are not printable ASCII are written as UTF-16BE with a byte
  order mark, where they used to become `?`. The trailer has an `/ID`, the MD5
  of the file body, as PDF/X requires. Numbers are never written in exponent
  form. Every PDF the engine writes changes, so tests that compare PDF bytes
  need new goldens; with a fixed `date` the bytes are still repeatable.
  Studio and CLI PDFs, assembled by `assemblePdf`, carry an `/ID` too, the
  MD5 of the content and the creation date.
- **Fonts that forbid embedding are outlined (output change).** In a vector
  PDF, a font whose OS/2 `fsType` sets Restricted License, No Subsetting or
  Bitmap Only is not embedded: its text is drawn as glyph outlines, which
  cannot be selected or searched, and the `font_embedding_restricted` warning
  names the family and layer. Preview & Print and Editable fonts embed as
  before. Raster outputs are unchanged.
- **Every PDF declares an output intent (output change).** PDFs carry a
  `GTS_PDFX` output intent, the bundled sRGB profile by default or a caller's
  ICC profile; `outputIntent: false` writes none. Presets take `outputIntent`
  (format 1.3) and archives store the profile under `profiles/`. The CLI
  takes `--output-intent <file>`, `--output-intent-id` and
  `--no-output-intent`.
- **Cut lines in spot colours (output change).** A PDF with cut lines (`cutLines`,
  `--cut-lines`, Studio's Cut lines) now strokes each edge kind in a
  `/Separation` spot colour that overprints: `CutContour` for through,
  `KissCut` for kiss, `Crease` for score and `Perfcut` for perforate, so
  print-and-cut RIPs find the paths by name. The lines look the same as
  before: each separation's alternate is the kind's old RGB colour, and they
  stay in the Cut optional content group at 0.25 pt. Only their colour space
  changed, from DeviceRGB to the separations, plus the overprint ExtGState.
  Presets take `cutSpots`, the CLI `--cut-spot`, and Studio's Output tab a
  name per kind to rename them. `All` and `None`, which PDF reserves for every
  or no plate, are refused in any case by the CLI and Studio; a saved preset
  naming one opens with that kind on its default name and a warning. PDFs
  without cut lines are unchanged, and so are SVG and DXF cut files.
- **Template spot colours (format 1.7).** A `rect` or `vector` can print its
  fill or stroke in a named spot ink with `spot`, for white ink, foil or
  varnish. A vector PDF paints it as a Separation, overprinting on request;
  raster outputs and Studio's canvas paint its alternate colour at the tint,
  mixed with white as the Separation's tint transform does.
- **Rasterized layers in vector PDFs are reported.** A layer a vector PDF
  draws as an image (shadow, blur, grain, halftone, gradient text stroke and
  the like, or inside a mask) used to pass without a word in an export. One
  that paints a spot ink, in its content or its mask, now warns for each
  item with the engine's new `spot_rasterized`, naming the layer and the
  ink, as the separation is lost. The rest are listed once per side: in
  `JobResult.rasterized`, as an `info` row per side in `export-report.csv`,
  after a CLI export, and in Studio's export checks.

#### New in the format and the engine

`minimumFormatVersion` stamps a template with the lowest version its fields
need. It is now derived from version tags on the schema itself. For valid
templates it gives the same result as before; it no longer raises the version
for a variant background that is not a rect or image, or for a delta key the
target element does not have. It also detects every 1.5 field, so some files
are now stamped 1.5 where 0.4 stamped them lower. The schema's `$id` no longer
carries the package version: it is
`https://cdn.jsdelivr.net/npm/@freshcoat-js/coatfile/schema/coatfile.v1.schema.json`.
A `$schema` pinned to the old `@0.4.0` URL still resolves.

Format 1.7 adds:

- `slice` on rects and vectors, with `resolveSlices`, for pieces and cut files.
- `hidden` on elements, which a variant delta can undo with `hidden: false`.
- Text `stroke` (colour, width, join, align) and `pdfText`.
- `cornerSmoothing` on frames, and per-corner, smoothed corners on images.
- Per-side stroke widths on rects and frames.
- One `effects` list for shadows, layer blur and background blur, plus new
  `grain` and `halftone` effects. The old shadow and blur fields still read.
- `spot` on rects and vectors (see Output above).
- QR styling: module shapes, finder styles, a gradient, a quiet zone and a
  centre logo, with print hints `qr_low_contrast`, `qr_inverted`,
  `qr_quiet_zone` and `qr_logo_large`.

The engine and workspace also add:

- Vector PDF text drawn as glyph outlines on request (`text: "outlines"`).
  Font collections and CFF2 variable fonts are outlined instead of
  rasterized.
- Print preflight warnings for small text, hairlines, rich black and missing
  bleed, and a warning when a placed image prints below a minimum effective
  DPI.
- Step-and-repeat copies and printer's marks (registration marks, colour bar
  and slug) on imposed sheets, and A5 and A6 sheet paper.
- for-print: print target presets fitted from printed charts, a warning when
  a profile was measured on another target, and short target names.
- `exportWorkspace` takes `confirmLargePdf`, as `runExportJob` does, and both
  take `largePdfBytes`, the estimate past which it is asked, default
  `PDF_CONFIRM_BYTES` (1 GiB). `PDF_SAMPLE_PAGES` is exported.

### CLI users

- **Large file warnings.** A PDF export estimates its size from the first
  3 items it renders and, past 1 GiB, where Studio asks first, warns that the
  PDF is held in memory until it is built and goes on. `render --data` warns for
  a data file over 128 MiB and goes on. `--dry-run` gives both warnings, and
  renders the first 3 items of a PDF to do so. `render --data` reads a file
  of any size; only `readTable`'s limits of 500 columns and 10,000 zip
  entries apply.
- **Cancellation.** Ctrl-C (SIGINT) exits 130 and SIGTERM exits 143, after
  printing `freshcoat: cancelled`. A `.zip` or `.pdf` export writes a
  temporary file and renames it over `--out` only on success, so a cancelled
  export leaves any existing file untouched. A second signal exits at once,
  and commands other than `render` exit on the first. `main()` installs no
  signal handlers; hosts cancel it through `io.signal`. Workspace saves
  stream to a temporary file and rename it into place, so a large workspace is
  no longer held in memory and a failed save leaves the old file.
- **Usage errors.** Options that conflict, such as `--output-intent` with
  `--no-output-intent`, exit 2, as does a duplex back offset outside ±50 mm.
  PDFs from the CLI name `Freshcoat CLI <version>` as their creator.
- **Parity with Studio.** `render` takes `--orientation`, `--size-from`
  and `--max-edge` (Studio's Match image) and `--no-analyze`, writing the
  preset fields Studio writes; `--print-target` takes for-print's target ids,
  such as `ymcko-dye-sub`; `--scale` takes 1 to 4, as presets do; `--dpi`
  works for a template render and an export to images too; every `validate`
  warning ends in its code; and `render` and `validate` read the templates
  `.zip` that `pack` and Studio's Export all templates write.
- **New flags.** `--pdf-text <embed|outline>`, `--copies <n|fill>`,
  `--marks <list>`, `--min-dpi <n>`, `--back-offset <x,y>`, `--blank-backs`,
  `--print-target <target>`, `--output-intent <file>`,
  `--output-intent-id <name>`, `--no-output-intent` and `--cut-spot`. See the
  [CLI
  README](../packages/cli/README.md).

### Studio

- **Security headers.** Studio's server sends `nosniff`,
  `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` and a
  Content-Security-Policy on every response. It serves only `GET` and `HEAD`,
  returns 404 for dotfiles and for missing assets instead of the app shell,
  and no longer serves sibling directories whose names start with `dist`. A
  proxy that adds its own CSP must allow at least what
  [`apps/editor/server.ts`](../apps/editor/server.ts) sends, including
  `'wasm-unsafe-eval'` and, on scripts, `'unsafe-eval'`.
- **Autosave failures are shown, and stored work is kept.** A failed write shows a
  persistent "Couldn't autosave" toast with Retry. An autosave that cannot be
  read, or that a newer Studio wrote, is never overwritten. Pending changes are
  saved when the tab is hidden or closed.
- **Faster large exports.** The Export tab no longer re-renders settings,
  checks and records each time an item finishes, so the page stays responsive
  during large exports.
- **Import limits** are stated in the import wizard, and an oversized file is
  refused before it is read.
- **New:** a Print tab, settings popovers and reworked Data and Export panels;
  a display unit setting (px, mm, in, pt); status bar slots with an Activity
  indicator; Min DPI and output intent settings; profile import and export;
  export warnings grouped by code; and presets for business cards,
  postcards, shipping labels, A5 and A6.

### Figma

- **Visible blur preferred (output change).** When a layer has more than one
  layer blur or background blur, the plugin keeps the first visible one of
  each kind (the first hidden one only when none is visible) and warns with
  `duplicate_blur_dropped` for the rest. It used to keep the first one, hidden
  or not, and say nothing.
- **New mappings:** text strokes (`text_stroke_flattened` when rasterized),
  `hidden` layers a variant shows, per-side strokes, `effects`, monotone noise
  as grain (`noise_approximated`) and styled QR codes.

## Prepare and check a release

Update the version in these six manifests together:

- `packages/engine/package.json`
- `packages/for-print/package.json`
- `packages/coatfile/package.json`
- `packages/workspace/package.json`
- `packages/cli/package.json`
- `apps/figma-plugin/package.json`

Then regenerate the lockfile and schema, and build the release artifacts:

```sh
bun install
bun run --cwd packages/coatfile schema
bun run test
bun run typecheck
bun run release:pack
bun run release:check
bun run --cwd apps/figma-plugin build
bun run release:figma
```

`release:pack` builds compiled ESM and declarations into `dist/npm/`, resolves
workspace dependencies to exact release versions, and produces npm tarballs
in `dist/releases/`. It also writes `packages.json` with publication order
and SHA-512 integrity values. It clears earlier release artifacts before
packing, so build the Figma ZIP afterward.

The checked-in workspace manifests stay private and export source for local
development. Only the generated package manifests are public and export
JavaScript and declarations. Publish the generated tarballs, never the source
package directories.

`release:check` installs the tarballs in an isolated npm project. It checks every
public import and declaration, renders a scene and text in Node, and exercises
print analysis, template archives, fixtures and schema access. It imports every
workspace subpath and runs a small export job that writes a ZIP in Node. It
also checks that the tarballs include license files and exclude TypeScript
source, and runs the installed `freshcoat` bin: its version, then `validate`,
`inspect` and `render` on a fixture template.

Every release dependency installs from the npm registry. The workspace check
also writes and reads back an `.xlsx` file.

The schema's `$id` is the unversioned jsDelivr URL, so a version bump does not
change it. The `schema` script also rewrites the coatfile README's format
table, and `schema:check` fails when either has drifted from the source.

## npm account setup

The packages publish under the `@freshcoat-js` npm organization. Before
publishing, confirm your npm account has permission to create and update
packages in that organization. GitHub organization membership does not grant
npm publication rights.

For packages that do not exist on npm yet, make the first publication using an
authenticated maintainer account. Build and verify the tarballs first, then
publish them in dependency order:

```sh
npm login
npm publish dist/releases/freshcoat-js-engine-0.1.0.tgz --access public
npm publish dist/releases/freshcoat-js-for-print-0.1.0.tgz --access public
npm publish dist/releases/freshcoat-js-coatfile-0.1.0.tgz --access public
npm publish dist/releases/freshcoat-js-workspace-0.1.0.tgz --access public
npm publish dist/releases/freshcoat-js-cli-0.1.0.tgz --access public
```

Those commands publish publicly. The first manual publication does not receive
CI provenance. Subsequent trusted workflow publications receive automatic
provenance only when both the GitHub repository and npm package are public.

Configure a GitHub Actions trusted publisher in each package's npm settings:

| Setting | Value |
|---|---|
| Organization | `dotside-studios` |
| Repository | `freshcoat` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | Direct publishing with `npm publish` |

Explicitly enable direct publishing: new trusted-publisher connections default
to staged publishing, which this workflow does not use. Configure all five
scoped packages separately; settings on the old unscoped `freshcoat` package do
not carry over.

Create the `npm` environment in GitHub repository settings. If you enable
required reviewers, release publishing waits for their approval. Allow release
tags through any environment deployment restrictions.

The workflow uses Node 24, npm's OIDC authentication and `id-token: write`.
It checks that npm is at least 11.5.1 before invoking the publisher.
No `NPM_TOKEN` secret is needed. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup
and supported CLI versions.

After a successful trusted publication, set each package's publishing access
to **Require two-factor authentication and disallow tokens**, and revoke unused
publishing tokens. Trusted publishing continues to work without those tokens.

## Release banner

Each release's notes open with a banner rendered by the CLI of that release
from `brand/releases/v<version>.coat.ts`: the logo and version over
generative art drawn with some of what the release adds; see
[the brand README](../brand/README.md#release-banners). Render it and commit
the PNG with the version change, so the tag carries it:

```sh
bun packages/cli/src/bin.ts render brand/releases/v0.4.0.coat.ts --out brand/releases
```

Then start the GitHub release notes with the image at that tag:

```md
![Freshcoat v0.4.0](https://raw.githubusercontent.com/dotside-studios/freshcoat/v0.4.0/brand/releases/v0.4.0.png)
```

## Run the release workflow

Commit the version and schema changes, push the commit and tag, and publish a
GitHub release for that tag. Publishing the GitHub release starts
[`release.yml`](../.github/workflows/release.yml).

The workflow runs the existing CI checks, including browser smoke tests, plus
package and plugin artifact checks. Once validation passes, two jobs run:

- npm publishes the tested tarballs in engine, for-print, coatfile, workspace,
  cli order.
- GitHub attaches those tarballs and the plugin ZIP to the release.

The tag must match the package versions. Stable versions use npm's `latest`
dist-tag; prerelease versions such as `0.2.0-beta.1` use `next`. Set the GitHub
release's prerelease flag for prerelease versions too.

You can also run **Actions → Release → Run workflow** with an existing tag.
The default is a dry run: CI builds and validates artifacts, and npm checks its
publish payload without publishing. A dry run does not verify OIDC
authentication or the trusted-publisher settings on npm.

For real publication, select the release tag in the workflow's **Use workflow
from** selector and enter the same tag in the `tag` input. Set `dry_run` to false
only when publishing is intended and a GitHub release already exists for the
tag. Before validation or publication, the workflow verifies that its ref is
that tag and the checked-out commit matches GitHub's triggering SHA. This keeps
npm provenance tied to the code used to build the packages. Dry runs may still
be launched from another ref.

For a local npm dry run, after packing:

```sh
RELEASE_TAG=v0.1.0 node scripts/publish-packages.mjs --dry-run
```

Reruns skip an existing npm version only when its registry integrity matches
the tested tarball. A different tarball for the same version fails; bump the
version instead. A partial publication can be retried with the original
artifacts using GitHub's **Re-run failed jobs** action. Rerunning all jobs
rebuilds artifacts and requires their bytes to match any published versions.

## Figma plugin releases

The ZIP contains `manifest.json`, `build/`, the plugin README, and license and
third-party notices. Download it from a GitHub release, extract it, and import
its manifest through Figma desktop's development plugin menu. No build is
needed to use that bundle.

The plugin is available in Figma Community. Publishing a GitHub release does
not update that listing: publish each plugin update separately through Figma.
Release ZIPs can also be installed as development plugins.

The permanent plugin ID is `1685967766479998641`, configured in
`apps/figma-plugin/package.json` under `figma-plugin.id`. The build generates
`manifest.json` from that configuration. Keep the ID stable across updates:
changing it makes plugin data saved under the old identity inaccessible.

Check the plugin in Figma and submit updates through Figma's publishing flow.
CI does not update the Community listing. See
[Figma's plugin documentation](https://developers.figma.com/docs/plugins/).
