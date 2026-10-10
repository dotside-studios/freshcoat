# Release banner brief

Every release opens with a banner: the logo and version in the middle of a
1600 × 320 strip, over art made for that release. This brief is how we decide
what that art is. It fixes the frame and leaves the art open, so each banner
can look like nothing before it.

## What stays the same

These belong to `art.ts` and keep the banners recognisable as a series:

- the 1600 × 320 strip and its dark ground;
- the lockup: the logo, a divider and the version, centred over a soft shade;
- a random source seeded by the version, so a banner renders the same every
  time;
- the banner is a template module, `v<version>.coat.ts`, rendered by the CLI
  of the release it announces, and passes `freshcoat validate`.

Change `art.ts` only when the whole series should change, and re-render the
earlier banners when you do.

## What is open

Everything behind the lockup: the subject, composition, technique, colour,
density, mood. There is no house style for the art. The previous banner is a
reference for quality, not a template to follow.

## Choosing the idea

1. **Read the release.** Go through the commits since the last tag and the
   draft notes. List what the engine, the format or the tools can do now that
   they could not before, or do much better.
2. **Pick one or two.** Choose the capabilities that open up something visual,
   not the most important ones. A performance gain can count if it makes
   something drawable that was too slow before, such as thousands of shapes.
   A fix rarely counts, unless it is what makes the idea work.
3. **Find the idea they make possible.** Ask what picture only exists
   because of them. One idea, followed through, beats a collage of every
   feature. The banner should not explain the release; the notes do that.
4. **Make it ours.** Draw it with the format and the renderer, the way a
   template author would. Prefer something procedural over an imported image.
5. **Make it different.** Check the log below and pick a technique, structure
   or mood the last banners did not use. If the idea resembles a previous one,
   push it somewhere new or pick another.

Questions that help:

- What could a template not express before this release?
- What does the change feel like: faster, finer, freer, more exact, more
  connected? What would that look like?
- What would surprise someone who knows the previous banners?
- What would be tedious to draw by hand but is easy to generate?

## Constraints

- **The lockup reads first.** Keep the middle calm enough for the logo and
  version, at about 700 × 140, to read at a glance. The shade helps, but do not
  rely on it alone.
- **It works small.** GitHub shows the banner about 800 px wide, and social
  previews crop it. Check it at half size: big forms and clear contrast beat
  fine detail that turns to noise.
- **No words in the art.** The lockup is the only text. A glyph or a line of
  code can be material, as long as nobody needs to read it.
- **Colour is free.** The mark's palette, `PALETTE` and `hue()`, is a
  starting point, not a rule. Keep the art in tune with the mark beside it.
- **It renders quickly.** Aim for under 30 seconds. If a boolean or a pattern
  is slow, reduce the shapes rather than wait.
- **It is reproducible.** Draw randomness only from `random()`, never from
  `Math.random()` or the clock. Fonts and files come from stable URLs or this
  directory.

## Making it

1. Copy the last module to `v<version>.coat.ts`, set `VERSION` and replace the
   art. Comment at the top of the file what the art is and which capabilities
   it uses.
2. Render it and look at it full size and at half size:

   ```sh
   bun packages/cli/src/bin.ts render brand/releases/v<version>.coat.ts --out brand/releases
   ```

3. Try other seeds while exploring, then keep the one seeded by the version.
4. Commit the module and the PNG with the version change, add a row to the
   log below, and start the release notes with the image (see the
   [release guide](../../docs/releases.md#release-banner)).

## Log

| Release | Idea | Drawn with |
|---|---|---|
| [0.4.0](v0.4.0.coat.ts) | Interference rings: concentric circles from three centres, the moiré left where they cross, over blurred colour fields | one live `exclude` boolean over about 70 circles, element blur, overlay blending, a noise pattern, a variable font in the lockup |
