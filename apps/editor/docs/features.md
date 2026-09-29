# Studio features

What Freshcoat Studio does, in detail. The [README](../README.md) has the short
version, and [ARCHITECTURE.md](../ARCHITECTURE.md) explains how it is built.

A workspace holds several templates, the data that fills them and the export
presets that print them. The editor has three sections, switched from the menu
bar or with Ctrl/Cmd+1, 2 and 3: **Edit** designs a template, **Data** keeps
the records, and **Export** turns templates and records into files.

## Overview

- **Workspaces:**
  - Start from a starter, a preset size (CR80 card, A4, square, poster, badge)
    or a bundled sample, or open a `.coatworkspace`, `.coat`, `.coat.json` or
    template `.json` with **Open file…** (Ctrl/Cmd+O). Files saved before the rename, `.tkit` and `.tkit.json`,
    still open. A template opened on its own becomes a one-template workspace.
  - Save the whole workspace as `.coatworkspace` with Ctrl/Cmd+S.
  - Templates are exported on their own, as with VS Code's workspaces: the
    active one as `.coat` or `.coat.json`, or all of them as a zip of `.coat`
    files. The current side still exports as a PNG at 1×, 2× or 3×.
  - The Templates list adds, duplicates, renames and removes templates. Each
    keeps its own undo history, side and view.
  - Unsaved work is autosaved to IndexedDB, and the welcome screen offers to
    restore it. Photos are stored apart from the templates and data, each once, so an
    edit does not rewrite them.
- **Starters:** the welcome screen's **Start from** group lists designs meant
  to be made your own, ahead of the samples:
  - **Davi card**, CR80 landscape, and **Davi card, portrait**: name,
    position and organization, a QR of the card link on the back, the Davi
    wordmark, and cobalt, sage and plum variants;
  - **Photo watermark**: a full-bleed photo with a mark pinned to its
    bottom-right corner, opening with a "Watermarked photos" preset that
    sizes each output from its photo, as JPEG at 90, named after the photo;
  - **Event badge**: a 4 × 3 in badge with a ticket barcode and Speaker and
    Staff variants, opening with a "Badges on A4" preset that prints four to
    a sheet with crop marks.
- **Print guides:** View > Print guides draws a CR80 card's trim corners and
  its 3 mm safe area on the overlay. It is on by default for `card_cr80`
  templates, scales with the template's size, and never reaches an export.
  A layer whose edge falls between the trim and the safe line is listed
  under "Print hints" in the status bar's Issues list.
- **Constraints:** each layer pins its horizontal and vertical edges (left,
  right, both, center or scale), as in Figma. "Resize with constraints"
  under the template size re-places layers by them, and an export sized
  from a photo lays the design out at the photo's aspect the same way.
- **Data:**
  - Datasets are a schema (typed columns: text, long text, number, integer,
    yes/no, date, color, URL, email, image) and the records that follow it.
  - A virtualized grid edits cells in place, with an editor per type, and
    marks every value the schema rejects.
  - The Columns panel sets a column's type, title, default and constraints.
    Changing a type says how many values would not convert. Renaming a column
    repoints the bindings that read it, in the same undo step.
  - Import CSV, TSV, Excel (`.xlsx`, `.xls`), `.ods`, `.numbers`, JSON or
    NDJSON through a wizard that maps each source column to a schema column
    or a new one, and can match existing records by a key column instead of
    appending.
  - Photos: see [Photos](#photos).
  - Import and export the schema as JSON Schema 2020-12, and the records as
    CSV, Excel or JSON.
- **Export:**
  - Presets name a template, which records (all, pending, failed or
    selected), which sides, the size (the template's, or each record's
    photo), the format (PNG, JPEG or WebP zip, or PDF) with its quality,
    where the files go, and a file name pattern such as
    `{{member_id}}-{{side}}`.
  - The preview comes first, with a filmstrip of the records the preset
    will export (or all of them) under it: click a thumbnail or use the
    arrow keys. A template that binds a photo also shows the source, or
    both either side of a draggable divider.
  - A Records tab beside the filmstrip lists each record's status (pending,
    exported, failed, skipped), which can be set by hand; an export marks
    what it made.
  - Rendering runs in a pool of module workers, each with its own CanvasKit.
    The job bar shows progress, items per second, the time left, bytes
    written and where they go, and after a job "Show failed", "Retry
    failed" and the report. It stays one line at every width, giving up
    detail as the window narrows.
  - An image export is a zip with an `export-report.csv`; a PDF has one page
    per record and side, sized as the design (or the photo) at the preset's
    DPI, with PNG or JPEG page images, or lays the cards out on sheets of
    paper with crop marks (see [Sheets](#sheets)).
- **Binding:** each template binds its fields to a dataset's columns, a fixed
  value, or a pattern. In Edit, the record stepper previews real records on
  the canvas.
- **Canvas:**
  - Selection: click, Shift-click, marquee, and double-click to drill into a
    group.
  - Move, resize and rotate, with snapping to the artboard and to other layers.
  - Arrow keys nudge a layer, and Esc cancels a drag.
  - Pan and zoom with the wheel, pinch, Space-drag or the keyboard.
  - Creation tools: frame, rectangle, ellipse, text, image, QR and barcode.
  - Gradient handles on the selected layer: a linear gradient's endpoints, a
    radial one's center and two radii, an angular one's center and rotation,
    and a dot per stop. Shift snaps directions to 15 degrees, and a click on
    the line adds a stop.
- **Left panel:** Templates, Sides, Variants and Layers, top to bottom. Each
  section's header collapses it, and the panel remembers which are collapsed;
  collapsing one above Layers gives Layers the room.
- **Layers:**
  - One side is shown at a time; the Sides list switches between them.
  - Rename in place, reorder or reparent by drag and drop, group and ungroup.
  - Hide and lock layers; neither is written to the file.
  - A context menu on every layer.
- **Inspector:**
  - Geometry, blend mode and alignment.
  - Fills (solid, linear, radial and angular) and strokes. A gradient's stops
    are edited on a bar: drag, click to add, drag off or Delete to remove,
    and arrow keys to nudge. Reverse and rotate 90 degrees are one click.
  - Corners, text, image, QR, barcode, vector path, frame and auto layout, mask,
    effects and conditional visibility.
  - Text aligns left, center, right or justified; a justified layer also
    sets its last line's alignment. Direction is left to right, right to
    left, or taken from the text.
  - A font picker over the whole Google Fonts catalog: search, category
    chips, sort by popularity or name, the template's own families first, and
    each family previewed in its own face. Picking one adds it to the
    template's fonts with the weights in use, in the same undo step.
  - When several layers are selected and a value differs between them, it shows
    `Mixed`.
  - With nothing selected, the side section edits the template's width and
    height, which every side shares.
- **Content:** the inspector's second tab, what fills the design.
  - "Try with <dataset>" steps the canvas through the bound dataset's records.
  - One list of fields: each row has the key, a required mark, the type and
    its sample value, typed in place. Sample values drive the render without
    touching history, and "Reset to samples" puts them back.
  - Expanding a row edits the field's definition. Fields can be added, renamed
    (every `{{token}}` is rewritten) and deleted. A field that is still in use
    cannot be deleted, and the editor lists what uses it.
  - Fields a pipeline fills in are listed under "From the system".
- **Template setup:** File > Template setup… (`Mod+Alt+,`) holds the
  template's name, id, description, version, product, size and fonts (with
  whether each one loaded). Saving a template that has never been named opens
  it first as "Name this template", once for each unnamed template in a
  workspace.
- **Issues:** the status bar's Issues button counts validation, variant,
  file, render and loading issues, and opens the list: each issue links to the
  layer or variant it is about, and print and preview hints are listed without
  being counted. A save that fails validation opens it.
- **Undo and redo:** every command has one undo step. A drag, a burst of typing
  or a run of nudges is a single step.
- **Keyboard:** everything has a shortcut; press `?` to list them.
- **Themes:** light (the default), dark, or following the system, from
  View > Theme and remembered per browser under `freshcoat.theme`. The
  theme is set before first paint, so a dark user never sees a light flash,
  and native scrollbars and controls follow it. Every color in the chrome is
  a token with a light and a dark value, and a unit test holds both themes to
  WCAG contrast: 7:1 for text, 4.5:1 for muted text and for white on the
  accent, 3:1 for faint text.
- **Type:** the chrome is set in Inter, and code and numbers in JetBrains
  Mono, both bundled; numbers in fields, the grid and the status bar use
  tabular figures so columns line up. Template fonts on the canvas come from
  the template.

It is built for desktop and is usable on a tablet from about 1024px wide:
- touch targets grow under `(pointer: coarse)`;
- two fingers pinch and pan;
- Edit's panels dock from 960px and overlay below that;
- below 1100px the Data section's record panel and the Export section's
  presets and settings become sheets, so the records and the preview keep
  the full width;
- the menu bar has a toggle for each panel.

## Links

A URL says what to open and what is shown, and never carries data.

The path is the section, `/edit`, `/data` or `/export`; `/` goes to
`/edit`. `/kit` is the UI kit gallery, and `/bench?sample=<id>&frames=<n>`
runs the benchmark.

These open something once, and are then removed from the URL by replacing
the history entry, so a reload does not reopen them over your work.
An autosave found at the same time is offered as a toast with a Restore
action.

| Parameter | Opens |
|---|---|
| `?sample=<id>` | a bundled sample: `membership-card`, `certificate`, `minimal` |
| `?starter=<id>` | a starter: `davi-card`, `davi-card-portrait`, `photo-watermark`, `event-badge` |
| `?new=<preset>` | a new template: `card-cr80`, `a4-landscape`, `square`, `portrait-poster`, `badge` |

A template can also arrive in the fragment, as the Figma plugin sends it:
`#coat=<data>`, with `#open=1` pointing at **Open file…** when the template
was too large for a link. A page that opens Studio in a tab it keeps can add
`&return=<its origin>`; that template then has a **Send to <host>** button in
the menu bar, which posts it back to that tab. The page answers whether it
took it, and Studio says so. If the tab is closed or does not answer, export
a `.coat` and import it there instead.

`?theme=light` or `?theme=dark` sets the theme for this tab without saving
it, and stays.

The rest of the search follows what is shown, for example
`/export?template=t_ab12cd34&record=r_0007&preset=p_y`:

| Key | Holds |
|---|---|
| `template` | the active template's id |
| `side` | the side shown in Edit |
| `record` | the record previewed in Edit, or shown in Export |
| `dataset` | the active dataset |
| `preset` | the active export preset |

- Keys at their default are left out, so a fresh template is plain `/edit`.
  Unknown keys are dropped.
- Changing section adds a history entry, so Back returns to the previous
  section; everything else replaces the entry, so stepping through 200
  records does not fill the history. Writes are coalesced to one a frame.
- Ids are the workspace's own, which autosave and `.coatworkspace` keep: a
  reload returns to the same place, and a link means the same thing to
  anyone who has the same workspace file. Unknown ids are ignored and the
  URL is rewritten to what is actually shown.
- The store owns what is shown and the router ([TanStack
  Router](https://tanstack.com/router), code-based routes) mirrors it.
  Back, Forward or an edited URL is applied to the store, then written back.
- Phase 3 links still work, each redirected with a replaced entry: `/?kit`
  goes to `/kit`, `/?bench&…` to `/bench?…`, and a hash such as
  `/#section=data&template=…` to `/data?template=…`.

### Routes

TanStack Router 1.170.33, with code-based routes and browser history. The
production server (`apps/editor/server.ts`) falls back to `index.html`, so every
path loads directly.

| Path | Renders | Search |
|---|---|---|
| `/` | redirects to `/edit`, keeping the search | |
| `/edit`, `/data`, `/export` | the editor, in that section | `template`, `side`, `record`, `dataset`, `preset`, and once: `sample`, `starter`, `new` |
| `/kit` | the UI kit gallery, a lazy chunk | |
| `/bench` | the benchmark over the editor, a lazy chunk | `sample`, `frames` |
| `/?kit`, `/?bench&…`, `/#section=…` | the phase 3 forms, redirected with `replace` | |

- Search params are plain `key=value` pairs (`parseSearch` and
  `stringifySearch` in `url-state.ts`), so an id such as `123` is not
  quoted as the router's JSON encoding would.
- The store owns view state. A section change pushes a history entry;
  every other change replaces it, once a frame. Only Back, Forward and an
  edited URL are applied to the store, through the same `planView` the
  hash sync used.

## Photos

Freshcoat is built to put a mark on a few hundred camera photos as well as
to fill cards with records.

- **Import:** "Add photos" takes files and zips; the Add menu also takes a
  folder (a directory picker where the browser has one, else a folder
  input), and photos, zips or folders can be dropped anywhere on the Data
  section. Hidden files and non-images are skipped and counted. Photos are
  matched to records by file name, and the import toast offers to add the
  unmatched ones as records.
- **Photo datasets:** "New dataset from photos" (in Add, the Datasets list
  and the empty state) makes one record per distinct photo, sorted by file
  name, with `photo`, `file_name`, `width` and `height` as seen, and
  `taken_at` from EXIF. Dropping photos on an empty Data section does the
  same, and a spreadsheet dropped there opens the import wizard.
- **Gallery:** a dataset whose first image column is among its first three
  opens as a virtualized gallery of cards (S, M or L), each with its
  thumbnail, title, status and issues, and selects like a photo library:
  click, Shift, Ctrl/Cmd and Ctrl/Cmd+A. The table is one click away.
- **Record tab:** opening a record shows each of its photos large, with its
  size, file size and format, and a form for every field with the grid's
  editors. It steps through the shown records and sets their status.
- **Size from the photo:** an export preset can take each item's size from a
  bound photo, capped by "Limit long edge" if set. The design is laid out at
  the photo's aspect by its constraints, with its shorter side kept, so a
  mark stays the same size relative to the photo's short edge whether the
  photo is landscape or portrait. The preview shows each record at its
  photo's aspect, and Source and Split compare it with the photo.
- **Formats:** PNG, JPEG or WebP zips (JPEG is flattened over white, since it
  has no alpha), or a PDF with PNG or JPEG page images. A pattern token whose
  value is a photo's file name drops that extension, so `{{file_name}}`
  names each output after its photo and the format supplies the extension.
- **Destinations:**
  - **Download** (everywhere): zips in memory and hands over a part each
    time one reaches 512 MB, `<name>-part-1.zip` and so on; a job that fits
    in one part is a single `<name>.zip`.
  - **Zip file** (Chromium): one zip written into the chosen file as it is
    made.
  - **Folder** (Chromium): each file written into the chosen folder as it is
    made, the report last. Cancelling keeps what was written and says how
    many.
- **Memory:**
  - photos stay the Blobs the browser already holds for the picked files,
    and moving one to a worker does not copy its bytes;
  - width, height and orientation are read from each file's header, without
    decoding it, and photos are hashed two at a time as they are imported;
  - every grid, gallery, filmstrip and cell shows thumbnails made in a
    worker, at most 600 or 64 MB of them; no grid surface decodes a whole
    photo;
  - the live previews decode photos at preview resolution (the long edge at
    most the larger of the window and 2048 device pixels, capped at 4096),
    and only export renders read them whole, in the workers;
  - each render worker keeps its decoded photos in an LRU bounded at 48
    megapixels, the pool is at most 4 workers (2 past 24 MP photos), and at
    most twice the pool's size of finished outputs wait to be written;
  - `.coatworkspace` files are written and read as streams, one photo at a
    time, and autosave stores each photo once, apart from the templates and data. When
    the browser's storage is full it keeps the templates and data and says
    that it could not keep the photos.

## Barcodes

The Barcode tool (B, after QR in the tool strip) draws a 360 × 120 Code 128
reading "FRESHCOAT". Its inspector section sets the type, the value (with
the same field-insert menu as a text layer), the human-readable line and its
size, the bar and background colors, the margin (the quiet zone, in
modules) and, for PDF417 and Aztec, the error correction.

| Type | Kind | Takes |
|---|---|---|
| Code 128 | 1D | any Latin-1 text |
| EAN-13 | 1D | 12 digits, or 13 with a correct check digit |
| UPC-A | 1D | 11 digits, or 12 with a correct check digit |
| Code 39 | 1D | digits, capitals, space and `-.$/+%` (lowercase is uppercased) |
| ITF-14 | 1D | 13 digits, or 14 with a correct check digit |
| PDF417 | 2D, wide | any text; error correction levels 0 to 8 |
| Data Matrix | 2D, square | any text |
| Aztec | 2D, square | any text; error correction 5 to 95% |

- **Shape:** switching to Data Matrix or Aztec squares the box about its
  center, and switching from one of them back to a 1D code gives the box a
  bar code's proportion again (the width kept, a third of it high), in the
  same undo step. PDF417 keeps whatever box it has, since it reads wide. 1D
  bars fill the height left above the text.
- **Validation:** the section checks the value the canvas is showing (the
  current record's, when one is bound) and says what is wrong in red under
  the value, such as "EAN-13 check digit should be 1". The Issues list names
  each refused code under Preview hints, with a link to its layer.
- **Crisp output:** the coat engine snaps a barcode's modules to whole output
  pixels whenever it is not rotated, so bars never land on a partial pixel
  at any export scale, and for-print never adjusts one.
- **Export failures:** an export item whose barcode is invalid, or that
  could not load the encoder, fails with `Barcode: <message>` and marks its
  record failed. A placeholder is never exported in place of a code.
- **The encoder:** bwip-js is about 85 KB gzipped, so it is a chunk of its
  own (`@freshcoat-js/coatfile/barcode`), fetched the first time a template with
  a barcode opens or the tool is chosen. Until then, and in any app that
  never registers it, a barcode draws a hatched placeholder with a warning.
  The export workers register it when they start. Any other app using the
  kits can load it the same way, only for templates that have a barcode.

## Sheets

A PDF preset's Layout group chooses **One per page** (the default) or
**Sheets**, which lays cards out on paper at their trim size with crop marks.

- **Paper:** A4, Letter, Legal, A3, Tabloid, or Custom in millimeters.
  Orientation is Auto, Portrait or Landscape; Auto takes whichever fits more
  cards, portrait on a tie. Margin (10 mm by default) and Gap (0) are in
  millimeters. The grid is centered inside the margins.
- **Crop marks** (on by default): 0.25 pt black lines 4 mm long, starting
  1 mm outside each cut line, in the margin and in gaps wide enough to hold
  them (10 mm), never across a card. They are drawn on fronts only, since
  the cut is made from the front.
- **Double-sided:** when it is on, "Flip on" picks Long edge or Short edge,
  to match the printer's setting. Each record's back goes on the next page
  in the slot that lands behind its front. A flip mirrors the sheet across
  the edge it turns over, so on a portrait sheet a long-edge flip mirrors
  the columns and a short-edge flip the rows. On a landscape sheet it is the
  other way about: the long edge runs across, so a long-edge flip mirrors
  the rows. A record whose front failed keeps its back in its slot.
- **More:** Back offset X and Y (mm) nudge every back page to correct a
  printer's drift, and, for a one-sided template under Double-sided, "Blank
  backs" puts an empty back page after each sheet of fronts, so a duplex
  printer keeps its page pairs (off by default: fronts only).
- **Summary:** a line under the group reads "10 per sheet · 21 sheets" for
  the records the Export button would run. A layout that can't be imposed (a
  card larger than the paper inside its margins, or a template with more
  than two sides under Double-sided) says why inline and disables Export;
  the job bar shows a short form, such as "Doesn't fit the paper", with the
  whole message on hover.
- **Sheet preview:** Sheet joins Output, Source and Split in the preview
  toolbar. It draws the current sheet at its paper's aspect, each slot with
  its record rendered at a low scale, plus the crop marks, and steps with
  "Sheet 3 of 21". A Front and Back switch picks the side of a double-sided
  sheet. Picking a record in the filmstrip moves to its sheet and outlines
  its slot.

## Variants

A variant is one version of a design: the Davi card in cobalt, sage and
plum, or a badge for speakers and staff. Every variant shares the template's
layers and records only what it changes, so an edit to the design itself
reaches every variant at once.

- **The list:** the Variants list, below Sides in the left panel, starts with
  **Default**, the design with no variant applied, then each variant with its
  swatch and how many layers it changes. The header's `+` (or, while there are
  none, the row under Default that says what a variant is for) adds one and
  opens its name for editing. A variant's menu (right-click, the context-menu
  key or Shift+F10) renames it (also F2 or a double-click), duplicates it,
  sets its swatch (or suggests one from the side's background), moves it up
  or down, changes its id and deletes it. The list is a listbox: the arrow
  keys move between variants.
- **Editing in a variant:** selecting a variant makes it the one you edit.
  A bar across the top of the canvas says "Editing Speaker", with how many
  layers it changes and **Back to Default**, and the status bar names it.
  Changes on the canvas and in the inspector become that variant's own and
  leave Default as it was; setting a value back to Default's removes the
  change. One edit is one undo step, as anywhere else.
- **What a variant can change:** a side's background, and for each layer its
  position, size, rotation, opacity, whether it shows, and any of its own
  properties (fill, stroke, text, font, color, and so on). Effects, blend
  mode, constraints, auto-layout sizing and visibility conditions are the
  same in every variant: their sections say so while a variant is active,
  and edits there change Default.
- **Structure is shared:** adding, deleting, duplicating, grouping,
  reordering and renaming layers and sides applies to every variant, and
  keeps each variant's changes with the layers they belong to.
- **Markers:** a control whose value comes from the variant has an accent
  dot before its label ("Changed in Speaker"); clicking it offers **Reset
  to Default**. A section with changed values marks its header, and its
  reset drops them all. The layer tree marks each layer the variant changes,
  and dims one it hides, with a crossed eye.
- **Hiding:** **Hide in Staff** in a layer's context menu or its Visibility
  section leaves the layer out of that variant only. The layer tree's eye
  stays an editing aid that is never saved.
- **Ids:** a variant's id is made from its first name and does not follow a
  rename, because files, bindings and card shop orders store it. **Change
  id…** changes it deliberately, warns that anything saved with the old id
  shows the Default design instead, and repoints the workspace's bindings.
- **Issues:** a change to a layer that no longer exists, or a change that
  changes nothing, is listed in the status bar's Issues list with the variant's name. Selecting
  one shows that variant and layer, and **Remove unused changes** drops
  every orphaned change in one step.
- **Exporting:** a binding picks the variant each record gets: Default, a
  fixed variant, a column naming the variant id, or **All variants**. All
  variants exports each record in Default and then in every variant that
  changes something, each variant's sides together, so duplex sheets pair
  them. A template with no dataset picks its variant in the Export section.
  `{{variant}}` in a file name is the variant id, or `default`; under All
  variants a pattern without it gets `-{{variant}}` appended, so no two files
  share a name. The filmstrip and the preview show each item in its own
  variant.

In the file, variants are coatfile 1.4 deltas. `@freshcoat-js/coatfile`'s
README documents them, and `checkVariants`, the lint behind the Issues
entries.

## Starters

### Event badge

A 4 × 3 in badge at 300 dpi (1200 × 900), front only, with `name`,
`company`, `role` and `ticket_id` fields, a color band, and a Code 128 of
`{{ticket_id}}` with its text. Its **Speaker** and **Staff** variants
recolor the band and the role chip, and Staff also hides the barcode and the
rule above it, since staff have no ticket to scan. It opens with a "Badges
on A4" preset: PDF, Sheets, A4, Auto (landscape, four to a sheet) and crop
marks on. The membership card sample's back carries a Code 128 of
`{{member_id}}`, and its Midnight variant recolors the front and moves the
tier chip onto the QR panel.

## Fonts

The font picker opens from a text layer's family field and from Template >
Fonts > Add font…. It lists the whole Google Fonts catalog, searchable
(fuzzy on the name), with category chips, sort by popularity or name, and
the template's own families first. Each row in view is previewed in its own
face from css2 with `text=<family>`, at most 6 requests at a time, cached
for the session, falling back to the UI font. Picking a family adds it to
the template with the weights in use, in one undo step.

The catalog is `apps/editor/src/fonts/google-fonts.json`, a committed snapshot of
`fonts.google.com/metadata/fonts` (about 29 KB gzipped), loaded the first
time the picker opens. `bun run fonts:update` in `apps/editor`
refreshes it.

## Exporting selected records

- **Data:** with records selected in the table or gallery, "Export
  selected" (Mod+E) opens a popover to pick a preset bound to the dataset,
  the active one first, and runs it. The section stays Data, and the job
  shows in a job bar at its foot.
- **Export:** the filmstrip selects with Shift-click, Mod-click and Mod+A
  (a plain click still only previews), and the Records tab's checkboxes
  share the selection. The button reads "Export N selected".
- The preset is never changed: the run replaces its record filter with
  exactly the chosen ids, in dataset order. The summary and history name

## Print output

A preset's Print group has "Optimize for card printer", which renders
through for-print's card-printer path (photo analysis, gray balance and the
whole-frame finish), as Davi's card shop does. The Davi card starters open with
a "Card printer" preset that has it on.

- **Profile:** None, or Import… of a `.json` print profile measured from
  for-print's print chart, shown with its name and date and removable. A malformed one
  is refused with a message.
- **Printer file:** the preview's "Printer file" toggle renders the current
  record through the same path. The note under it reads "Printer file, not
  a proof of the printed card", and adds how much photo color was pulled
  into printer range when that is 2% or more. This is for-print's
  correction, not ICC soft-proofing.
- **Fallback:** when the print path fails for an item, it is rendered plain
  and counted as a warning. The report CSV has `print` (`on`, `fallback` or
  `off`) and `gamut` columns.

## Copy

Every string in the interface follows the [copy guide](../CONTRIBUTING.md#copy): short and plain, sentence
case, no periods on labels, buttons, toasts or one-line hints, American
spelling, "Couldn't …" for failures, and one vocabulary (template, side,
layer, field, dataset, record, column, preset, export). Shared strings live
in `src/app/copy.ts`, and a guard test keeps the retired words out.

## Render stats

The status bar shows user facts: the side, the size, the selection, issues
and the zoom. View > Render stats, off by default and remembered per
browser (`freshcoat.renderStats`), adds the render timings.

## The `.coatworkspace` format

A zip, so a workspace is one file and its images travel with it:

```
mimetype                          application/vnd.freshcoat.workspace+zip, stored, first
workspace.json                    name, template entries and bindings, presets
templates/<id>.coat               each template, in the same format as a lone .coat
data/<id>/schema.json             the dataset's columns as JSON Schema
data/<id>/records.json            its records and their export status
data/<id>/assets/<sha256>.<ext>   images, referenced from records as ws:<sha256>
```

`.coat` and `.coat.json` are coatfile's formats, unchanged by the workspace.
The manifest names each template's entry, so a workspace saved before the
rename, with `templates/<id>.tkit` entries, still opens.
`@freshcoat-js/workspace` reads and writes the format with no browser APIs, so
it also runs under Bun or Node.

## Dependencies

Phase 2 adds three, all small and maintained:
- `fflate` for zips, streamed while an export runs;
- `pdf-lib` to assemble PDFs, loaded only when a PDF is made;
- SheetJS CE 0.20.3 for spreadsheets, from the SheetJS CDN, because the npm
  release (0.18.5) has known vulnerabilities. It is loaded only when a
  spreadsheet is imported or exported.

Phase 3 adds two, both font packages from Fontsource, so the chrome's type
is bundled rather than fetched from a CDN:
- `@fontsource-variable/inter` for the interface;
- `@fontsource-variable/jetbrains-mono` for code and numbers.

`@tanstack/react-virtual` windows the Export filmstrip and the font list,
the two lists that are only a scrolling strip of cells. The data grid, the
gallery and the layer tree stay on react-aria's `Virtualizer`, because they
rely on its grid semantics, selection and keyboard navigation, none of which
TanStack Virtual provides.

`fake-indexeddb` is a development dependency, for the autosave tests.
