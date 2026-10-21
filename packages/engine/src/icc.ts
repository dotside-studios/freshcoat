// ICC profiles for a PDF's output intent: the sRGB profile Freshcoat bundles,
// and the checks a profile passes before a PDF declares it.

import { base64ToBytes } from "./loader";

// sRGB-v2-magic.icc from Compact ICC Profiles (CC0), as in icc/ next to this
// package: an ICC v2 display profile of sRGB IEC61966-2.1 in 736 bytes.
const SRGB_BASE64 =
	"AAAC4GxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5kk7I0qQ6wIoqY/Zqvo2eJmwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZWgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAAF4Z1RSQwAAAWgAAAF4YlRSQwAAAWgAAAF4ZGVzYwAAAAAAAAAFc1JHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAAAAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZWiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAC2AAAAHAA4AFQAcACMAKgAxADhAQABIgFGAW0BlQHBAfACIAJVAosCxAMBAz8DggPGBA4EWQSnBPkFTAWkBf4GXAa+ByEHigf0CGMI1QlJCcMKPwq/C0ILyQxUDOENdA4JDqIPQA/gEIURLRHaEooTPhP2FLIVcRY2Fv0XyhiZGW4aRhsiHAMc5x3QHr0friCkIZ4inCOfJKUlsSbAJ9Uo7SoKKyssUS18Lqov3jEWMlIzlDTZNiQ3czjGOiA7fDzfPkU/sEEhQpZEEEWPRxJIm0ooS7tNUU7uUI9SNVPgVZBXRVkAWr5chF5MYBth72PHZaZniWlxa19tUW9KcUZzSnVRd155cXuIfaZ/yIHwhB6GUIiJisWNCY9RkZ+T85ZLmKubDp14n+eiW6TWp1ap26xnrvexj7Qqtsy5dLwhvtXBjcRMxxDJ2syrz3/SXNU92CTbEt4E4P7j/OcB6gztHPA081D2c/mb/Mr//w==";

/** The bundled sRGB IEC61966-2.1 profile. */
export const SRGB_PROFILE: Uint8Array = base64ToBytes(SRGB_BASE64);

export type IccColorSpace = "GRAY" | "RGB" | "CMYK";

export type IccProfileInfo = {
	/** "2.1", "4.3" */
	version: string;
	/** "mntr" for a display, "prtr" for a printer */
	deviceClass: string;
	colorSpace: IccColorSpace;
	/** 1, 3 or 4, as the colour space has */
	components: number;
	/** the profile's own description, or "" when it has none */
	description: string;
};

export type IccProfileResult =
	| { ok: true; info: IccProfileInfo }
	| { ok: false; message: string };

const COMPONENTS: Record<string, { space: IccColorSpace; n: number }> = {
	GRAY: { space: "GRAY", n: 1 },
	"RGB ": { space: "RGB", n: 3 },
	CMYK: { space: "CMYK", n: 4 },
};

// Output and display devices; a PDF's destination profile describes one.
const OUTPUT_CLASSES = new Set(["prtr", "mntr"]);

/** Reads an ICC profile's header and description, and says why it cannot be
 *  a PDF's destination output profile: too short, a size that disagrees with
 *  its length, no `acsp` signature, a version past 4, a class other than a
 *  printer or display, or a colour space other than gray, RGB or CMYK. */
export function readIccProfile(bytes: Uint8Array): IccProfileResult {
	if (bytes.length < 132)
		return { ok: false, message: "too short to be an ICC profile" };
	if (ascii(bytes, 36, 4) !== "acsp")
		return { ok: false, message: "not an ICC profile: no acsp signature" };
	const size = u32(bytes, 0);
	if (size !== bytes.length)
		return {
			ok: false,
			message: `its header says ${size} bytes but it has ${bytes.length}`,
		};
	const major = bytes[8] as number;
	if (major < 2 || major > 4)
		return { ok: false, message: `ICC version ${major} is not supported` };
	const deviceClass = ascii(bytes, 12, 4);
	if (!OUTPUT_CLASSES.has(deviceClass))
		return {
			ok: false,
			message: `a "${deviceClass.trim()}" profile does not describe an output device; use a printer or display profile`,
		};
	const space = COMPONENTS[ascii(bytes, 16, 4)];
	if (!space)
		return {
			ok: false,
			message: `its colour space "${ascii(bytes, 16, 4).trim()}" is not gray, RGB or CMYK`,
		};
	const count = u32(bytes, 128);
	if (132 + count * 12 > bytes.length)
		return { ok: false, message: "its tag table runs past the end" };
	return {
		ok: true,
		info: {
			version: `${major}.${(bytes[9] as number) >> 4}`,
			deviceClass,
			colorSpace: space.space,
			components: space.n,
			description: description(bytes, count),
		},
	};
}

/** What a PDF declares it was prepared for: the condition a print shop's RIP
 *  converts it to. Content stays sRGB whatever the profile. */
export type OutputIntent = {
	/** the destination output profile: gray, RGB or CMYK, printer or display */
	profile: Uint8Array;
	/** OutputConditionIdentifier, such as FOGRA39; default the profile's
	 *  description */
	identifier?: string;
	/** Info, the condition in words; default the profile's description */
	info?: string;
	/** RegistryName, where the identifier is registered, such as
	 *  http://www.color.org */
	registry?: string;
};

export const SRGB_OUTPUT_INTENT: OutputIntent = {
	profile: SRGB_PROFILE,
	identifier: "sRGB IEC61966-2.1",
	info: "sRGB IEC61966-2.1",
	registry: "http://www.color.org",
};

/** An output intent whose profile passed `readIccProfile`. */
export type ResolvedOutputIntent = {
	profile: Uint8Array;
	components: number;
	identifier: string;
	info: string;
	registry?: string;
};

/** The intent a PDF declares: sRGB when none is given, nothing for false.
 *  Throws when the profile cannot be a destination output profile. */
export function resolveOutputIntent(
	intent: OutputIntent | false | undefined,
): ResolvedOutputIntent | null {
	if (intent === false) return null;
	const chosen = intent ?? SRGB_OUTPUT_INTENT;
	const read = readIccProfile(chosen.profile);
	if (!read.ok) throw new Error(`output intent profile: ${read.message}`);
	const named = read.info.description || "Custom";
	return {
		profile: chosen.profile,
		components: read.info.components,
		identifier: chosen.identifier?.trim() || named,
		info: chosen.info?.trim() || named,
		...(chosen.registry ? { registry: chosen.registry } : {}),
	};
}

// A v2 textDescriptionType or a v4 multiLocalizedUnicodeType, the first
// record of which is read.
function description(b: Uint8Array, count: number): string {
	for (let i = 0; i < count; i++) {
		const at = 132 + i * 12;
		if (ascii(b, at, 4) !== "desc") continue;
		const start = u32(b, at + 4);
		const length = u32(b, at + 8);
		if (start + length > b.length || length < 12) return "";
		const type = ascii(b, start, 4);
		if (type === "desc") {
			const n = u32(b, start + 8);
			if (12 + n > length) return "";
			return ascii(b, start + 12, n)
				.replace(/\0.*$/s, "")
				.trim();
		}
		if (type === "mluc") {
			if (u32(b, start + 8) < 1 || length < 28) return "";
			const bytes = u32(b, start + 20);
			const from = start + u32(b, start + 24);
			if (from + bytes > start + length) return "";
			let out = "";
			for (let j = 0; j + 1 < bytes; j += 2)
				out += String.fromCharCode(
					((b[from + j] as number) << 8) | (b[from + j + 1] as number),
				);
			return out.replace(/\0.*$/s, "").trim();
		}
		return "";
	}
	return "";
}

function ascii(b: Uint8Array, at: number, length: number): string {
	let out = "";
	for (let i = at; i < at + length && i < b.length; i++)
		out += String.fromCharCode(b[i] as number);
	return out;
}

const u32 = (b: Uint8Array, i: number) =>
	((b[i] as number) * 0x1000000 +
		(((b[i + 1] as number) << 16) |
			((b[i + 2] as number) << 8) |
			(b[i + 3] as number))) >>>
	0;
