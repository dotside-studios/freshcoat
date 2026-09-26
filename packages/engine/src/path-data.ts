// Scaling SVG path data. Multiplying every number in a `d` string is only right
// for the commands whose arguments are all coordinates: an arc's x-axis rotation
// and its two flags are not lengths, and scaling them turns a quarter circle into
// something else entirely. This tokenizes the path and scales only the arguments
// that are lengths.

// Arguments per command, and which of them are x / y lengths. Anything not listed
// (an arc's rotation and flags) passes through unchanged.
const ARITY: Record<string, number> = {
	M: 2,
	L: 2,
	T: 2,
	H: 1,
	V: 1,
	C: 6,
	S: 4,
	Q: 4,
	A: 7,
	Z: 0,
};

const AXIS: Record<string, ("x" | "y" | null)[]> = {
	M: ["x", "y"],
	L: ["x", "y"],
	T: ["x", "y"],
	H: ["x"],
	V: ["y"],
	C: ["x", "y", "x", "y", "x", "y"],
	S: ["x", "y", "x", "y"],
	Q: ["x", "y", "x", "y"],
	A: ["x", "y", null, null, null, "x", "y"],
	Z: [],
};

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

/** Scale path data by `sx` horizontally and `sy` vertically (default: `sx`).
 *  Exact for a uniform scale; with `sx !== sy` a rotated arc's radii are scaled
 *  per axis, which approximates it. Throws on data it cannot read rather than
 *  emitting a different shape. */
export function scalePathData(d: string, sx: number, sy: number = sx): string {
	if (sx === 1 && sy === 1) return d;
	// Everything that is not a length is copied through verbatim, so the output
	// keeps the input's separators and number formatting.
	let out = "";
	let i = 0;
	let cmd = "";
	let argIndex = 0;
	const copySeparators = () => {
		while (i < d.length && /[\s,]/.test(d[i])) out += d[i++];
	};
	// A rewritten number can lose the boundary its original had ("1.5.5" →
	// "3" + "1"), so one that would run into the previous digits gets a space.
	const emitScaled = (token: string) => {
		if (/[\d.]$/.test(out) && !/^[-+]/.test(token)) out += " ";
		out += token;
	};
	copySeparators();
	while (i < d.length) {
		const ch = d[i];
		if (/[a-zA-Z]/.test(ch)) {
			const upper = ch.toUpperCase();
			if (!(upper in ARITY)) throw new Error(`path: unknown command "${ch}"`);
			cmd = ch;
			argIndex = 0;
			out += ch;
			i++;
			copySeparators();
			continue;
		}
		const upper = cmd.toUpperCase();
		const arity = ARITY[upper];
		if (!cmd || !arity)
			throw new Error(`path: number without a command at ${i}`);
		const slot = argIndex % arity;
		let token: string;
		if (upper === "A" && (slot === 3 || slot === 4)) {
			// Flags are one character and may be written without a separator
			// ("a1 1 0 01 5 5").
			token = ch;
			if (token !== "0" && token !== "1")
				throw new Error(`path: bad arc flag "${token}" at ${i}`);
			i++;
		} else {
			const m = NUMBER.exec(d.slice(i));
			if (!m) throw new Error(`path: unreadable number at ${i}`);
			token = m[0];
			i += token.length;
		}
		const axis = AXIS[upper][slot];
		if (axis)
			emitScaled(String(Number.parseFloat(token) * (axis === "x" ? sx : sy)));
		else out += token;
		argIndex++;
		copySeparators();
	}
	return out;
}
