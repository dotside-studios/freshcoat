# Brand

| File | Use |
|---|---|
| `freshcoat-mark.svg` | The mark in colour. Also the editor's favicon |
| `freshcoat-mark-mono.svg` | The mark in one colour, `currentColor` |
| `freshcoat-logo.svg` | The Freshcoat logo and wordmark, without the Studio qualifier |
| `freshcoat-studio-logo.svg`, `freshcoat-studio-logo-dark.svg` | The Freshcoat Studio logo, for light and dark backgrounds |
| `freshcoat-studio-wordmark.svg` | The wordmark alone, `currentColor`, with "studio" at reduced opacity |
| `social-preview.json` | The GitHub social preview template, 1280 × 640 |
| `figma-cover.json` | The Figma Community thumbnail for Freshcoat for Figma, 1920 × 1080 |
| `releases/` | The release banners, one template module and PNG per release |
| `png/` | Raster exports, including a 512 px square icon, `social-preview.png` and `figma-cover.png` |

`source/` holds the Figma exports. Everything else is generated from them:

```sh
bun brand/build.ts          # also writes the files in apps/editor/public/
bun brand/build.ts --check  # diffs the rebuilt gradient against Figma's
```

The social preview and Figma thumbnail are rendered from their templates with the CLI:

```sh
bun packages/cli/src/bin.ts render brand/social-preview.json --out brand/png
bun packages/cli/src/bin.ts render brand/figma-cover.json --out brand/png
```

## Release banners

Each GitHub release opens with a 1600 × 320 banner: the logo and version
centred, the same every time, over generative art made for that release. The
art does not list the release's features; it is one idea drawn with some of
what the release made possible. Each banner is a template module,
`releases/v<version>.coat.ts`, rendered by the CLI of the release it
announces. `releases/art.ts` holds what every banner shares: the strip, the
lockup, the palette of the mark and a random source seeded by the version, so
a banner renders the same each time.

```sh
bun packages/cli/src/bin.ts render brand/releases/v0.4.0.coat.ts --out brand/releases
```

The frame is named after the release, so this writes `releases/v0.4.0.png`.
For a new release, follow [the banner brief](releases/README.md), which covers
how to choose the art and what stays the same. See [the release guide](../docs/releases.md#release-banner) for adding the
banner to the release notes.

Figma writes the mark's angular gradient as a CSS `conic-gradient` inside a
`foreignObject`, which favicons, `<img>` and GitHub do not render. The build
redraws it as SVG wedges clipped to the mark.

The license does not cover the logo and marks; see
[NAMES-AND-LOGOS.md](../NAMES-AND-LOGOS.md).
