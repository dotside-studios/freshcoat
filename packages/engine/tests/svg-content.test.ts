import { describe, expect, test } from "vitest";
import {
	parseSvg,
	type SvgGroup,
	type SvgImage,
	type SvgItem,
	type SvgShape,
	type SvgText,
} from "../src/svg";

const svg = (body: string, attrs = 'width="100" height="100"') =>
	`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mM4efoiVsQwtCQA3z2ZQXrXt2kAAAAASUVORK5CYII=";

function flat(items: SvgItem[]): SvgItem[] {
	return items.flatMap((i) => (i.kind === "group" ? flat(i.children) : [i]));
}

const ofKind = <K extends SvgItem["kind"]>(items: SvgItem[], kind: K) =>
	flat(items).filter(
		(i): i is Extract<SvgItem, { kind: K }> => i.kind === kind,
	);

const features = (markup: string) =>
	parseSvg(markup).warnings.map((w) => w.feature);

describe("images", () => {
	test("a data URL image keeps its box, and its fit from preserveAspectRatio", () => {
		const d = parseSvg(
			svg(
				`<image id="photo" href="${PNG}" x="10" y="20" width="30" height="40"/>` +
					`<image href="${PNG}" width="10" height="10" preserveAspectRatio="none"/>` +
					`<image xlink:href="${PNG}" width="10" height="10" preserveAspectRatio="xMidYMid slice"/>`,
			),
		);
		const [a, b, c] = ofKind(d.children, "image");
		expect(a).toEqual({
			kind: "image",
			id: "photo",
			href: PNG,
			x: 10,
			y: 20,
			width: 30,
			height: 40,
			fit: "contain",
		} satisfies SvgImage);
		expect(b?.fit).toBe("fill");
		expect(c?.fit).toBe("cover");
		expect(d.warnings).toEqual([]);
	});

	test("transforms move, scale and turn it about its centre", () => {
		const [image] = ofKind(
			parseSvg(
				svg(
					`<g transform="translate(50 50) rotate(90) scale(2)"><image href="${PNG}" x="-5" y="-5" width="10" height="10" opacity="0.5"/></g>`,
				),
			).children,
			"image",
		);
		expect(image?.x).toBeCloseTo(40);
		expect(image?.y).toBeCloseTo(40);
		expect(image?.width).toBeCloseTo(20);
		expect(image?.height).toBeCloseTo(20);
		expect(image?.rotation).toBeCloseTo(90);
		expect(image?.opacity).toBe(0.5);
	});

	test("a skewed image draws upright in its bounds, and says so", () => {
		const d = parseSvg(
			svg(
				`<image href="${PNG}" width="10" height="10" transform="skewX(45)"/>`,
			),
		);
		expect(ofKind(d.children, "image")[0]).toMatchObject({
			x: 0,
			y: 0,
			width: 20,
			height: 10,
		});
		expect(d.warnings.map((w) => w.feature)).toEqual(["image-transform"]);
	});

	test("same-document references resolve to the embedded data", () => {
		const d = parseSvg(
			svg(
				`<defs><image id="src" href="${PNG}" width="10" height="10"/></defs>` +
					`<image href="#src" x="20" width="10" height="10"/>` +
					`<use href="#src" x="40"/>`,
			),
		);
		const images = ofKind(d.children, "image");
		expect(images.map((i) => [i.href, i.x])).toEqual([
			[PNG, 20],
			[PNG, 40],
		]);
	});

	test("external files, missing references and unsized images are skipped", () => {
		expect(
			features(
				svg(
					'<image href="photo.png" width="10" height="10"/><image href="#nope" width="1" height="1"/>' +
						`<image href="${PNG}"/>`,
				),
			).sort(),
		).toEqual(["image-external", "image-missing", "image-size"]);
	});
});

describe("text", () => {
	test("a text element is a run at its baseline, with its font and fill", () => {
		const d = parseSvg(
			svg(
				`<text id="title" x="10" y="40" font-family="'Inter', sans-serif" font-size="24" font-weight="bold" font-style="italic" fill="#ff0000" text-anchor="middle">
					Hello   world
				</text>`,
			),
		);
		expect(d.children).toEqual([
			{
				kind: "text",
				id: "title",
				x: 10,
				y: 40,
				anchor: "middle",
				runs: [
					{
						text: "Hello world",
						font: { family: "Inter", size: 24, weight: 700, style: "italic" },
						color: "#ff0000ff",
					},
				],
			},
		] satisfies SvgText[]);
		expect(d.warnings).toEqual([]);
	});

	test("font defaults: the first family, 16 px, 400, black", () => {
		const [text] = ofKind(
			parseSvg(svg('<text y="20" font-family="serif">a</text>')).children,
			"text",
		);
		expect(text?.runs[0]).toEqual({
			text: "a",
			font: { family: "serif", size: 16, weight: 400, style: "normal" },
			color: "#000000ff",
		});
	});

	test("an unplaced tspan is another run on the line; a placed one starts a line", () => {
		const d = parseSvg(
			svg(
				'<text x="5" y="10" font-size="10">Total: <tspan font-weight="700" fill="blue">42</tspan><tspan x="5" dy="12">next line</tspan></text>',
			),
		);
		const texts = ofKind(d.children, "text");
		expect(texts.map((t) => [t.x, t.y, t.runs.map((r) => r.text)])).toEqual([
			[5, 10, ["Total: ", "42"]],
			[5, 22, ["next line"]],
		]);
		expect(texts[0]?.runs[1]).toMatchObject({
			font: { weight: 700 },
			color: "#0000ffff",
		});
	});

	test("a transform scales the font and turns the line about its start", () => {
		const [text] = ofKind(
			parseSvg(
				svg(
					'<text transform="translate(20 30) rotate(-90) scale(2)" font-size="10">up</text>',
				),
			).children,
			"text",
		);
		expect(text?.x).toBeCloseTo(20);
		expect(text?.y).toBeCloseTo(30);
		expect(text?.rotation).toBeCloseTo(-90);
		expect(text?.runs[0]?.font.size).toBeCloseTo(20);
	});

	test("what text can't carry is reported", () => {
		expect(
			features(
				svg(
					'<text x="1 2 3" y="10" stroke="red">abc<textPath href="#p">on a path</textPath></text>',
				),
			).sort(),
		).toEqual(["text-glyph-position", "text-stroke", "textPath"]);
	});

	test("text in a clip path is skipped", () => {
		expect(
			features(
				svg(
					'<clipPath id="c"><text>x</text></clipPath><rect width="10" height="10" clip-path="url(#c)"/>',
				),
			),
		).toEqual(["clip-text"]);
	});
});

describe("markers", () => {
	const ARROW =
		'<marker id="a" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0 0L4 2L0 4Z"/></marker>';

	test("marker-end draws the marker at the last vertex, turned to the line", () => {
		const d = parseSvg(
			svg(
				`<defs>${ARROW}</defs><line x1="10" y1="10" x2="10" y2="50" stroke="black" marker-end="url(#a)"/>`,
			),
		);
		const shapes = ofKind(d.children, "shape");
		expect(shapes).toHaveLength(2);
		// Scaled by the stroke width (1), turned 90 degrees, with refX, refY on
		// the end point.
		const arrow = shapes[1] as SvgShape;
		const points = arrow.d
			.match(/-?[\d.e-]+/g)
			?.map((n) => Math.round(Number(n)));
		expect(points).toEqual([12, 48, 10, 52, 8, 48]);
		expect(d.warnings).toEqual([]);
	});

	test("start, mid and end each take their own vertices", () => {
		const d = parseSvg(
			svg(
				`<defs>${ARROW}</defs><polyline points="0 0 10 0 20 0 30 0" fill="none" stroke="black" marker="url(#a)"/>`,
			),
		);
		expect(ofKind(d.children, "shape")).toHaveLength(1 + 4);
	});

	test("markerUnits strokeWidth scales the marker with the stroke", () => {
		const d = parseSvg(
			svg(
				`<defs>${ARROW}</defs><path d="M0 0H50" stroke="black" stroke-width="3" marker-start="url(#a)"/>`,
			),
		);
		const arrow = ofKind(d.children, "shape")[1] as SvgShape;
		const xs = arrow.d
			.match(/-?[\d.e-]+/g)
			?.filter((_, i) => i % 2 === 0)
			.map(Number) as number[];
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12);
	});

	test("a marker that refers back to itself stops", () => {
		const d = parseSvg(
			svg(
				'<marker id="m" orient="auto"><path d="M0 0H3" stroke="black" marker-end="url(#m)"/></marker><path d="M0 0H10" stroke="black" marker-end="url(#m)"/>',
			),
		);
		expect(ofKind(d.children, "shape")).toHaveLength(2);
	});
});

describe("patterns", () => {
	test("a pattern fill tiles its content, clipped to the shape", () => {
		const d = parseSvg(
			svg(
				'<pattern id="p" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="5" height="5" fill="red"/></pattern><rect width="20" height="20" fill="url(#p)" stroke="black"/>',
			),
		);
		const [tiles, outline] = d.children as [SvgGroup, SvgShape];
		expect(tiles.kind).toBe("group");
		expect(tiles.clip?.map((c) => c.d)).toEqual(["M0 0L20 0L20 20L0 20Z"]);
		expect(ofKind(tiles.children, "shape").map((s) => s.d)).toEqual([
			"M0 0L5 0L5 5L0 5Z",
			"M10 0L15 0L15 5L10 5Z",
			"M0 10L5 10L5 15L0 15Z",
			"M10 10L15 10L15 15L10 15Z",
		]);
		expect(outline).toMatchObject({
			kind: "shape",
			stroke: { color: "#000000ff" },
		});
		expect(outline.fill).toBeUndefined();
		expect(d.warnings).toEqual([]);
	});

	test("objectBoundingBox tiles are fractions of the shape, content inherits by href", () => {
		const d = parseSvg(
			svg(
				'<pattern id="base"><circle cx="5" cy="5" r="5" fill="blue"/></pattern><pattern id="p" href="#base" width="0.5" height="1"/><rect x="10" width="40" height="10" fill="url(#p)"/>',
			),
		);
		const tiles = d.children[0] as SvgGroup;
		expect(ofKind(tiles.children, "shape")).toHaveLength(2);
		expect(
			ofKind(tiles.children, "shape").map((s) => s.d.split("C")[0]),
		).toEqual(["M20 5", "M40 5"]);
	});

	test("patternTransform turns the tiles", () => {
		const d = parseSvg(
			svg(
				'<pattern id="p" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><rect width="5" height="10" fill="red"/></pattern><rect width="10" height="10" fill="url(#p)"/>',
			),
		);
		const tiles = d.children[0] as SvgGroup;
		expect(ofKind(tiles.children, "shape").length).toBeGreaterThan(1);
		expect(ofKind(tiles.children, "shape")[0]?.d).not.toMatch(/^M0 0L5 0/);
	});

	test("too many tiles fall back to the paint's fallback color", () => {
		const d = parseSvg(
			svg(
				'<pattern id="p" patternUnits="userSpaceOnUse" width="0.1" height="0.1"><rect width="0.05" height="0.05"/></pattern><rect width="100" height="100" fill="url(#p) green"/>',
			),
		);
		expect(ofKind(d.children, "shape")).toEqual([
			expect.objectContaining({ fill: { kind: "solid", color: "#008000ff" } }),
		]);
		expect(d.warnings.map((w) => w.feature).sort()).toEqual([
			"pattern",
			"pattern-tiles",
		]);
	});
});
