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

Upgrading from 0.3? See [migrating to 0.4](migrating-to-0.4.md). Rendering
untrusted templates? See [safer defaults](security-defaults.md).

## Unreleased changes

These land in the next release's notes.

- **One typed error in coatfile (breaking).** Everything coatfile throws is
  now a `CoatError`, exported from the package root with its `CoatErrorCode`
  union, an optional `path` and a `cause`: an unknown variant, an aspect-ratio
  mismatch, a missing side or slice, an unresolved asset, invalid SVG and the
  rest no longer throw a plain `Error`. `saveTemplate` reports a pack failure
  as `write_failed` at the template root instead of at `/format_version`, and
  `decodeTemplate` reports a failed hash as `hash_failed` instead of
  `invalid_json`. Migration: match on `err.code` (for example
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
    `BooleanOp`, `BooleanOperand`, `BooleanShape`, `cr80Pixels`, `mixColor`,
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
    `./normalize` and `./slices`. Import from `@freshcoat-js/coatfile`.
    `unwrapLegacyBundle` and `hasOpenSubpath` are no longer exported.
  - Coatfile, moved to `@freshcoat-js/coatfile/internal`: `applyBooleans`,
    `cachePathOp`, `barcodeBox`, `resizeVectorBoolean`, `resizeVectorPath`,
    `pieceSpec`, `sliceLayers`, `isOpenVector`, `resolveStrokeTrim`,
    `ResolvedStrokeTrim`, `textRuleBreaks`, `TextRuleBreak`,
    `activeVariantId`.
  - Coatfile, no longer exported: `constrainBox`, `resizeElements`,
    `fieldContext`, `isLightFace`, `POINTS_PER_INCH`, `generateMatrix`,
    `parseTrimValue`, `StrokeTrimInput`, `compiledPattern`.

- **Safer defaults for untrusted templates.** The engine's default loader
  accepts only `data:`, `blob:` and `https:`. See
  [safer defaults](security-defaults.md).

- **Pluggable font fallback.** `resolveTemplateFonts` takes a `fallback`
  option, a `FontFallback` (`{ id, load(family, weights) }`), for families the
  `fonts` block does not declare. The Google Fonts lookup stays on by default
  (`googleFonts()`, now exported). `fallback: null` turns it off. Migration:
  `guessGoogle: false` becomes `fallback: null`; `guessGoogle: true` can be
  dropped. Server hosts that do not want outbound requests to Google should
  pass `fallback: null` or their own fallback. See
  [safer defaults](security-defaults.md).

- **Cut lines in spot colours.** A PDF with cut lines (`cutLines`,
  `--cut-lines`, Studio's Cut lines) now strokes each edge kind in a
  `/Separation` spot colour that overprints: `CutContour` for through,
  `KissCut` for kiss, `Crease` for score and `Perfcut` for perforate, so
  print-and-cut RIPs find the paths by name. The lines look the same as
  before: each separation's alternate is the kind's old RGB colour, and they
  stay in the Cut optional content group at 0.25 pt. Only their colour space
  changed, from DeviceRGB to the separations, plus the overprint ExtGState.
  Presets take `cutSpots`, the CLI `--cut-spot`, and Studio's Output tab a
  name per kind to rename them. PDFs without cut lines are unchanged, and so
  are SVG and DXF cut files.
- **Template spot colours (format 1.7).** A `rect` or `vector` can print its
  fill or stroke in a named spot ink with `spot`, for white ink, foil or
  varnish. A vector PDF paints it as a Separation, overprinting on request;
  raster outputs and Studio's canvas paint its alternate colour at the tint,
  mixed with white as the Separation's tint transform does.
- **Rasterized layers in vector PDFs are reported.** A layer a vector PDF
  draws as an image (shadow, blur, grain, halftone, gradient text stroke and
  the like) used to pass without a word in an export. One that paints a spot
  ink now warns for each item with the engine's new `spot_rasterized`, naming
  the layer and the ink, as the separation is lost. The rest are listed once
  per side: in `JobResult.rasterized`, as an `info` row per side in
  `export-report.csv`, after a CLI export, and in Studio's export checks.
- **CLI parity with Studio.** `render` takes `--orientation`, `--size-from`
  and `--max-edge` (Studio's Match image) and `--no-analyze`, writing the
  preset fields Studio writes; `--print-target` takes for-print's target ids,
  such as `ymcko-dye-sub`; `--scale` takes 1 to 4, as presets do; `--dpi`
  works for a template render and an export to images too; every `validate`
  warning ends in its code; and `render` and `validate` read the templates
  `.zip` that `pack` and Studio's Export all templates write.

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

The schema URL includes the npm package version, independently of the template
format version. Regenerate it whenever the package version changes.

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
