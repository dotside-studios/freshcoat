import { describe, expect, it } from "vitest";
import { CUT_STYLES, type ItemCuts } from "./cut";
import { cutSvg } from "./cut-svg";

const cuts: ItemCuts = {
	width: 420,
	height: 220,
	lines: [
		{
			kind: "through",
			name: "sticker",
			path: "M30 40L130 40C140 40 140 120 130 120L30 120Z",
			fillRule: "nonzero",
		},
		{ kind: "score", name: "fold", path: "M40 60L80 60", fillRule: "nonzero" },
		{
			kind: "through",
			name: "badge & <more>",
			path: "M0 0L10 0L10 10Z",
			fillRule: "evenodd",
		},
	],
};

describe("cutSvg", () => {
	const svg = cutSvg(cuts, 300);

	it("is sized in millimetres at the dpi, with a viewBox in design units", () => {
		expect(svg).toContain('width="35.56mm"');
		expect(svg).toContain('height="18.6267mm"');
		expect(svg).toContain('viewBox="0 0 420 220"');
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
	});

	it("scales the size with the dpi", () => {
		expect(cutSvg(cuts, 600)).toContain('width="17.78mm"');
	});

	it("groups the lines by kind, only for the kinds present", () => {
		expect(svg).toContain('<g id="through">');
		expect(svg).toContain('<g id="score">');
		expect(svg).not.toContain('id="kiss"');
		expect(svg).not.toContain('id="perforate"');
		expect(svg.indexOf('id="through"')).toBeLessThan(svg.indexOf('id="score"'));
	});

	it("draws unfilled hairline paths in the kind's colour, keeping curves", () => {
		const through = svg.slice(
			svg.indexOf('<g id="through">'),
			svg.indexOf("</g>"),
		);
		expect(through.match(/<path /g)).toHaveLength(2);
		expect(through).toContain(
			'd="M30 40L130 40C140 40 140 120 130 120L30 120Z"',
		);
		expect(through).toContain('fill="none"');
		expect(through).toContain(`stroke="${CUT_STYLES.through.color}"`);
		expect(through).toContain('stroke-width="1.0417"');
		expect(svg).toContain(`stroke="${CUT_STYLES.score.color}"`);
	});

	it("names each path by its slice, escaped", () => {
		expect(svg).toContain('data-name="sticker"');
		expect(svg).toContain('data-name="badge &amp; &lt;more&gt;"');
	});

	it("keeps the fill rule of an outline that needs one", () => {
		expect(svg).toContain('fill-rule="evenodd"');
	});

	it("is the same every time", () => {
		expect(cutSvg(cuts, 300)).toBe(svg);
	});

	it("colours the four kinds as listed", () => {
		expect(
			Object.fromEntries(
				Object.entries(CUT_STYLES).map(([k, v]) => [k, v.color]),
			),
		).toEqual({
			through: "#FF0000",
			kiss: "#FF00FF",
			score: "#0000FF",
			perforate: "#00A000",
		});
	});
});
