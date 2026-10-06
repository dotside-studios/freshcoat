import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { paintScene } from "../src/canvaskit";
import { createHeadlessEnv } from "../src/headless";
import type { Command, DrawQrCommand } from "../src/types";

let ck: any;
async function initCk() {
	if (!ck)
		ck = await loadCanvasKit();
	return ck;
}

// A deterministic pattern with long runs, single modules and empty rows.
function modules(n: number): boolean[][] {
	return Array.from({ length: n }, (_, y) =>
		Array.from({ length: n }, (_, x) =>
			y % 7 === 3 ? false : ((x * 31 + y * 17) % 11) % 3 !== 0 || x < 4,
		),
	);
}

const SIZE = { width: 73, height: 61 };

// The module-by-module drawing the painter used before it merged runs.
function reference(qr: DrawQrCommand, scale: number) {
	const surface = ck.MakeSurface(
		Math.round(SIZE.width * scale),
		Math.round(SIZE.height * scale),
	);
	const canvas = surface.getCanvas();
	canvas.clear(ck.TRANSPARENT);
	canvas.scale(scale, scale);
	canvas.save();
	if (qr.rotation) {
		const cx = qr.pos.x + qr.size.width / 2;
		const cy = qr.pos.y + qr.size.height / 2;
		canvas.translate(cx, cy);
		canvas.rotate(qr.rotation, 0, 0);
		canvas.translate(-cx, -cy);
	}
	const { pos, size, margin = 0 } = qr;
	const m = (Math.min(size.width, size.height) - margin * 2) / qr.modules.length;
	const bg = new ck.Paint();
	bg.setColor(ck.parseColorString(qr.background ?? "#ffffff"));
	canvas.drawRect(ck.XYWHRect(pos.x, pos.y, size.width, size.height), bg);
	const fg = new ck.Paint();
	fg.setColor(ck.parseColorString(qr.foreground));
	for (let y = 0; y < qr.modules.length; y++)
		for (let x = 0; x < qr.modules.length; x++)
			if (qr.modules[y][x])
				canvas.drawRect(
					ck.XYWHRect(pos.x + margin + x * m, pos.y + margin + y * m, m, m),
					fg,
				);
	canvas.restore();
	const snap = surface.makeImageSnapshot();
	const data = snap.readPixels(0, 0, {
		width: snap.width(),
		height: snap.height(),
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	snap.delete();
	bg.delete();
	fg.delete();
	surface.dispose();
	return data;
}

describe("drawQr", () => {
	test("merged runs paint what per-module rects painted", async () => {
		await initCk();
		const env = createHeadlessEnv({});
		for (const scale of [1, 1.5, 2.37, 0.83])
			for (const foreground of ["#101828", "#1d4ed880"])
				for (const rotation of [0, 13]) {
					const qr: DrawQrCommand = {
						op: "drawQr",
						pos: { x: 3.3, y: 2.7 },
						size: { width: 57.1, height: 55.9 },
						modules: modules(25),
						foreground,
						background: "#f5f0e6",
						margin: 1.6,
						rotation,
					};
					const commands: Command[] = [
						{ op: "createCanvas", ...SIZE, scale },
						qr,
					];
					const out = await paintScene(ck, commands, env);
					const px = out.readPixels?.();
					out.dispose();
					expect(px?.data).toEqual(reference(qr, scale));
				}
	});

	test("merged runs match across fractional placements", async () => {
		await initCk();
		const env = createHeadlessEnv({});
		let seed = 7;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		for (let i = 0; i < 40; i++) {
			const scale = 0.5 + rand() * 3;
			const side = 20 + rand() * 40;
			const qr: DrawQrCommand = {
				op: "drawQr",
				pos: { x: rand() * 10, y: rand() * 5 },
				size: { width: side, height: side + rand() * 4 },
				modules: modules(21 + Math.floor(rand() * 12)),
				foreground: "#1d4ed880",
				margin: rand() * 3,
			};
			const commands: Command[] = [{ op: "createCanvas", ...SIZE, scale }, qr];
			const out = await paintScene(ck, commands, env);
			const px = out.readPixels?.();
			out.dispose();
			expect(px?.data).toEqual(reference(qr, scale));
		}
	});
});
