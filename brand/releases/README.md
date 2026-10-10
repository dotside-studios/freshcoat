# Release banner brief

Every release opens with a banner: the logo and version in the middle of a
1600 × 320 strip, over art made for that release. The banner is how we
celebrate a release: it gives each one an identity of its own, something to
remember it by, rather than a summary of its changes. This brief is how we
decide what that art is. It fixes the frame and leaves the art open, so each
banner can look like nothing before it.

## What stays the same

These belong to `art.ts` and keep the banners recognisable as a series:

- the 1600 × 320 strip;
- the lockup: the logo, a divider and the version, centred over a soft shade.
  `tone` says whether the art behind it is dark or light, and the lockup is
  drawn to stand out from it. Art that keeps the middle clear on its own can
  leave the shade out with `shade: false`;
- a random source seeded by the version, so a banner renders the same every
  time;
- the banner is a template module, `v<version>.coat.ts`, rendered by the CLI
  of the release it announces, and passes `freshcoat validate`.

Change `art.ts` only when the whole series should change, and re-render the
earlier banners when you do.

## What is open

Everything behind the lockup: the background, colour, subject, composition,
technique, density and mood. Each module sets its own `background` and colours;
`art.ts` gives none. There is no house style for the art. The previous banner is a
reference for quality, not a template to follow.

## Choosing the idea

The art starts from a word, not from a feature.

1. **Read the release.** Go through the commits since the last tag and the
   draft notes, and write two or three plain sentences on what changed for
   the people who use Freshcoat.
2. **Find the word.** Distill those sentences into one verb or adjective that
   describes the release as a whole: *converge*, *loosen*, *sharpen*, *settle*,
   *unfold*, *quick*, *exact*. Avoid a feature's name; ask what the release
   does or how it feels. 0.4 folded many pieces into one renderer driven by one
   command, so its word is *converge*.
3. **Draw the word, not the release.** No cards, screens, UI or pictures of
   the features. Ask what the word looks like as form, motion or material.
4. **Choose how to draw it.** This is where the engine comes in. A technique
   the release added, or that earlier banners did not use, is a good choice,
   but the word comes first: never bend the idea to show off a feature.
5. **Make it different.** Check the log below and pick a word, technique,
   structure or mood the last banners did not use. If the idea resembles a
   previous one, push it somewhere new or pick another.

How the art is made, and how it should look and feel, is decided for each
release. Write the word and a line on the idea at the top of the module.

## Constraints

- **The lockup reads first.** Keep the middle calm enough for the logo and
  version, at about 700 × 140, to read at a glance. The shade helps, but do not
  rely on it alone.
- **It works small.** GitHub shows the banner about 800 px wide, and social
  previews crop it. Check it at half size: big forms and clear contrast beat
  fine detail that turns to noise.
- **No words in the art.** The lockup is the only text. A glyph or a line of
  code can be material, as long as nobody needs to read it.
- **It renders quickly.** Aim for under 30 seconds. If a boolean or a pattern
  is slow, reduce the shapes rather than wait.
- **It is reproducible.** Draw randomness only from `random()`, never from
  `Math.random()` or the clock. Fonts and files come from stable URLs or this
  directory.

## Making it

1. Copy the last module to `v<version>.coat.ts`, set `VERSION` and replace the
   art. Comment at the top of the file the word, what the art is and which
   capabilities it uses.
2. Render it and look at it full size and at half size:

   ```sh
   bun packages/cli/src/bin.ts render brand/releases/v<version>.coat.ts --out brand/releases
   ```

3. Try other seeds while exploring, then keep the one seeded by the version.
4. Commit the module and the PNG with the version change, add a row to the
   log below, and start the release notes with the image (see the
   [release guide](../../docs/releases.md#release-banner)).

## Log

| Release | Word | Idea | Drawn with |
|---|---|---|---|
| [0.4.0](v0.4.0.coat.ts) | *interfere* | Interference rings: concentric circles from three centres, the moiré left where they cross, printed flat in two tones of cobalt with a panel cut out for the lockup | a live `exclude` boolean over about 70 circles inside a live `subtract`, a variable font in the lockup |
| [0.3.0](v0.3.0.coat.ts) | *lighten* | An engraving: ruled lines that start nearly solid and thin to hairlines across the strip, swelling over a slow seeded field, in vermilion on paper, each line cut exactly at a rounded panel for the lockup | one compound vector of 56 filled line shapes, each edge sampled from the field |
| [0.2.0](v0.2.0.coat.ts) | *arrange* | Truchet tiles: one tile of paired quarter arcs turned one of two ways in every cell, joining into meandering paths, in mint on deep green, the cells behind the lockup left empty | one stroked vector of about 1,000 arcs on a 40 px grid |
