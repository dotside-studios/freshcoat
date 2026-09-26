import type { Template } from "@freshcoat/coatfile";
import { createHeadlessEnv } from "@freshcoat/coatfile/headless";
import { render } from "@freshcoat/coatfile/render";
import { exportFileName } from "~/doc/io";
import { getCanvasKit } from "~/render/canvaskit";
import { downloadBytes } from "./download";

/** Renders one side offscreen at `scale` and returns the PNG bytes. */
export async function renderSidePng(
	t: Template,
	opts: {
		side: number;
		variantId?: string;
		values: Record<string, unknown>;
		scale: number;
		fonts?: Map<string, Uint8Array[]>;
	},
): Promise<{ png: Uint8Array; width: number; height: number; name: string }> {
	const frame = t.template_data[opts.side];
	if (!frame) throw new Error("no such side");
	const ck = await getCanvasKit();
	const variantId =
		opts.variantId && t.variants?.some((v) => v.id === opts.variantId)
			? opts.variantId
			: undefined;
	const [result] = await render(
		t,
		opts.values,
		{
			width: t.width,
			height: t.height,
			variantId,
			frameNames: [frame.name],
			exports: [
				opts.scale === 1
					? {}
					: { constraint: { kind: "scale", value: opts.scale } },
			],
		},
		{ ck, env: createHeadlessEnv({ fonts: opts.fonts }), fonts: opts.fonts },
	);
	if (!result || !("bytes" in result)) throw new Error("nothing was rendered");
	return {
		png: result.bytes,
		width: result.width,
		height: result.height,
		name: exportFileName(t.id, frame.name, variantId, result.scale),
	};
}

export async function exportSidePng(
	t: Template,
	opts: Parameters<typeof renderSidePng>[1],
): Promise<void> {
	const out = await renderSidePng(t, opts);
	await downloadBytes(out.png, out.name, "image/png");
}
