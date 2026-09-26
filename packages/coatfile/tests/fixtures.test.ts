import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import { validate } from "../src";
import type { Command, DrawCommand } from "../src/types";
import { compileToCommands } from "./helpers/compile-commands";

// Collect every drawText command, recursing into groups.
function allText(commands: Command[]): DrawCommand[] {
	const out: DrawCommand[] = [];
	const walk = (cmds: (Command | DrawCommand)[]) => {
		for (const c of cmds) {
			if (!("op" in c)) continue;
			if (c.op === "drawText") out.push(c);
			else if (c.op === "drawGroup")
				walk((c as { children: DrawCommand[] }).children);
		}
	};
	walk(commands);
	return out;
}

describe("fixtures", () => {
	test("minimal-card validates", () => {
		expect(validate(fixtures.minimalCard).ok).toBe(true);
	});

	test("full-feature-card validates", () => {
		expect(validate(fixtures.fullFeatureCard).ok).toBe(true);
	});

	test("minimal-card compiles to canvas commands with a background first", () => {
		const [front] = compileToCommands(
			fixtures.minimalCard,
			{ displayName: "Alex" },
			{ width: 1012, height: 638 },
		);
		expect(front).toBeDefined();
		const ops = front.commands.map((c) => c.op);
		expect(ops[0]).toBe("createCanvas");
		// First draw is the background (rect or image).
		const firstDraw = front.commands.find((c) => c.op.startsWith("draw"));
		expect(firstDraw?.op).toMatch(/^(drawRect|drawImage)$/);
	});

	test("full-feature-card variant=amber: mustache flows into baked text", () => {
		const frames = compileToCommands(
			fixtures.fullFeatureCard,
			{ displayName: "Alex", handle: "@alex" },
			{ width: 1012, height: 638, variantId: "amber" },
		);
		const text = frames
			.flatMap((f) => allText(f.commands))
			.flatMap((c) => (c.op === "drawText" ? c.layout.lines : []))
			.map((l) => l.text)
			.join(" ");
		expect(text).toContain("Alex");
		expect(text).toContain("@alex");
	});

	test("full-feature-card lowers cleanly to canvas commands", () => {
		const frames = compileToCommands(
			fixtures.fullFeatureCard,
			{ displayName: "Alex", handle: "@alex" },
			{ width: 1012, height: 638, variantId: "amber" },
		);
		for (const frame of frames) {
			const ops = frame.commands.map((c) => c.op);
			expect(ops[0]).toBe("createCanvas");
			const drawIdx = ops.findIndex((o) => o.startsWith("draw"));
			const setup = ops.slice(0, drawIdx);
			const allowed = new Set(["createCanvas", "loadFonts", "loadImages"]);
			for (const op of setup) expect(allowed.has(op)).toBe(true);
		}
	});
});
