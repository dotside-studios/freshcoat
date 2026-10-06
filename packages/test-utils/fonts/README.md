# Test fonts

Fonts vendored for text-layout and rendering tests, so they run offline and
deterministically with no network fetch. Used by the engine conformance
fixture (`packages/engine/conformance/src/canvaskit-fixture.ts`, which
registers Geist as `ConformanceFont`) and by the text and line-height tests in
`engine` and `coatfile`. Load them with `testFontPath` or `testFontBytes` from
`@freshcoat-js/test-utils`.

Each is licensed under the SIL Open Font License 1.1, and none declares a
Reserved Font Name. OFL-1.1 permits bundling and redistribution with software,
including modified copies, as long as the font is not sold on its own and its
copyright notice and license travel with it. Each font's license file below is
the upstream `OFL.txt` verbatim.

## Geist-Regular.ttf

- **Family:** Geist (proportional sans-serif)
- **Source:** [vercel/geist-font](https://github.com/vercel/geist-font)
- **Copyright:** © 2024 The Geist Project Authors
- **License:** SIL Open Font License 1.1, see [`Geist-OFL.txt`](./Geist-OFL.txt)

A verbatim TrueType `sfnt`, with no subsetting or modification.

## NotoSansHebrew-Regular.ttf

- **Family:** Noto Sans Hebrew (proportional sans-serif, Hebrew script)
- **Source:** [notofonts/hebrew](https://github.com/notofonts/hebrew), the
  unhinted TrueType build published at
  [notofonts.github.io](https://github.com/notofonts/notofonts.github.io/tree/main/fonts/NotoSansHebrew/unhinted/ttf)
- **Copyright:** © 2022 The Noto Project Authors
- **License:** SIL Open Font License 1.1, see
  [`NotoSansHebrew-OFL.txt`](./NotoSansHebrew-OFL.txt)

A verbatim TrueType `sfnt`, with no subsetting or modification. Vendored for
right-to-left layout: Geist has no Hebrew, so without it an RTL string shapes
as .notdef boxes with meaningless advances. See
`packages/engine/tests/text-direction.test.ts`.

## VendSans-Variable-latin.woff2

- **Family:** Vend Sans (variable, `wght` 300–700, default instance 400)
- **Source:** [ktkm/Vend-Sans](https://github.com/ktkm/Vend-Sans), as Google
  Fonts serves it: the Latin subset a browser receives for
  `css2?family=Vend+Sans:wght@400;600;700`, one variable file answering every
  weight row
- **Copyright:** © 2025 The Vend Sans Project Authors
- **License:** SIL Open Font License 1.1, see
  [`VendSans-OFL.txt`](./VendSans-OFL.txt)

A subset, which OFL-1.1 treats as a modified version; with no Reserved Font
Name, it may keep the Vend Sans name.

Vendored because a VARIABLE face is the only way to test weight instancing: a
family delivered this way registers at its default instance, so a 700 span
silently gets 400 + synthetic bold unless the `wght` axis is set. See
`packages/engine/tests/font-weight.test.ts`.
