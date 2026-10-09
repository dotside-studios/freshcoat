export type Rgba = [number, number, number, number];

const NAMED: Record<string, number> = {
	aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff,
	aquamarine: 0x7fffd4, azure: 0xf0ffff, beige: 0xf5f5dc, bisque: 0xffe4c4,
	black: 0x000000, blanchedalmond: 0xffebcd, blue: 0x0000ff,
	blueviolet: 0x8a2be2, brown: 0xa52a2a, burlywood: 0xdeb887,
	cadetblue: 0x5f9ea0, chartreuse: 0x7fff00, chocolate: 0xd2691e,
	coral: 0xff7f50, cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc,
	crimson: 0xdc143c, cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b,
	darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9, darkgreen: 0x006400,
	darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b, darkmagenta: 0x8b008b,
	darkolivegreen: 0x556b2f, darkorange: 0xff8c00, darkorchid: 0x9932cc,
	darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f,
	darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f,
	darkturquoise: 0x00ced1, darkviolet: 0x9400d3, deeppink: 0xff1493,
	deepskyblue: 0x00bfff, dimgray: 0x696969, dimgrey: 0x696969,
	dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0,
	forestgreen: 0x228b22, fuchsia: 0xff00ff, gainsboro: 0xdcdcdc,
	ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080,
	green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080, honeydew: 0xf0fff0,
	hotpink: 0xff69b4, indianred: 0xcd5c5c, indigo: 0x4b0082, ivory: 0xfffff0,
	khaki: 0xf0e68c, lavender: 0xe6e6fa, lavenderblush: 0xfff0f5,
	lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6,
	lightcoral: 0xf08080, lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2,
	lightgray: 0xd3d3d3, lightgreen: 0x90ee90, lightgrey: 0xd3d3d3,
	lightpink: 0xffb6c1, lightsalmon: 0xffa07a, lightseagreen: 0x20b2aa,
	lightskyblue: 0x87cefa, lightslategray: 0x778899, lightslategrey: 0x778899,
	lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00,
	limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff, maroon: 0x800000,
	mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3,
	mediumpurple: 0x9370db, mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee,
	mediumspringgreen: 0x00fa9a, mediumturquoise: 0x48d1cc,
	mediumvioletred: 0xc71585, midnightblue: 0x191970, mintcream: 0xf5fffa,
	mistyrose: 0xffe4e1, moccasin: 0xffe4b5, navajowhite: 0xffdead,
	navy: 0x000080, oldlace: 0xfdf5e6, olive: 0x808000, olivedrab: 0x6b8e23,
	orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6,
	palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee,
	palevioletred: 0xdb7093, papayawhip: 0xffefd5, peachpuff: 0xffdab9,
	peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd, powderblue: 0xb0e0e6,
	purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000,
	rosybrown: 0xbc8f8f, royalblue: 0x4169e1, saddlebrown: 0x8b4513,
	salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
	seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb,
	slateblue: 0x6a5acd, slategray: 0x708090, slategrey: 0x708090,
	snow: 0xfffafa, springgreen: 0x00ff7f, steelblue: 0x4682b4, tan: 0xd2b48c,
	teal: 0x008080, thistle: 0xd8bfd8, tomato: 0xff6347, turquoise: 0x40e0d0,
	violet: 0xee82ee, wheat: 0xf5deb3, white: 0xffffff, whitesmoke: 0xf5f5f5,
	yellow: 0xffff00, yellowgreen: 0x9acd32,
};

const clamp = (x: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, x));

function channel(s: string): number {
	return s.endsWith("%")
		? clamp((Number.parseFloat(s) / 100) * 255, 0, 255)
		: clamp(Number.parseFloat(s), 0, 255);
}

function alpha(s: string | undefined): number {
	if (s === undefined) return 1;
	return s.endsWith("%")
		? clamp(Number.parseFloat(s) / 100, 0, 1)
		: clamp(Number.parseFloat(s), 0, 1);
}

export function hslToRgb(
	h: number,
	s: number,
	l: number,
): [number, number, number] {
	const hue = (((h % 360) + 360) % 360) / 360;
	const f = (n: number) => {
		const k = (n + hue * 12) % 12;
		const a = s * Math.min(l, 1 - l);
		return Math.round(
			255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
		);
	};
	return [f(0), f(8), f(4)];
}

/** OKLCh to sRGB channels in 0..255, unclamped. L is 0..1, H is degrees. */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
	const hr = (h * Math.PI) / 180;
	const a = c * Math.cos(hr);
	const b = c * Math.sin(hr);

	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b;

	const lc = l_ * l_ * l_;
	const mc = m_ * m_ * m_;
	const sc = s_ * s_ * s_;

	const lr = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
	const lg = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
	const lb = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

	const enc = (x: number) =>
		255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
	return [enc(lr), enc(lg), enc(lb)];
}

function oklch(l: string, c: string, h: string): [number, number, number] {
	return oklchToRgb(
		l.endsWith("%") ? Number.parseFloat(l) / 100 : Number.parseFloat(l),
		c.endsWith("%") ? (Number.parseFloat(c) / 100) * 0.4 : Number.parseFloat(c),
		Number.parseFloat(h),
	);
}

/** Reads a color. `none` is returned as is; `currentColor` resolves to
 *  `current`. Anything unreadable, a paint server `url()` included, is null. */
export function parseColor(raw: string, current?: Rgba): Rgba | "none" | null {
	const v = raw.trim().toLowerCase();
	if (v === "none") return "none";
	if (v === "transparent") return [0, 0, 0, 0];
	if (v === "currentcolor") return current ?? [0, 0, 0, 1];
	if (v.startsWith("#")) {
		const h = v.slice(1);
		if (!/^[0-9a-f]+$/.test(h)) return null;
		if (h.length === 3 || h.length === 4) {
			const n = [...h].map((c) => Number.parseInt(c + c, 16));
			return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, h.length === 4 ? (n[3] ?? 0) / 255 : 1];
		}
		if (h.length === 6 || h.length === 8) {
			const n = [0, 2, 4, 6].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
			return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, h.length === 8 ? (n[3] ?? 0) / 255 : 1];
		}
		return null;
	}
	const fn = /^(rgba?|hsla?|oklch)\(([^)]*)\)$/.exec(v);
	if (fn) {
		const parts = (fn[2] ?? "").split(/[\s,/]+/).filter(Boolean);
		if (parts.length < 3 || parts.length > 4) return null;
		if (parts.some((p) => Number.isNaN(Number.parseFloat(p)))) return null;
		const [a, b, c, d] = parts as [string, string, string, string?];
		if (fn[1]?.startsWith("rgb"))
			return [channel(a), channel(b), channel(c), alpha(d)];
		if (fn[1] === "oklch") {
			const [r, g, bl] = oklch(a, b, c);
			return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(bl, 0, 255), alpha(d)];
		}
		const [r, g, bl] = hslToRgb(
			Number.parseFloat(a),
			clamp(Number.parseFloat(b) / 100, 0, 1),
			clamp(Number.parseFloat(c) / 100, 0, 1),
		);
		return [r, g, bl, alpha(d)];
	}
	const named = NAMED[v];
	if (named === undefined) return null;
	return [(named >> 16) & 255, (named >> 8) & 255, named & 255, 1];
}

const hex = (n: number) =>
	Math.round(clamp(n, 0, 255))
		.toString(16)
		.padStart(2, "0");

/** `#rrggbbaa`, with the color's alpha multiplied by `opacity`. */
export function toHex(c: Rgba, opacity = 1): string {
	return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}${hex(clamp(c[3] * opacity, 0, 1) * 255)}`;
}

/** The colour `t` of the way from `a` to `b`, blended in sRGB. */
export function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
	return [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
		a[3] + (b[3] - a[3]) * t,
	];
}
