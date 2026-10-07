# @freshcoat-js/canvaskit

Loads [CanvasKit](https://skia.org/docs/user/modules/canvaskit/) for
[Freshcoat](../../README.md). The engine renders with a CanvasKit instance you
pass in; this package creates one in Node, Bun, a page or a worker. It depends
on `canvaskit-wasm`, which satisfies the engine's peer dependency.

## Node and Bun

```ts
import { loadCanvasKit } from "@freshcoat-js/canvaskit/node";
import { renderSceneToPng } from "@freshcoat-js/engine/headless";

const ck = await loadCanvasKit();
const result = await renderSceneToPng(root, { width, height, ck });
```

`loadCanvasKit(build)` shares one instance per build and retries a failed
load. `initCanvasKit(build)` creates a new instance on every call. The
`"full"` build adds the JPEG and WebP encoders. `canvasKitBinDir(build)` and
`canvasKitVersion` locate the installed files, for example to serve them to a
browser.

## Browsers and workers

Serve `canvaskit.js` and `canvaskit.wasm` from one directory, then load them
by its URL:

```ts
import { loadCanvasKit } from "@freshcoat-js/canvaskit/browser";

const ck = await loadCanvasKit("/canvaskit/0.41.1");
```

On a page the script is added with a `<script>` tag. In a classic or module
worker it is fetched and evaluated. One instance is shared per URL, and a
failed load is retried.

## Checks

```sh
bun run --cwd packages/canvaskit test
bun run --cwd packages/canvaskit typecheck
```
