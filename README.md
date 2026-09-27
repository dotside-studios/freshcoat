<h1>
  <img src="brand/freshcoat-logo.svg" alt="Freshcoat" height="56">
</h1>

<p><strong>Create designs that scale.</strong></p>

Freshcoat is an open-source design and rendering stack for work that repeats:
cards, badges, certificates, labels and watermarked photos. A portable template
format describes the design; a Skia renderer turns it into pixels; print and
workspace utilities support production runs.

Use the packages in your own application, author templates in Figma, or design
and export in Freshcoat Studio. Studio is one host for the stack, not a
requirement for using it. The format and renderer also power
[Davi](https://davi.social)'s card production system.

## Choose your starting point

| If you want to | Start with |
|---|---|
| Compile and render a design filled from data | [`@freshcoat/coatfile`](packages/coatfile/) |
| Render your own 2D scene graph with CanvasKit | [`freshcoat`](packages/engine/), the engine package |
| Analyze images and plan corrections for card printers | [`@freshcoat/for-print`](packages/for-print/) |
| Design, preview and batch-export in a browser | [Freshcoat Studio](apps/editor/) |
| Turn Figma frames and field markers into templates | [Freshcoat for Figma](apps/figma-plugin/) |

The three core SDK packages have release builds with compiled ESM,
declarations and assets. Their source manifests stay private for workspace
development; publish the generated tarballs. See the
[release guide](docs/releases.md) for npm setup, release checks and Figma ZIPs.

## What the stack shares

- **Templates:** layers, fields, fonts, sides and variants define a reusable
  design. JSON describes it; a `.coat` archive can carry its assets.
- **Scenes and rendering:** coatfile compiles a template and values into a
  scene. The engine lays out and paints that scene through CanvasKit, Skia
  compiled to WASM. Hosts supply fonts, images and the rendering environment.
- **Production utilities:** print analysis and correction are separate from
  authoring. The workspace package adds datasets, bindings, export plans,
  PDF assembly and sheet imposition for hosts that need batch output.

The [workspace](packages/workspace/) and [UI](packages/ui/) packages are
internal workspace packages, not part of the current npm release set.
The workspace model is independent of React; the UI kit supplies Studio's
React controls and themes.

## Applications

[Studio](apps/editor/) combines template editing, typed datasets and worker-based
exports in a browser. Imported files and autosaved work stay in browser
storage; URL-referenced fonts and images can still be fetched from their hosts.
Its feature list, screenshots, limits and development guide live in
[`apps/editor`](apps/editor/README.md).

[Freshcoat for Figma](apps/figma-plugin/) exports frames as `.coat` templates
with optional field bindings and can hand a result to Studio. Its README
covers layer naming, supported Figma features and installation.

## Develop

Requires [Bun](https://bun.sh) 1.3.13 or later. From the repository root:

```sh
bun install
bun run test
bun run typecheck
```

Choose the app or package you want to work on and use its README for specific
commands. For example, `bun run --cwd apps/editor dev` starts Studio, while
`bun run --cwd apps/figma-plugin build` builds the plugin.
The root `dev` and `build` aliases target Studio for convenience.

## Documentation

- [Architecture](ARCHITECTURE.md): package responsibilities and host boundaries.
- [Contributing](CONTRIBUTING.md): repository setup, checks and review conventions.
- [Releases](docs/releases.md): npm publication and Figma release bundles.
- [Studio](apps/editor/README.md) and [Figma plugin](apps/figma-plugin/README.md):
  application-specific behavior and guides.
- Each package README documents its API, runtime requirements and examples.

## License

Freshcoat is licensed under the [Apache License 2.0](LICENSE). Copyright 2026
Dotside Studios; see [NOTICE](NOTICE) and
[third-party notices](THIRD_PARTY_NOTICES.md).
The name and marks are not licensed; see [NAMES-AND-LOGOS.md](NAMES-AND-LOGOS.md).
