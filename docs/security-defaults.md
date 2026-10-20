# Safer defaults for untrusted templates

A `.coat` file and its field values choose URLs: an image `src`, a font file,
a font stylesheet, a font family name. A host that renders templates it did not
write would otherwise let them make its server fetch internal addresses
(`http://169.254.169.254/`, `http://localhost:6379/`) or read local files. The
defaults now refuse that. This lands in the release after 0.4.

## What changed

| Before | Now |
|---|---|
| `fetchLoader` fetched any URL that was not `data:` | it loads `data:`, `blob:` and `https:` only; every other scheme throws |
| fonts with an `http:` `src` or stylesheet `url` were fetched by the global `fetch` | the default font fetch takes `https:` only |
| `resolveTemplateFonts` looked up undeclared families on Google Fonts | it does so only with `guessGoogle: true` |

`http:` is refused on purpose: it is plaintext, and it is how internal
services answer. `createFetchLoader({ unsafeAllowHttp: true })` opts in; see
below. `file:`, `ftp:`, `javascript:`, `gopher:` and the rest are
refused by name in the error, which says a host can pass its own loader.

A relative URL (`/assets/x.png`, `fonts/a.ttf`) resolves against the page,
`globalThis.location.href`, so it keeps working in a browser, including Studio
on an http dev server. Where there is no page (Node, Bun, a worker without a
location) a relative URL throws. In Node, `fileLoader` from
`@freshcoat-js/engine/node` reads paths under a root before anything reaches
`fetchLoader`.

Redirects are not inspected: an `https:` URL that redirects to an internal
address is followed by `fetch`. A host that needs more passes a loader that
checks the resolved address.

## Migrating

A host that fetched `http:` assets can opt in. This is unsafe: http is
plaintext, and a template can aim it at internal services. Do it only for
templates you trust.

```ts
import { createFetchLoader, createRenderer } from "@freshcoat-js/engine";

const renderer = await createRenderer({
  ck,
  load: createFetchLoader({ unsafeAllowHttp: true }),
});
```

Fonts follow the loader: an `http:` font url loads when `load` was made with
`unsafeAllowHttp`, and is refused otherwise. For any other scheme, pass your
own loader and take the responsibility for it:

```ts
import { createRenderer, fetchLoader } from "@freshcoat-js/engine";

const load = (src: string) =>
  src.startsWith("http://assets.internal/")
    ? fetch(src).then(async (res) => new Uint8Array(await res.arrayBuffer()))
    : fetchLoader(src);

const renderer = await createRenderer({ ck, load });
```

Fonts go through `load` for local files and through `fetch` (the
`resolveTemplateFonts` option, or `fontBytes`'s third argument) for http(s)
sources. A `fetch` passed explicitly is not restricted.

A host that relied on the Google Fonts lookup for undeclared families passes
`guessGoogle: true` to `resolveTemplateFonts`, or `fontOptions: { guessGoogle:
true }` to `exportWorkspace`. Without it those families are reported in
`missing` and their text paints with a fallback face. The lookup sends family
names from the template to Google, which is why it is opt-in.

Studio and the CLI pass `guessGoogle: true`. The CLI is a local tool that runs
on inputs its user chose, so it opts in with `unsafeAllowHttp` for images and
fonts and keeps fetching `http:` as before.
