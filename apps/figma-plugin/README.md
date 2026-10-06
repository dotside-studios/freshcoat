# Freshcoat for Figma

Export a Figma design as a Freshcoat template (`.coat`) with fields, named
frames and variants. Open it in [Freshcoat Studio](../editor/) to add data and
export a batch, or render it in your own application with
[`@freshcoat-js/coatfile`](../../packages/coatfile/).

The plugin reads the open document through Figma's Plugin API; it needs no
REST API token. Custom export makes no network requests from the plugin.
Davi card product mode fetches its product catalog. The plugin has been
submitted to Figma Community and is awaiting review. Until approval, install
it from a release ZIP or a local build using the instructions below. Release
builds are packaged as downloadable ZIPs; see the
[release guide](../../docs/releases.md).

## Install a release bundle

Download the plugin ZIP from a GitHub release and extract it. In Figma desktop,
choose Plugins → Development → Import plugin from manifest… and select the
extracted `manifest.json`. The bundle includes the built code, so no Bun install
or local build is needed.

## Sideload (one time)

1. `bun install` at the repo root.
2. `bun run --cwd apps/figma-plugin build`.
3. Figma **desktop** app → Plugins → Development → **Import plugin from manifest…**
   → select `apps/figma-plugin/manifest.json`.

## Use

1. Open a design file and run **Freshcoat for Figma**.
2. Mark dynamic layers with a `kind:{{id}}` name (`text:{{name}}`,
   `image:{{avatar}}`, `color:{{brand}}`, `qr:{{url}}`, `barcode:{{sku}}`), or
   put `{{id}}` in a text layer's content. Name a layer or group `if:{{id}}` to
   show it only while that field is set. The
   [field marker examples](#field-markers) below show the supported forms.
3. **Layer** tab: select a layer. Unbound, it lists what it can become (Text,
   Image, QR code, Barcode, a color, or **Show when…** for a condition).
   Bound, it shows each binding, removable on its own, and the form for each
   field: key, label, type, source, required, and a barcode's symbology.
   **Apply** is enabled only by a change and confirms with "Applied"; **Unbind**
   asks first. Everything is stored in plugin data, and non-destructive.
4. **Fields** tab: **Detect fields** turns the markers in the picked frame's
   layer names into bindings. The list below is grouped by frame; each row is
   the field key, its type and its layer, and clicking it selects the layer.
5. **Export** tab, four steps. Each collapses to a one-line summary once done
   and reopens on a click:
   1. **Canvas**: Custom (sized from the frame) or Davi card product.
   2. **Frames**: pick the frame or card; **Use selection** takes it from the
      canvas. Colorways, missing sides and wrong-size frames (each with a
      **Resize**) show here.
   3. **Details**: name, description, mood (Davi only), and the field count with
      **Detect fields**.
   4. **Export**: **Export .coat** downloads `<sku>-<name>.coat`;
      **Open in Freshcoat** hands the template to the editor (see Settings).
      A bar shows the read and rasterize progress, then a result card with
      **Download again**, **Open in Freshcoat** and **Download diagnostics**.
      Warnings are listed under it by severity, each with its layer; click one
      to select that layer. A template that fails validation is not saved and
      its errors are listed the same way.
6. **Settings** tab: the Freshcoat address (https, or http on localhost; see
   [Open in Freshcoat](#open-in-freshcoat)), whether the result opens its
   diagnostics section, and a link to the binding guide.

The line at the bottom of the panel says what just happened ("Bound as
barcode", "Detected 6 fields"), and is announced to screen readers. It takes no
room when it has nothing to say, and what a tab already shows in place (the
export's progress and result, "Applied") is announced without being drawn.

The window opens at 320×480, the size of Figma's own panels and the size the
panel is designed for, and is resizable from the corner grip. Window size, the open tab, how
you last exported and the Settings tab are remembered in `figma.clientStorage`;
per-template content (name, description, mood) is not: that belongs to one
design, not to the plugin.

## What comes out

A `.coat` at coatfile's current format version. Before it is saved it goes
through coatfile's `validate()`; a template that fails is not downloaded, and
its errors are listed with the export's warnings.

The exporter keeps supported content as editable template elements: text,
shapes, vectors, images, layout frames and masks. Features it cannot represent
are rasterized where possible. For example, background blur, diamond gradients
and text whose runs are painted with different gradients become bitmaps. A
rasterized region preserves
its rendered appearance, but its internal layers and text are no longer
editable or available for field substitution.

Check the export's warnings and preview the template in Studio before a batch
run. Validation checks the document's structure and references; it does not
establish visual equivalence with the Figma design. Diagnostics explain which
layers were kept, flattened or skipped.

- **Constraints.** Each layer's Figma constraints become coatfile
  `constraints`, so a template resized later keeps its layout: Left/Top is
  `start` (the default, so nothing is written), Right/Bottom `end`, Center
  `center`, Left & right / Top & bottom `stretch`, Scale `scale`. A group's
  layers take the group's constraints, because Figma constrains a group as one
  unit. Children of an auto-layout frame get none, unless they are absolutely
  positioned. A layer rasterized into a bitmap keeps the constraints of the
  layer it replaces.
- **Mixed text styling.** Each run of a text layer becomes a span carrying
  only what it changes: family, size, weight (with an in-between weight as a
  `wght` variation), italic, letter spacing, line height, underline or
  strikethrough, and colour. A run's stacked solid fills are composited into
  one colour. A text filled with one gradient keeps it as the element's `fill`;
  runs painted with different gradients, or with an image, are rasterized
  (`text_mixed_styling_flattened`). When runs disagree on a decoration, each
  decorated span carries it, because a span cannot turn off one the element
  sets.
- **Text fields and runs.** A bound `text:` field keeps the layer's runs only
  when the runs spell out the template, each token whole inside one run, as in
  a layer whose content is `Hi {{name}}` with the token in bold: the value is
  filled in where the token was typed, in that run's style. Otherwise the
  value replaces the whole text in the first run's style. A bound `color:`
  field colours the whole text, over any run's own colour.
- **Fills.** Rectangles, vectors and frames keep stacked fills as a `fill`
  list, bottom first, each solid with its own alpha. Solid, linear, radial and
  angular paints map; an angular gradient maps when its sweep is even on the
  layer (not stretched by a non-square box). Diamond gradients, stretched
  angular ones, paints with their own blend mode, and image fills outside a
  single-image rectangle are rasterized (`paint_flattened`, or
  `multi_fill_flattened` for an image inside a stack).
- **Strokes.** Visible solid stroke paints are composited into one colour,
  keeping their opacity (a 50% stroke stays translucent); hidden ones are
  ignored. A dashed stroke keeps its pattern as `dash`. A rectangle, vector or
  frame with a visible gradient or image stroke is rasterized
  (`stroke_flattened`).
- **Corners.** Rectangles keep corner smoothing as `cornerSmoothing`. Frames
  keep their radius but not smoothing, which coatfile frames do not carry.
- **Blend modes.** Every Figma layer blend mode is carried as `blendMode`,
  linear dodge as `plus`. Pass through is how the renderer composites
  a frame already. A frame set to Normal isolates its content in Figma, which
  the renderer does only when the frame has opacity, an effect or a blend of
  its own, so one holding a blended layer without those is rasterized
  (`blend_mode_flattened`). A group with a blend mode gets a layer of its own.
- **Effects.** Drop and inner shadows (stacked, with spread) and layer blur are
  native. Background blur, progressive blur, a shadow with its own blend mode,
  and noise, texture or glass effects are rasterized (`effect_flattened`).
- **Auto layout.** Baseline alignment is not supported by the renderer's
  layout, so it is written as `start`.
- **Linear gradients.** A gradient's start and end come from Figma's handles,
  normalized to the layer's box, and are written as `from` and `to` beside its
  `angle`. A short, off-centre gradient on a wide layer therefore renders
  where it was drawn rather than across the whole box. Handles on the same point fall back to
  the angle alone.
- **Grid auto layout.** A Figma grid becomes a coatfile grid: fixed tracks
  keep their length, flexible ones become `fr` shares and hug tracks `auto`,
  with the row and column gaps and padding. Each child keeps its cell as a
  1-based `column` and `row`, spans included.
- **Field images.** An image bound to a field keeps its paint's exposure,
  contrast and saturation as an `adjust`. Figma gives no formula for them,
  so they are close readings and the export says so
  (`image_filter_approximated`); temperature, tint, highlights and shadows
  are left out with `image_filter_unsupported`. A Crop paint becomes a `crop`
  region drawn with `fill`, so every record's photo is cropped the same way;
  a rotated or skewed crop falls back to cover with
  `image_crop_unsupported`. A static image is rasterized as Figma draws it,
  filters and crop included.
- **Colorways.** Each instance of the card component named `<Card> / <Label>`
  becomes a variant, after a first **Default** that is the card itself. What
  the instance changes is diffed against the card, layer by layer: its
  background, each layer's properties, and where a layer sits, its size,
  rotation and opacity. A layer the instance hides is hidden in the variant.
  One the card hides and the instance shows stays hidden, with the warning
  `variant_unhide_unsupported`: a variant can hide a layer, not add one. The
  variant's id is its label's slug, suffixed `-2`, `-3` when another colorway
  (or Default) already has it.
- **Barcodes.** A layer named `barcode:{{sku}}` draws a Code 128 barcode of the
  field in the layer's box; `barcode:ean13:{{sku}}` names a symbology, and
  `barcode:ean13:5901234123457` a literal value. Options follow a `;` as for QR
  codes (`text=0`, `fg`, `bg`, `margin`, `ec`). The field is a text field with
  a barcode widget in Freshcoat. An unknown symbology, or a literal the encoder
  refuses, stops the export with an error; **Export anyway** writes a
  placeholder in its place. See [Field markers](#field-markers) for examples.
- **Bleed and safe area.** `guide:bleed` and `guide:safe-area` layers on a
  slot frame become the template's `bleed` and `safeArea`; artwork past the
  frame's edge is kept. See [Bleed and safe area](#bleed-and-safe-area).

## Field markers

Name a layer with a marker to define its changing content. Field keys start
with a letter or underscore and contain letters, digits or underscores.

| Layer name | Meaning |
|---|---|
| `text:{{display_name}}` | Text filled from `display_name` |
| `text:"{{first}} {{last}}"` | Text combining two fields |
| `image:{{avatar}}` | Image filled from `avatar` |
| `color:{{brand}}` | Color filled from `brand` |
| `qr:{{profile_url}};ec=M;fg=#000` | QR code with error correction and foreground options |
| `barcode:{{member_id}}` | Code 128 barcode |
| `barcode:ean13:{{sku}}` | EAN-13 barcode |
| `barcode:ean13:5901234123457` | Barcode with a fixed value |
| `if:{{show_badge}}` | Visible while a toggle is on or another field is nonblank |
| `if:!{{title}}` | Visible while `title` is unset |
| `if:{{tier}}="Gold member"` | Visible when `tier` equals `Gold member` |

Quote values containing literal text or multiple tokens, as in
`text:"ID {{id}}"`. A single token needs no quotes. Tokens placed in a text
layer's content also become fields without quotes. A layer named only
`{{id}}` is inferred as text for a text layer, or as an image for a rectangle
with a single image fill; use explicit markers for other kinds.

Barcode options follow semicolons: `text=0` hides the human-readable line,
`fg` and `bg` set colors, `margin` sets the quiet zone in modules, and `ec`
sets error correction for PDF417 or Aztec. Supported barcode symbologies are
Code 128, EAN-13, UPC-A, Code 39, ITF-14, PDF417, Data Matrix and Aztec.

The Layer tab can edit bindings and field metadata without renaming layers.
Conditions on a group apply to its contents; nested conditions must all hold.

## Bleed and safe area

The slot frame is the trim: keep it at the card's size, which is what Davi
card product mode checks. Draw the bleed and safe area as two guide layers,
direct children of the slot frame:

| Layer name | Meaning |
|---|---|
| `guide:bleed` | A box larger than the frame. How far it reaches past each edge is the template's `bleed` on that side |
| `guide:safe-area` | A box inside the frame. How far in it sits from each edge is the template's `safeArea` on that side |

A CR80 side at 1013×638 with a 35-unit bleed has a `guide:bleed` rectangle at
−35, −35, sized 1083×708. Use any layer type. Guides are measured by their
bounding box, read whether visible or hidden, and never exported as
artwork. The measurement is scaled to design units like everything else, and
written as one number when every side is the same. Without a guide, the
template has no `bleed` or `safeArea`, as before.

Artwork meant to print into the bleed goes past the frame's edge. It is
exported where it is, in trim coordinates (a layer 35 units off the left edge
has `x: -35`), and coatfile draws it when a render includes the bleed. Turn off
the frame's **Clip content** to see it in Figma. A plain unstroked rectangle,
image or frame that runs to the trim edge needs no overhang, because coatfile
grows it into the bleed on its own. See coatfile's
[Bleed and safe area](../../packages/coatfile/README.md#bleed-and-safe-area).

A template has one bleed and one safe area. When the slots' guides differ, or
only some slots have them, each side takes the largest value and the export
warns with `guide_mismatch`. Other warnings: `guide_empty` for a guide that
doesn't reach past (or into) the frame, `guide_duplicate` for a second guide of
the same kind on one slot (the first wins), and `guide_safe_area_exceeds_trim`
for a safe area that leaves no room on the canvas (it is dropped).

## Open in Freshcoat

**Open in Freshcoat** (Export step 4, and the result card) hands the template
to the Freshcoat editor without a file. It is packed into the link itself:
deflated, base64url-encoded, and opened as `<address>/edit#coat=<data>`. The
data rides in the fragment, which the browser never sends to a server, and the
editor removes it from the address once read. A template too large for a link
(over 1,500,000 characters encoded) is downloaded instead, and the editor opens
at `#open=1`, which points at its **Open file…** button and says to open the
file that was just downloaded.

The address is `https://freshcoat.dotsidestudios.com` unless the build says
otherwise: `FRESHCOAT_URL=https://… bun run build` bakes in another. Each
person can change it in **Settings**; with it cleared, the button opens
Settings. A pasted editor link works too, since a trailing `/edit`, the query
and the fragment are dropped.

## Diagnostics

An export tells you what came out; the diagnostics file tells you what went in
and what the transpiler made of it. It carries:

- **`scene`**: the node trees and properties read from Figma and supplied to
  the transpiler.
- **`decisions`**: one row per node the walk reached: which element it became,
  or why it was rasterized or skipped. The rasterization reasons are
  `text_mixed_styling_flattened`, `multi_fill_flattened`, `paint_flattened`,
  `stroke_flattened`, `blend_mode_flattened`, `effect_flattened`, `vector_flattened` and
  `transform_undecomposable_flattened`. Element ids are the *final* ones, after colliding layer names are
  renamed, so they match the template.
- **`rasters`**: each pre-exported bitmap's dimensions. A 1×1 is Figma saying
  the node renders nothing, which is otherwise indistinguishable from a good
  raster.

Diagnostics use a separate download action so they can be saved independently
of the template.

When an export differs from the design, compare the captured scene with the
template and use `decisions` to trace the conversion. Flattened and skipped
rows also travel inside the template at `source.report.decisions`.

## Two canvases

**Custom (default).** The selected frame supplies the template's canvas size.
Use this for certificates, posters, badges or any design outside Davi's card
catalog. Open the result in Studio or use coatfile's `render()` in your own
application. The export uses the placeholder product label `custom` and is
not accepted by Davi's order-site importer. Colorways still work: make the
frame a component and name its instances `<Frame> / <Label>`.

**Davi card product.** Choose it to bind the export to a catalog product.
The product declares an exact print size and a fixed set of side slots, and every
side frame must measure that size (either orientation), because the order site prints at
the template's native pixels, so an off-size frame is an error, not a scale factor.
The card must have children named after each slot (`front`, `back`).

Choosing this mode fetches the live product catalog from Davi's CDN. Custom
export does not make that request. Opening Studio launches a separate web app
with its own asset and font loading.

## UI conventions

`src/ui/index.tsx` is the shell: the tab list, the status line, and state more
than one tab reads (settings, the fields overview, the export target). Each tab
is its own file: `layer-tab.tsx`, `fields-tab.tsx`, `export-tab.tsx` (with
`steps.tsx`) and `settings-tab.tsx`. Every panel stays mounted, hidden with
`hidden`, so a tab that is not showing still hears main's messages; listen with
`useMainMessage` (`messages.ts`).

`src/ui/layout.tsx` holds the layout primitives. Spacing belongs to the container
that owns the relationship; use these primitives:

- `Panel`: a tab's outer frame (padding and section rhythm).
- `Section`: a titled block, `divider={false}` for the first one on a panel.
- `Stack` / `Row` / `Wrap`: vertical, horizontal, and wrapping flow with one gap.
- `Fill`: the child of a `Row` that absorbs leftover width and truncates.
- `Field`: a labelled single control; renders a real `<label>`, so use it for
  `Textbox`. `Dropdown` and `SegmentedControl` render their own `<label>`s and
  can't be nested in one; those take `FieldGroup`.
- `Thumbnail`: a frame preview, fed by the `useThumbnails` hook.

`src/ui/components.tsx` holds the shared pieces: `ListButton` (a row that is
one action, a real button), `EmptyState` (a title of a few words, then one line
or one button), `InlineConfirm`, `ProgressBar`, `Card`, `Lines`, and the type
icons. `warnings.tsx` is the one list of warnings and errors, grouped by
severity with an icon and a word each, never by color alone.

Tell the author what happened with `useAnnounce()` (`status.tsx`): working
lines stay until replaced, the rest fade. Copy follows Freshcoat's style guide
([CONTRIBUTING.md](../../CONTRIBUTING.md), Copy): sentence case, no period on labels or
one-line hints, "Couldn't …" for failures, and counts through `plural()` in
`copy.ts`. Colors are Figma's theme variables only, so both themes follow.

Previews are exported on demand for the frames on screen (`request-thumbnails`),
cached per node for the session, and refreshed unprompted when the plugin itself
changes a frame. Don't request them for the whole page: each one is a real
export in the main thread.

## Stored data, and publishing

Bindings live in node `pluginData` under `freshcoat_plugin:field` (per layer)
and `freshcoat_plugin:fields` (per slot frame); see
`src/main/plugin-data.ts`. The prefix is cosmetic:
`setPluginData` is already private to the plugin id, so
["Plugins with other IDs won't be able to read this data"](https://developers.figma.com/docs/plugins/api/properties/nodes-setplugindata/).
It's there to keep our keys legible in an exported `.fig`.

The `id` in `package.json` is the plugin's permanent assigned id. Keep it
stable across updates: plugin data is scoped to it, so changing it makes
existing stored bindings inaccessible to the new plugin.

Layer-name markers such as `text:{{name}}` still allow bindings to be inferred.
Hand-edited metadata stored only in plugin data, including labels, sources and
required flags, must be re-entered after an identity change.

## Develop

Built with [create-figma-plugin](https://yuanqing.github.io/create-figma-plugin/);
the manifest generates from the `figma-plugin` block in `package.json`.
Run these commands from `apps/figma-plugin`:

- `bun run build`: typecheck, bundle into `build/` and (re)generate `manifest.json`.
- `bun run watch`: rebuild on change (sub-second).
- `bun run test`: unit tests (reader, bundle, transpiler, hand-off).
- `bun run typecheck`: the plugin and the harness.
- `bun run check`: Biome, lint and format.
- `bun run harness`: build, then serve the UI harness on port 5803
  (`HARNESS_PORT` for another).
- `bun run harness:test`: build, then run the harness's Playwright tests.
  `HARNESS_SHOTS=<dir> bun run harness:test` also writes the screenshots.

### UI harness

`harness/` is a dev-only page that loads the built UI (`build/ui.js`) in an
iframe, as Figma does, under a fake main thread (`harness/fake-main.ts`). The
fake answers the UI's messages from the fixtures of one state
(`harness/fixtures.ts`): a member card design, its fields, and how its read
goes (a result with warnings, a failure, wrong-size sides, a progress that
never ends). Open a state in a browser:

```
http://localhost:5803/?state=export&theme=dark&w=320&h=480
```

`state` is a key of `STATES`, `theme` is `light` or `dark` (the UI kit's
`figma-light` / `figma-dark` variables), and `w`/`h` size the panel (320×480 when left out).
`window.harness.log` holds every message the UI sent, and
`window.harness.send(msg)` posts one to it.

The Playwright tests (`harness/tests/*.pw.ts`) cover the tabs by keyboard, the
unbind confirmation, the export steps, the result and its warnings, the
hand-off and Settings. `HARNESS_SHOTS=<dir>` also saves a picture of every
state in both themes at 320×480, again at 400×600, and a few at 480×720, at
2x so the 11 px text reads; they are compared with nothing,
so look at the ones a change touches. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to
use a Chromium other than Playwright's own, and `HARNESS_PORT` for another
port.
