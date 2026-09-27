# @freshcoat-js/ui

The React component kit used by [Freshcoat](../../README.md) Studio: controls,
panels, menus, dialogs and data views for a dense editing interface.

Components build on react-aria-components for interaction and focus behavior,
with Tailwind v4 styling. Shared tokens in [`theme.css`](src/theme.css) define
the light theme by default; set `data-theme="dark"` on an ancestor to use the
dark theme. Inter and JetBrains Mono are bundled through Fontsource for
interface text and code or numeric displays.

Use the kit when building Studio UI or an interface with the same visual
language. It contains no template, dataset or rendering logic.

## Components

Buttons and icon buttons, checkboxes and toggles, menus and context menus,
toolbars, panels, tabs, dialogs, popovers and tooltips, fields (text, number,
combo box, select, slider, segmented), a color input, a data table with column
resizing, a tree (the layer list), a gallery (the photo grid), progress,
toasts, kbd hints and icons. `src/lib` holds the small shared pieces: `cn`
(which merges kit sizes and colors without clobbering each other), style
composition and helpers.

```tsx
import { Button } from "@freshcoat-js/ui/button";
import { Panel, PanelHeader } from "@freshcoat-js/ui/panel";
import "@freshcoat-js/ui/theme.css";
```

Import components from their individual subpaths. The host app needs React 19
and Tailwind 4, and its Tailwind build must scan the kit's source files. Use
Tailwind's `@source` directive with a path to `packages/ui/src`, resolved
relative to your stylesheet.

## The kit gallery

[`gallery.tsx`](src/gallery.tsx) is the `/kit` route of Studio. Run
`bun run dev` from the repository root and open
<http://localhost:3010/kit> to explore components and their states in both themes.

## Where it sits

The studio ([`apps/editor`](../../apps/editor/)) is the only consumer today.
The kit is maintained in this workspace and is not yet published separately.

## Contributing

Follow the [repository guide](../../CONTRIBUTING.md) for setup and review checks.

1. Add `src/<name>.tsx`, building on a `react-aria-components` primitive where
   available so keyboard, focus and screen-reader behavior come with it.
2. Style with Tailwind classes using `src/theme.css` tokens rather than raw
   colors, so both themes work.
3. The package's wildcard exports expose components as `@freshcoat-js/ui/<name>`.
   Show the component in `src/gallery.tsx`, Studio's `/kit` route, in both themes.
4. Test behavior beyond markup under `src/tests/`. Run `test`, `typecheck`
   and `check` from this directory, plus relevant Studio tests when a shared
   interaction changes.

## License

Apache-2.0; see the repository's [`LICENSE`](../../LICENSE) and
[`NOTICE`](../../NOTICE). Part of [Freshcoat](../../README.md).
