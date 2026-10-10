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
   the features. Ask what the word looks like as form, motion or material:
   what converges, and what would only show up if it happened a thousand
   times, exactly?
4. **Choose how to draw it.** This is where the engine comes in. A technique
   the release added, or that earlier banners did not use, is a good choice,
   but the word comes first: never bend the idea to show off a feature.
5. **Make it different.** Check the log below and pick a word, technique,
   structure or mood the last banners did not use. If the idea resembles a
   previous one, push it somewhere new or pick another.

Write the word and a line on the idea at the top of the module.

## Made by the engine, shaped by a person

The art should be impossible to make by hand: too many marks, too exact, too
tightly related to each other for anyone to draw or place one by one. That is
what a renderer is for, and it is what makes the banner ours. Reach for:

- scale: thousands of shapes, lines or glyphs, each one placed by a rule;
- precision: geometry computed exactly, such as booleans, interference,
  tilings, offsets and paths that follow other paths;
- variation: one rule repeated with small seeded differences, so no two
  marks are the same and none was chosen by hand.

Generation alone is not enough. Left to itself it drifts towards the same
look: glowing streaks, floating particles, blurred blobs and neon on dark
purple. Keep the balance with decisions a person makes:

- **One rule, followed through.** A clear system the eye can sense, rather
  than many effects stacked up.
- **Deliberate means.** A chosen palette, a kind of mark, a structure and a
  composition that serve the word.
- **Randomness inside structure.** The seed varies the details; the
  composition stays intended.
- **Effects only when they belong.** Blur, glow and grain should be part of
  the idea, not a finish over everything.

If a person could draw it in an afternoon, push the system further. If it
could have come from any generator, make more of the decisions yourself.

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
| [0.4.0](v0.4.0.coat.ts) | *interfere* | Interference rings: concentric circles from three centres, the moiré left where they cross, over blurred colour fields | one live `exclude` boolean over about 70 circles, element blur, overlay blending, a noise pattern, a variable font in the lockup |
