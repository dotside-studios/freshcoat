// Cases are Node trees in JSON, which the IR almost already is. The exception is
// binary: bitmap pixels and adjust LUTs are Uint8Array, and JSON has no such
// thing. `{ "__u8": "<base64>" }` is the one escape, revived anywhere it appears,
// so the format stays schema-free and a harness in another language needs a
// base64 decoder rather than a copy of the Node types.
const TAG = "__u8";

type Encoded = { [TAG]: string };

const isEncoded = (v: unknown): v is Encoded =>
	typeof v === "object" &&
	v !== null &&
	TAG in v &&
	typeof (v as Encoded)[TAG] === "string";

export function encodeBinary(value: unknown): unknown {
	if (value instanceof Uint8Array)
		return { [TAG]: Buffer.from(value).toString("base64") };
	if (Array.isArray(value)) return value.map(encodeBinary);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = encodeBinary(v);
		return out;
	}
	return value;
}

export function reviveBinary(value: unknown): unknown {
	if (isEncoded(value))
		return new Uint8Array(Buffer.from(value[TAG], "base64"));
	if (Array.isArray(value)) return value.map(reviveBinary);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = reviveBinary(v);
		return out;
	}
	return value;
}

export const stringifyCase = (value: unknown): string =>
	`${JSON.stringify(encodeBinary(value), null, "\t")}\n`;

export const parseCase = <T>(text: string): T =>
	reviveBinary(JSON.parse(text)) as T;
