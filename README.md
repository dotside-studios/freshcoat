<h1>
  <img src="brand/freshcoat-logo.svg" alt="Freshcoat" height="56">
</h1>

<p><strong>Create designs that scale.</strong></p>

Freshcoat is an open-source design and rendering stack for creating cards,
badges, certificates, labels and watermarked photos from reusable templates.
A portable format describes each design, a Skia renderer turns it into pixels,
and print and workspace utilities help produce the output in batches.

Use the packages in your own application, create templates in Figma, or design
and export in Freshcoat Studio. The format and renderer also power
[Davi](https://davi.social)'s card production system.

## Why we're open sourcing it

Freshcoat grew out of our own production needs as a small team. We struggled
to find a design and rendering solution that fit our workflow, so we built one.
We're sharing it so others can build on it and adapt it to their own needs.
We want design files to be portable and the code that interprets them to be
understandable and open to change, without depending on proprietary formats.

We're not experts in graphics engines or compiler design, and most of the
work on Freshcoat has been AI-assisted. Our design decisions draw on working
knowledge of compilers, experience with Canvas2D rendering and the practical
demands of producing designs at scale. There is still plenty for us to learn.

We'd welcome help from people with deeper experience in these areas: finding
mistakes, questioning assumptions and improving the template format, renderer
and print workflows. If that sounds like your kind of work, see the
[contribution guide](CONTRIBUTING.md).

## Choose your starting point

| If you want to | Start with |
|---|---|
| Fill a template with data and render it | [`@freshcoat-js/coatfile`](packages/coatfile/) |
| Render your own 2D scene graph with CanvasKit | [`@freshcoat-js/engine`](packages/engine/) |
| Analyze images and plan corrections for card printers | [`@freshcoat-js/for-print`](packages/for-print/) |
| Design, preview and batch-export in a browser | [Freshcoat Studio](apps/editor/) |
| Turn Figma frames and field markers into templates | [Freshcoat for Figma](apps/figma-plugin/) |

Release builds for the three core SDK packages include compiled ESM,
TypeScript declarations and assets. Their source manifests are private and
intended for workspace development; use the generated tarballs for publication.
See the [release guide](docs/releases.md) for npm setup, release checks and
Figma plugin bundles.

## How the stack fits together

- **Templates:** layers, fields, fonts, sides and variants define a reusable
  design. Templates are described in JSON; a `.coat` archive can bundle their
  assets.
- **Scenes and rendering:** coatfile compiles a template and values into a
  scene. The engine lays out and paints that scene through CanvasKit, which
  brings Skia to WebAssembly. Host applications supply fonts, images and the
  rendering environment.
- **Production utilities:** print analysis and correction are separate from
  authoring. The workspace package adds datasets, bindings, export plans,
  PDF assembly and sheet imposition for applications that need batch output.

The [workspace](packages/workspace/) and [UI](packages/ui/) packages are
internal packages and are not currently included in npm releases.
The workspace model is independent of React; the UI kit supplies Studio's
React controls and themes.

## Applications

[Studio](apps/editor/) combines template editing, typed datasets and worker-based
exports in a browser. Imported files and autosaved work stay in browser
storage; URL-referenced fonts and images can still be fetched from their hosts.
See the [Studio README](apps/editor/README.md) for features, screenshots,
limitations and development instructions.

[Freshcoat for Figma](apps/figma-plugin/) exports frames as `.coat` templates
with optional field bindings and can send them to Studio. See the
[plugin README](apps/figma-plugin/README.md) for layer naming, supported Figma
features and installation.

## Develop

Requires [Bun](https://bun.sh) 1.3.13 or later. From the repository root:

```sh
bun install
bun run test
bun run typecheck
```

Each app and package has its own README with development commands.
For example, `bun run --cwd apps/editor dev` starts Studio, while
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
