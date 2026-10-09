# Proposal: materials (0.5)

Status: feasibility study, not yet scheduled.

A template can say which physical materials go on top of the printed piece,
such as a magnetic stripe, a signature panel, a laminate or overlay film, a
hologram or foil, and where they go. Studio draws each one on the canvas,
warns about artwork that conflicts with it, and exports list it so whoever
finishes the job knows what to apply.

## Verdict

This is feasible for 0.5 without changes to the engine or for-print. The
first version only needs three things:

- a new optional field in the format (1.7),
- an editor overlay and hint list modelled on the existing print guides,
- a column in the export report.

Material masks and PDF layers for print shops are larger and can wait.

## What exists today

| Need | Closest existing piece |
|---|---|
| Template data that changes no pixels | "Authoring extras" in `packages/coatfile/src/schemas.ts` (`safeArea`, `warnings`) |
| Additive format changes | Minor versions in `packages/coatfile/src/format.ts`, `minimumFormatVersion`, `assertWritable` |
| Drawing on the canvas without reaching exports | `apps/editor/src/canvas/PrintGuides.tsx`, mounted in `canvas/Overlay.tsx` |
| Physical sizes in template units | `printGuideMetrics` in `apps/editor/src/canvas/print-guides.ts` (CR80, mm per unit from the long side) |
| Layout warnings | `safeAreaHints` and the "Print hints" group in `apps/editor/src/app/IssuesPopover.tsx` |
| Production output | `export-report.csv` in `packages/workspace/src/export/job.ts`; PDF metadata in `packages/workspace/src/pdf.ts` |
| Assets for material artwork | `assets` and `asset:<sha256>` in the template and the `.coat` archive |

Nothing in the repository models materials, ribbon panels or keep-out areas
yet. for-print says on purpose that it does not know what a ribbon panel
is (`packages/for-print/src/plan.ts`), so materials should stay out of it.

## Format 1.7

Add an optional top-level `materials` array alongside `safeArea`. A
material is guidance only: a render with or without it draws the same
pixels, and so does a consumer that ignores it.

```jsonc
"materials": [
  {
    "id": "stripe",
    "kind": "magnetic_stripe",        // open string; known kinds listed below
    "side": "back",                   // a template_data frame name
    "region": { "x": 0, "y": 66, "width": 1012, "height": 150 },
    "keepOut": ["text", "barcode", "qr_code"],
    "label": "HiCo magnetic stripe",
    "note": "Apply after printing, before lamination"
  },
  {
    "id": "laminate",
    "kind": "overlay_film",
    "side": "front"                   // no region: the whole side
  }
]
```

- **`kind`** is a string, not an enum. A 1.7 reader would reject a kind
  added in 1.8, so known kinds go in a documented list instead:
  `magnetic_stripe`, `signature_panel`, `overlay_film`, `laminate`,
  `hologram`, `foil`, `chip`, `scratch_off`. Anything else is shown as a
  generic material.
- **`region`** is a rectangle in design units, the same units as `pos` and
  `size`. When it is left out, the material covers the whole side. A shaped
  region, such as a foil logo, can come in a later minor as
  `mask: "asset:<sha256>"`.
- **`keepOut`** lists element types that should not overlap the region. An
  empty list means the material is decorative, like a full laminate.
- **Validation:** `side` must name a frame, ids must be unique, and the
  region must sit within the trim plus bleed. These go in `refineTemplate`
  next to the existing inset checks.
- **Versioning:**
  - bump `FORMAT_MINOR` to 7;
  - add `need(7)` when `materials` is present;
  - regenerate `schema/` (`bun run schema:check`);
  - document the field in the coatfile README.

  Older kits keep reading these files and drop the field, and
  `assertWritable` stops them from saving a file that has it.
- **Variants:** a material applies to every variant in the first version.
  An optional `variants: string[]` (for example, a hologram only on a
  Premium variant) is a small follow-up.

## Presets

Most people won't know stripe offsets, so Studio adds materials from presets
in millimetres and converts them to template units with the same
mm-per-unit rule the CR80 guides use. Presets need a known physical size,
meaning `product: "card_cr80"` or a DPI, so they are offered only when Studio
knows one.

| Preset | Placement (CR80, landscape) |
|---|---|
| Magnetic stripe (ISO/IEC 7811) | Back, full width, about 5.5 mm from the top edge, 12.7 mm tall |
| Signature panel | Back, below the stripe, size chosen by the author |
| EMV chip contact (ISO/IEC 7816-2) | Front, about 10 mm from the left and 19 mm from the top, about 12 x 9 mm |
| Overlay film or laminate | Whole side, no keep-out |
| Hologram patch | Author-placed rectangle, decorative |

These figures must be checked against the standards before they ship.
Printers vary, so a preset fills in the region and the author can change
it.

## Studio

- **Canvas:** draw a `MaterialGuides` layer beside `PrintGuides` in
  `Overlay.tsx`. It shows each region as a tinted, labelled shape with a
  distinct look per kind, for example a stripe band, a hatched signature
  panel or a sheen for film. It follows the existing Print guides toggle, or
  gets its own toggle in View.
- **Editing:**
  - a Materials section in Design when nothing is selected, next to
    `SideSection`;
  - add from a preset, then edit side, region, keep-out and note;
  - edits use `scope: "base"` like bleed and safe area, so undo, autosave
    and the archive need no new code.
  - Dragging regions on the canvas can follow later.
- **Hints:** `materialHints(t)` beside `safeAreaHints`:
  - flags a layer whose box overlaps a region that keeps out its type,
    e.g. "Text 'Member name' sits under the magnetic stripe";
  - lists them under "Print hints", so they inform without blocking, as
    safe-area hints do today;
  - can reuse `boxOf` and `worldCorners` for rotated layers.

## Exports

- **Report:** add a `materials` column to `export-report.csv` listing the
  kinds per side, so whoever finishes the job sees what to apply.
- **PDF:** put the material list in the PDF Subject or Keywords. A full
  production-notes page is optional and off by default.
- **Later:** export one mask image per material (white region on black) as
  a separate file in the zip. Print shops use these for foil, spot UV or
  overlay-panel masks. Real PDF optional-content layers or spot-colour
  plates need vector output in `pdf.ts`, which is raster-only today, so
  they are out of scope for 0.5.

## Figma

Optional: layers named with a marker, such as `#material:magnetic_stripe`,
could export as materials instead of artwork, the same way field markers
are read now. This is independent of the work above.

## Phasing

| Phase | Scope | Size |
|---|---|---|
| 1 (0.5) | Format 1.7 field, validation, schema, README; Studio overlay, Materials section, presets, hints; report column | Medium |
| 2 | Variant scoping, canvas region dragging, PDF notes page, Figma markers | Small to medium |
| 3 | Shaped regions through `mask` assets, per-material mask exports | Medium |
| 4 | Vector PDF layers or spot plates, overlay-panel masks for YMCKO printers | Large, needs PDF work |

## Risks and open questions

- **Physical units:** templates have no DPI or unit, so presets depend on
  `product` or a preset DPI. Should 1.7 also add an optional physical size,
  or keep inferring it?
- **Scope creep toward finishing:** materials are hints, not process
  control. Should for-print ever use them, for example to skip the overlay
  panel under a mag stripe? If yes, a mask export (phase 3) is the
  interface, and for-print still never needs to know material kinds.
- **Per-side or template-level:** this proposal keeps one array tagged by
  `side`, which fits the existing frame-name addressing. Moving it onto
  each frame instead would be a heavier schema change.
- **Public API:** `materials` becomes part of the published coatfile types,
  so the field names should be settled before release.
