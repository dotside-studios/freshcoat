# Studio contribution ideas

Small, self-contained Studio tasks for a first contribution. Check the current
code and open issues before choosing one; these ideas may already be implemented. Each one names the files
to start from and what "done" means. They follow patterns the code already
has, so the nearest existing example is usually the best guide.

Read [CONTRIBUTING.md](../CONTRIBUTING.md) first, and say on the issue (or
open one) that you are taking a task, so two people don't do the same one.
Paths are relative to `freshcoat/`.

## 1. A5 paper for sheets

Sheets offer A4, Letter, Legal, A3, Tabloid and Custom. Add A5
(148 × 210 mm), which suits badges and postcards.

- **Files:**
  - `packages/workspace/src/types.ts`: `PaperName`;
  - `packages/workspace/src/impose.ts`: `PAPER_SIZES_MM`;
  - `packages/workspace/src/archive.ts`: the `paper` enum in the preset schema;
  - `apps/editor/src/export/sheets.ts`: `PAPER_LABEL` and `PAPER_CHOICES`.
- **Done when:**
  - the Paper select in a Sheets preset lists A5, after A4;
  - a `.coatworkspace` with an A5 preset saves and opens again;
  - `packages/workspace/src/impose.test.ts` imposes CR80 cards (85.6 × 54 mm) on A5 and checks
    the count and orientation Auto picks;
  - Sheets in [features.md](features.md) lists A5.

## 2. A business card size on the welcome screen

The welcome screen's new-template sizes are CR80 card, A4 landscape, square,
portrait poster and badge. Add a US business card: 3.5 × 2 in at 300 dpi
(1050 × 600), front and back.

- **Files:** `apps/editor/src/doc/new-document.ts` (`PRESETS`), which both the
  welcome screen and `?new=<id>` read.
- **Done when:**
  - the welcome screen shows it, and `/?new=business-card` opens it;
  - `apps/editor/src/tests/samples.test.ts` still validates every preset, and a
    new case checks its size and two sides;
  - the `?new=` row of the Links table in [features.md](features.md) lists
    `business-card`.

## 3. A shipping label starter

Add a 4 × 6 in shipping label (1200 × 1800 at 300 dpi) with `name`,
`address`, `city` and `tracking` fields and a Code 128 of `{{tracking}}`,
opening with a PDF preset of one label per page.

- **Files:** a new `apps/editor/src/samples/shipping-label.ts`, modeled on
  `event-badge.ts`, and an entry in `STARTERS` in
  `apps/editor/src/samples/starters.ts`. See "Add a starter" in
  [CONTRIBUTING.md](../CONTRIBUTING.md#add-a-starter).
- **Done when:**
  - it is listed under Start from, and `/?starter=shipping-label` opens it;
  - the template validates, and its barcode encodes the sample tracking
    number (`apps/editor/src/tests/starters.test.ts`);
  - its preset is PDF at 300 dpi, one per page
    (`apps/editor/src/tests/starter-preset.test.ts`);
  - `apps/editor/e2e/starters.spec.ts` opens it and exports one record;
  - it has no Davi branding.

## 4. Add a gradient stop from the keyboard

On the stop bar, arrow keys move the selected stop and Delete removes it, but
adding a stop needs a pointer.

- **Files:** `apps/editor/src/panels/design/StopBar.tsx` (`onKeyDown`), and
  `insertStop` and `colorAt` in `apps/editor/src/panels/design/fills.ts`.
- **Done when:**
  - Enter or `+` on a focused stop adds one halfway between it and the next
    stop (or the previous one, for the last stop), in the gradient's color at
    that point, and selects it;
  - it is one undo step;
  - `apps/editor/src/tests/stop-bar.test.tsx` covers the middle and the last stop;
  - the Inspector bullet in [features.md](features.md) mentions it.

## 5. Move a gradient stop to either end

Home and End on a focused stop could put it at 0% and 100%, as they do on any
ARIA slider (each stop is already `role="slider"`).

- **Files:** `apps/editor/src/panels/design/StopBar.tsx` (`onKeyDown`, with
  `moveStop` from `fills.ts`).
- **Done when:**
  - Home moves the selected stop to 0% and End to 100%, keeping it selected
    after the stops are re-sorted;
  - a test in `apps/editor/src/tests/stop-bar.test.tsx` covers both keys.

## 6. A test for the barcode type list

The Barcode section's Type select groups the eight symbologies under 1D and
2D, labeled by coatfile's `symbologyLabel`. No test opens it.

- **Files:** `apps/editor/src/tests/barcode-section.test.tsx`, and `GROUPS` in
  `apps/editor/src/panels/design/BarcodeSection.tsx`.
- **Done when:** a test opens the Type select and checks that 1D lists Code
  128, EAN-13, UPC-A, Code 39 and ITF-14, and 2D lists PDF417, Data Matrix and
  Aztec, in that order and with exactly those labels.

## 7. Search the keyboard shortcuts

The shortcuts sheet (`?`) lists every command with keys, grouped, with no way
to find one.

- **Files:** `apps/editor/src/app/ShortcutsDialog.tsx`, and a text field from
  `@freshcoat-js/ui/field`.
- **Done when:**
  - a search field at the top filters by command label, case-insensitively,
    and hides groups left empty;
  - with no match it reads "No shortcuts" (see the copy rules);
  - a new `apps/editor/src/tests/shortcuts-dialog.test.tsx` covers a match, no
    match and clearing the field.

## 8. Step through preview records from the keyboard

In Edit, the record stepper in the Content tab previews the previous or next
record with its buttons only.

- **Files:** `apps/editor/src/app/commands.ts` (two commands with
  `sections: ["edit"]`), `apps/editor/src/panels/content/RecordStepper.tsx` for
  how it moves, and `previewRecord` in `apps/editor/src/app/controller.ts`.
- **Done when:**
  - two commands, "Previous record" and "Next record", step the preview on a
    free chord, disabled at either end or when the template is not bound.
    Arrow keys in Edit always nudge (see `app/Editor.tsx`), so pick something
    like `Alt+[` and `Alt+]`, and check `COMMANDS` for clashes;
  - they appear in the shortcuts sheet;
  - `apps/editor/src/tests/commands.test.ts` covers both, and the ends.

## 9. Width and height in the export report

Every image export writes `export-report.csv` with `file`, `record`, `side`,
`status`, `error`, `print` and `gamut`. With sizes taken from each photo, the
output size varies per file and is worth recording.

- **Files:** `packages/workspace/src/export/job.ts`: `JobItemResult` and
  `reportCsv`. Each render already returns `width` and `height` in
  `RenderOutput` (`packages/workspace/src/export/item.ts`).
- **Done when:**
  - the report has `width` and `height` columns after `side`, filled for
    rendered items and empty for failed ones;
  - `apps/editor/src/tests/export-job.test.ts` checks the header and one row of
    each kind.

## 10. Guard more British spellings in the copy

The copy guard keeps "colour", "centre" and "optimis" out of the interface.
The style guide asks for American spelling throughout.

- **Files:** `FORBIDDEN` in `apps/editor/src/tests/copy.test.ts`.
- **Done when:**
  - it also rejects "grey", "catalogue", "licence", "behaviour" and "organis";
  - nothing that is code rather than copy trips it (import paths are
    already skipped; identifiers such as `catalogue.ts` must stay allowed);
  - the suite passes, and adding a temporary `label="Grey"` makes it fail.
