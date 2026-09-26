import { ellipsePath } from "../doc/factories";

/** A four-point sparkle filling a `s`×`s` box. */
export function sparklePath(s: number): string {
	const h = s / 2;
	const k = (n: number) => Math.round(n * s * 1000) / 1000;
	return [
		`M${h} 0`,
		`C${k(0.54)} ${k(0.3)} ${k(0.7)} ${k(0.46)} ${s} ${h}`,
		`C${k(0.7)} ${k(0.54)} ${k(0.54)} ${k(0.7)} ${h} ${s}`,
		`C${k(0.46)} ${k(0.7)} ${k(0.3)} ${k(0.54)} 0 ${h}`,
		`C${k(0.3)} ${k(0.46)} ${k(0.46)} ${k(0.3)} ${h} 0Z`,
	].join("");
}

export { ellipsePath };
