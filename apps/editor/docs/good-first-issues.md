# Studio contribution ideas

Small, self-contained Studio tasks for a first contribution. Check the current
code and open issues before choosing one; these ideas may already be implemented. Each one names the files
to start from and what "done" means. They follow patterns the code already
has, so the nearest existing example is usually the best guide.

Read [CONTRIBUTING.md](../CONTRIBUTING.md) first, and say on the issue (or
open one) that you are taking a task, so two people don't do the same one.
Paths are relative to `freshcoat/`.

## 1. A shipping label starter

The blank 4 × 6 in shipping label size (1200 × 1800 at 300 dpi) is already a
new-template preset. Add a starter of that size with `name`, `address`,
`city` and `tracking` fields and a Code 128 of `{{tracking}}`, opening with a
PDF preset of one label per page.

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

## 2. Add a gradient stop from the keyboard

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

## 3. Move a gradient stop to either end

Home and End on a focused stop could put it at 0% and 100%, as they do on any
ARIA slider (each stop is already `role="slider"`).

- **Files:** `apps/editor/src/panels/design/StopBar.tsx` (`onKeyDown`, with
  `moveStop` from `fills.ts`).
- **Done when:**
  - Home moves the selected stop to 0% and End to 100%, keeping it selected
    after the stops are re-sorted;
  - a test in `apps/editor/src/tests/stop-bar.test.tsx` covers both keys.

## 4. A test for the barcode type list

The Barcode section's Type select groups the eight symbologies under 1D and
2D, labeled by coatfile's `symbologyLabel`. No test opens it.

- **Files:** `apps/editor/src/tests/barcode-section.test.tsx`, and `GROUPS` in
  `apps/editor/src/panels/design/BarcodeSection.tsx`.
- **Done when:** a test opens the Type select and checks that 1D lists Code
  128, EAN-13, UPC-A, Code 39 and ITF-14, and 2D lists PDF417, Data Matrix and
  Aztec, in that order and with exactly those labels.

## 5. Search the keyboard shortcuts

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

## 6. Width and height in the export report

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

## 7. Guard more British spellings in the copy

The copy guard keeps "colour", "centre" and "optimis" out of the interface.
The style guide asks for American spelling throughout.

- **Files:** `FORBIDDEN` in `apps/editor/src/tests/copy.test.ts`.
- **Done when:**
  - it also rejects "grey", "catalogue", "licence", "behaviour" and "organis";
  - nothing that is code rather than copy trips it (import paths are
    already skipped; identifiers such as `catalogue.ts` must stay allowed);
  - the suite passes, and adding a temporary `label="Grey"` makes it fail.
