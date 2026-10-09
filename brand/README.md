# Brand

| File | Use |
|---|---|
| `freshcoat-mark.svg` | The mark in colour. Also the editor's favicon |
| `freshcoat-mark-mono.svg` | The mark in one colour, `currentColor` |
| `freshcoat-logo.svg` | The Freshcoat logo and wordmark, without the Studio qualifier |
| `freshcoat-studio-logo.svg`, `freshcoat-studio-logo-dark.svg` | The Freshcoat Studio logo, for light and dark backgrounds |
| `freshcoat-studio-wordmark.svg` | The wordmark alone, `currentColor`, with "studio" at reduced opacity |
| `social-preview.json` | The GitHub social preview template, 1280 × 640 |
| `png/` | Raster exports, including a 512 px square icon and `social-preview.png` |

`source/` holds the Figma exports. Everything else is generated from them:

```sh
bun brand/build.ts          # also writes the files in apps/editor/public/
bun brand/build.ts --check  # diffs the rebuilt gradient against Figma's
```

The social preview is rendered from its template with the CLI:

```sh
bun packages/cli/src/bin.ts render brand/social-preview.json --out brand/png
```

Figma writes the mark's angular gradient as a CSS `conic-gradient` inside a
`foreignObject`, which favicons, `<img>` and GitHub do not render. The build
redraws it as SVG wedges clipped to the mark.

The license does not cover the logo and marks; see
[NAMES-AND-LOGOS.md](../NAMES-AND-LOGOS.md).
