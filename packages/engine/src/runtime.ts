import { paintScene } from "./canvaskit";
import type { EncodeOptions } from "./png";
import type { PaintOutput, PaintResult, PaintRuntime, Painter } from "./runtime-types";
import type { Command } from "./types";

export type DisposePolicy = "keep" | "encode";

// The "env owns disposal" seam: a server env encodes+disposes the output (PNG
// bytes), a browser env hands back the live canvas untouched.
export async function applyDisposePolicy(
	output: PaintOutput,
	policy: DisposePolicy,
	encode?: EncodeOptions,
): Promise<PaintResult> {
	if (policy === "encode") {
		// The format comes back from the encoder rather than being echoed from the
		// request: a build without the WebP encoder answers in PNG, and the caller
		// has to know which it got before it labels it.
		const { bytes, format } = await output.encode(encode);
		output.dispose();
		return { bytes, format, warnings: output.warnings };
	}
	// "keep" hands back the live surface, which only a raster backend has. A
	// document backend under this policy is a misconfigured runtime rather than a
	// render that can degrade, so it says so here instead of returning a result
	// whose `canvas` is undefined.
	if (!output.canvas)
		throw new Error(
			'paint runtime policy "keep" requires a backend with a canvas',
		);
	return {
		canvas: output.canvas,
		warnings: output.warnings,
		dispose: output.dispose,
	};
}

// The in-tree Painter: CanvasKit-WASM with its instance bound. A second backend
// supplies its own and is otherwise indistinguishable to the runtime.
export const paintCanvasKit =
	(ck: unknown): Painter =>
	(commands: Command[], rt: PaintRuntime) =>
		paintScene(ck, commands, rt);

// Assemble a runtime from its I/O + canvas parts, a disposal policy and a
// backend. paint() runs the Painter for one scene and applies the policy;
// omitting the Painter selects CanvasKit, which is what every caller in the tree
// does.
export function makeRuntime(
	base: Omit<PaintRuntime, "paint">,
	policy: DisposePolicy,
	encode?: EncodeOptions,
	painter?: Painter,
): PaintRuntime {
	const rt: PaintRuntime = {
		...base,
		async paint(commands, ck, opts): Promise<PaintResult> {
			// Without a painter the backend is CanvasKit and `ck` is its instance,
			// which is every caller in the tree. With one, the backend was chosen at
			// construction and `ck` is not consulted.
			const paint = painter ?? paintCanvasKit(ck);
			const target = opts?.cache ? { ...rt, cache: opts.cache } : rt;
			return applyDisposePolicy(await paint(commands, target), policy, encode);
		},
	};
	return rt;
}
