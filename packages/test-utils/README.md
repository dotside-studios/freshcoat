# @freshcoat-js/test-utils

Shared fixtures for Freshcoat's test suites. This package is internal: it is
not published, and only test code and the engine conformance runner import
it. Add it as a `devDependency` with `workspace:*`.

## CanvasKit

`loadCanvasKit()` is `initCanvasKit` from
[`@freshcoat-js/engine/node`](../engine/), so a test does not need to
locate the WASM file itself. Pass `"full"` for the build with the JPEG and
WebP encoders that Studio's export worker uses.

```ts
import { loadCanvasKit } from "@freshcoat-js/test-utils";

const ck = await loadCanvasKit();
const full = await loadCanvasKit("full");
```

Each call creates a new instance. To share one across a file, load it in
`beforeAll` or cache the promise. `canvasKitVersion` gives the installed
version, which the conformance goldens record.

## Fonts

[`fonts/`](fonts/) holds OFL-licensed fonts, so text tests run offline and
give the same result on every machine. Its [README](fonts/README.md) lists
their sources and why each is included.

```ts
import { testFontBytes, testFontPath } from "@freshcoat-js/test-utils";

const geist = testFontBytes("Geist-Regular.ttf");
const path = testFontPath("VendSans-Variable-latin.woff2");
```

## Checks

```sh
bun run --cwd packages/test-utils test
bun run --cwd packages/test-utils typecheck
```
