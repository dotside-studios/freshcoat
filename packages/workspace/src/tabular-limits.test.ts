import { readFileSync } from "node:fs";
import { cornerCells, workbookBomb } from "@freshcoat-js/test-utils";
import { zipSync } from "fflate";
import { writeXlsx } from "hucre/xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_TABLE_LIMITS,
	MAX_TEXT_LENGTH,
	readTable,
	TABLE_LIMIT_CEILINGS,
	TableLimitError,
	TabularError,
} from "./tabular";
import { readZipDirectory } from "./zip-directory";

const caught = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (err) {
		return err;
	}
	return null;
};

const limitOf = async (p: Promise<unknown>) => {
	const err = await caught(p);
	expect(err).toBeInstanceOf(TableLimitError);
	return err as TableLimitError;
};

const encode = (text: string) => new TextEncoder().encode(text);

/** `zip` with its end record moved to a zip64 record declaring `entries`. */
const asZip64 = (zip: Uint8Array, entries: number) => {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const eocd = zip.length - 22;
	const start = view.getUint32(eocd + 16, true);
	const size = view.getUint32(eocd + 12, true);
	const out = new Uint8Array(zip.length + 56 + 20);
	out.set(zip.subarray(0, eocd));
	const record = eocd;
	const o = new DataView(out.buffer);
	o.setUint32(record, 0x06064b50, true);
	o.setBigUint64(record + 4, 44n, true);
	o.setBigUint64(record + 24, BigInt(entries), true);
	o.setBigUint64(record + 32, BigInt(entries), true);
	o.setBigUint64(record + 40, BigInt(size), true);
	o.setBigUint64(record + 48, BigInt(start), true);
	const locator = record + 56;
	o.setUint32(locator, 0x07064b50, true);
	o.setBigUint64(locator + 8, BigInt(record), true);
	o.setUint32(locator + 16, 1, true);
	const end = locator + 20;
	o.setUint32(end, 0x06054b50, true);
	o.setUint16(end + 8, 0xffff, true);
	o.setUint16(end + 10, 0xffff, true);
	o.setUint32(end + 12, 0xffffffff, true);
	o.setUint32(end + 16, 0xffffffff, true);
	return out;
};

/** A zip of only a central directory with `entries` empty entries, which
 *  is all `readTable` reads before the entry limit refuses it. */
const directoryOnly = (entries: number) => {
	const size = 46 * entries;
	const out = new Uint8Array(size + 22);
	const view = new DataView(out.buffer);
	for (let at = 0; at < size; at += 46) view.setUint32(at, 0x02014b50, true);
	view.setUint32(size, 0x06054b50, true);
	view.setUint16(size + 8, Math.min(entries, 0xffff), true);
	view.setUint16(size + 10, Math.min(entries, 0xffff), true);
	view.setUint32(size + 12, size, true);
	return out;
};

describe("readTable: limits", () => {
	it("rejects input over the byte cap before decoding it", async () => {
		const err = await limitOf(
			readTable(new Uint8Array(1001), "big.csv", {
				limits: { maxBytes: 1000 },
			}),
		);
		expect(err).toBeInstanceOf(TabularError);
		expect(err.code).toBe("limit_exceeded");
		expect(err).toMatchObject({ limit: "bytes", actual: 1001, max: 1000 });
		expect(err.message).toBe(
			"big.csv is too large to import: 1,001 bytes is over the limit of 1,000 bytes",
		);
	});

	it("shows exact sizes when they round to the same megabytes", async () => {
		const err = await limitOf(
			readTable(new Uint8Array(2_000_001), "big.csv", {
				limits: { maxBytes: 2_000_000 },
			}),
		);
		expect(err.message).toBe(
			"big.csv is too large to import: 2,000,001 bytes is over the limit of 2,000,000 bytes",
		);
	});

	it("applies the byte cap to text given as a string", async () => {
		const err = await limitOf(
			readTable("a,b\n1,2\n", "x.csv", { limits: { maxBytes: 4 } }),
		);
		expect(err.limit).toBe("bytes");
	});

	it("has defaults a modest file passes", async () => {
		const { sheets } = await readTable("a,b\n1,2\n", "x.csv");
		expect(sheets[0]?.rows).toHaveLength(2);
		expect(DEFAULT_TABLE_LIMITS).toEqual({
			maxBytes: 128 * 1024 * 1024,
			maxUncompressedBytes: 512 * 1024 * 1024,
			maxZipEntries: 10_000,
			maxRows: 500_000,
			maxColumns: 500,
			maxCells: 10_000_000,
		});
	});

	it("rejects a csv with too many rows", async () => {
		const csv = `a\n${"1\n".repeat(50)}`;
		const err = await limitOf(
			readTable(csv, "rows.csv", { limits: { maxRows: 10 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 11, max: 10 });
		expect(err.message).toContain("11 records is over the limit of 10 records");
	});

	it("does not count the header against the row cap", async () => {
		const { sheets } = await readTable("a\n1\n2\n3\n", "x.csv", {
			limits: { maxRows: 3 },
		});
		expect(sheets[0]?.rows).toHaveLength(4);
		const err = await limitOf(
			readTable("a\n1\n2\n3\n4\n", "x.csv", { limits: { maxRows: 3 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 4, max: 3 });
	});

	it("does not count the header against the row cap of a tsv", async () => {
		const tsv = `a\tb\n${"1\t2\n".repeat(5)}`;
		const { sheets } = await readTable(tsv, "x.tsv", {
			limits: { maxRows: 5 },
		});
		expect(sheets[0]?.rows).toHaveLength(6);
	});

	it("reads an even 100,000 records under the default caps", async () => {
		const csv = `id,name\n${"7,Ana\n".repeat(100_000)}`;
		const { sheets } = await readTable(csv, "even.csv");
		expect(sheets[0]?.rows).toHaveLength(100_001);
	});

	it("rejects a csv with too many columns", async () => {
		const csv = `${Array.from({ length: 30 }, (_, i) => `c${i}`).join(",")}\n1\n`;
		const err = await limitOf(
			readTable(csv, "wide.csv", { limits: { maxColumns: 20 } }),
		);
		expect(err).toMatchObject({ limit: "columns", actual: 21, max: 20 });
	});

	it("rejects a tsv with too many columns", async () => {
		const err = await limitOf(
			readTable("a\tb\tc\td\n", "x.tsv", { limits: { maxColumns: 3 } }),
		);
		expect(err.limit).toBe("columns");
	});

	it("rejects a csv with too many cells", async () => {
		const csv = `a,b,c\n${"1,2,3\n".repeat(9)}`;
		const err = await limitOf(
			readTable(csv, "cells.csv", { limits: { maxCells: 20 } }),
		);
		expect(err).toMatchObject({ limit: "cells", actual: 27, max: 20 });
	});

	it("does not count the header's cells", async () => {
		const csv = `a,b,c\n${"1,2,3\n".repeat(9)}`;
		const { sheets } = await readTable(csv, "cells.csv", {
			limits: { maxCells: 27 },
		});
		expect(sheets[0]?.rows).toHaveLength(10);
	});

	it("rejects json with too many rows", async () => {
		const items = Array.from({ length: 20 }, (_, i) => ({ id: i }));
		const err = await limitOf(
			readTable(JSON.stringify(items), "rows.json", { limits: { maxRows: 5 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 20, max: 5 });
	});

	it("counts json objects as records, with no header to exclude", async () => {
		const items = (n: number) =>
			JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i })));
		const { sheets } = await readTable(items(5), "x.json", {
			limits: { maxRows: 5 },
		});
		expect(sheets[0]?.rows).toHaveLength(6);
		const err = await limitOf(
			readTable(items(6), "x.json", { limits: { maxRows: 5 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 6, max: 5 });
	});

	it("excludes the header row of a json list of arrays", async () => {
		const rows = [["id"], ...Array.from({ length: 5 }, (_, i) => [i])];
		const { sheets } = await readTable(JSON.stringify(rows), "x.json", {
			limits: { maxRows: 5 },
		});
		expect(sheets[0]?.rows).toHaveLength(6);
	});

	it("rejects a wrapped json list with too many rows", async () => {
		const items = Array.from({ length: 20 }, (_, i) => ({ id: i }));
		const err = await limitOf(
			readTable(JSON.stringify({ records: items }), "rows.json", {
				limits: { maxRows: 5 },
			}),
		);
		expect(err.limit).toBe("rows");
	});

	it("rejects json with too many columns", async () => {
		const item = Object.fromEntries(
			Array.from({ length: 12 }, (_, i) => [`k${i}`, i]),
		);
		const err = await limitOf(
			readTable(JSON.stringify([item]), "wide.json", {
				limits: { maxColumns: 10 },
			}),
		);
		expect(err).toMatchObject({ limit: "columns", actual: 12, max: 10 });
	});

	it("rejects ndjson with too many rows before parsing lines", async () => {
		const lines = `${'{"id":1}\n'.repeat(20)}not json`;
		const err = await limitOf(
			readTable(lines, "rows.ndjson", { limits: { maxRows: 5 } }),
		);
		expect(err.limit).toBe("rows");
	});

	it("counts ndjson objects as records", async () => {
		const lines = (n: number) => '{"id":1}\n'.repeat(n);
		const { sheets } = await readTable(lines(5), "x.ndjson", {
			limits: { maxRows: 5 },
		});
		expect(sheets[0]?.rows).toHaveLength(6);
		const err = await limitOf(
			readTable(lines(6), "x.ndjson", { limits: { maxRows: 5 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 6, max: 5 });
	});

	it("stops ndjson one record over the cap before parsing", async () => {
		const lines = `${'{"id":1}\n'.repeat(5)}not json`;
		const err = await limitOf(
			readTable(lines, "rows.ndjson", { limits: { maxRows: 5 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 6, max: 5 });
	});

	it("does not count an ndjson header row of arrays", async () => {
		const lines = (n: number) => `["id"]\n${"[1]\n".repeat(n)}`;
		const { sheets } = await readTable(lines(5), "x.ndjson", {
			limits: { maxRows: 5 },
		});
		expect(sheets[0]?.rows).toHaveLength(6);
		const err = await limitOf(
			readTable(lines(6), "x.ndjson", { limits: { maxRows: 5 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 6, max: 5 });
	});

	it("counts rows before trailing empty rows are trimmed", async () => {
		const err = await limitOf(
			readTable(`a\n1\n${"\n".repeat(30)}`, "x.csv", {
				limits: { maxRows: 10 },
			}),
		);
		expect(err.limit).toBe("rows");
	});
});

describe("readTable: text longer than a string can be", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const decoder = (decode: () => string) =>
		vi.stubGlobal(
			"TextDecoder",
			class {
				decode = decode;
			},
		);

	it("reports Node's string length error as a limit", async () => {
		decoder(() => {
			throw Object.assign(new Error("Cannot create a string longer"), {
				code: "ERR_STRING_TOO_LONG",
			});
		});
		const err = await limitOf(readTable(new Uint8Array(100), "huge.csv"));
		expect(err).toMatchObject({
			limit: "bytes",
			actual: 100,
			max: MAX_TEXT_LENGTH,
		});
		expect(err.message).toBe(
			"huge.csv is too large to import: 100 bytes is over the limit of 512.0 MB",
		);
	});

	it("reports Chromium's empty decode as a limit, not an empty file", async () => {
		decoder(() => "");
		for (const name of ["huge.csv", "huge.json", "huge.ndjson"]) {
			const err = await limitOf(readTable(new Uint8Array(100), name));
			expect(err.limit).toBe("bytes");
		}
	});

	it("still calls a file with only a byte order mark empty", async () => {
		const err = await caught(
			readTable(new Uint8Array([0xef, 0xbb, 0xbf]), "bom.csv"),
		);
		expect(err).toMatchObject({ code: "empty_file" });
	});

	it("still falls back to windows-1252 for text that is not UTF-8", async () => {
		const { sheets } = await readTable(new Uint8Array([0x61, 0xe9]), "x.csv");
		expect(sheets[0]?.rows).toEqual([["aé"]]);
	});
});

describe("readTable: workbook limits", () => {
	const workbook = (rows: (string | number)[][]) =>
		writeXlsx({ sheets: [{ name: "Sheet1", rows }] });

	it("rejects a zip whose declared inflated size is over the cap", async () => {
		const bomb = zipSync({
			"xl/workbook.xml": new Uint8Array(2_000_000),
			"[Content_Types].xml": encode("<Types/>"),
		});
		expect(bomb.length).toBeLessThan(10_000);
		const err = await limitOf(
			readTable(bomb, "bomb.xlsx", {
				limits: { maxUncompressedBytes: 1_000_000 },
			}),
		);
		expect(err.limit).toBe("uncompressed_bytes");
		expect(err.actual).toBe(2_000_008);
		expect(err.message).toContain(
			"1.9 MB is over the limit of 1,000,000 bytes",
		);
	});

	it("applies the default uncompressed cap to a real size lie", async () => {
		const zip = zipSync({ "a.txt": encode("hello") });
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
		let central = -1;
		for (let i = 0; i < zip.length - 4; i++) {
			if (view.getUint32(i, true) === 0x02014b50) central = i;
		}
		view.setUint32(central + 24, 0xffffffff, true);
		expect(readZipDirectory(zip)?.uncompressedBytes).toBe(0xffffffff);
		const err = await limitOf(readTable(zip, "lie.xlsx"));
		expect(err.limit).toBe("uncompressed_bytes");
	});

	it("stops a zip that understates its size while inflating", async () => {
		const zip = zipSync({ "[Content_Types].xml": new Uint8Array(2_000_000) });
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
		for (let i = 0; i < zip.length - 28; i++) {
			if (view.getUint32(i, true) === 0x02014b50)
				view.setUint32(i + 24, 10, true);
		}
		expect(readZipDirectory(zip)?.uncompressedBytes).toBe(10);
		const err = await limitOf(
			readTable(zip, "liar.xlsx", {
				limits: { maxUncompressedBytes: 100_000 },
			}),
		);
		expect(err.limit).toBe("uncompressed_bytes");
		expect(err.actual).toBeUndefined();
		expect(err.message).toBe(
			"liar.xlsx is too large to import: it is over the limit of 100,000 bytes",
		);
	});

	const centralDirectoryEnd = (zip: Uint8Array) => {
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
		for (let at = zip.length - 22; at >= 0; at--) {
			if (view.getUint32(at, true) === 0x06054b50) return { view, at };
		}
		throw new Error("no end of central directory");
	};

	it("checks a real xlsx whose directory size field is zero", async () => {
		const xlsx = await workbook([["a"], ["b"]]);
		const { view, at } = centralDirectoryEnd(xlsx);
		view.setUint32(at + 12, 0, true);
		expect(readZipDirectory(xlsx)?.entries).toBeGreaterThan(1);
		const err = await limitOf(
			readTable(xlsx, "patched.xlsx", { limits: { maxZipEntries: 1 } }),
		);
		expect(err.limit).toBe("zip_entries");
		const { sheets } = await readTable(xlsx, "patched.xlsx");
		expect(sheets[0]?.rows).toEqual([["a"], ["b"]]);
	});

	it("checks a real xlsx whose directory size field is too small", async () => {
		const xlsx = await workbook([["a"], ["b"]]);
		const { view, at } = centralDirectoryEnd(xlsx);
		view.setUint32(at + 12, 50, true);
		const err = await limitOf(
			readTable(xlsx, "patched.xlsx", {
				limits: { maxUncompressedBytes: 100 },
			}),
		);
		expect(err.limit).toBe("uncompressed_bytes");
	});

	it("rejects a zip whose directory cannot be read", async () => {
		const xlsx = await workbook([["a"], ["b"]]);
		const { view, at } = centralDirectoryEnd(xlsx);
		view.setUint32(at + 16, view.getUint32(at + 16, true) + 1, true);
		expect(readZipDirectory(xlsx)).toBeNull();
		const err = await caught(readTable(xlsx, "broken.xlsx"));
		expect(err).toBeInstanceOf(TabularError);
		expect((err as TabularError).code).toBe("invalid_file");
	});

	it("rejects a zip with no end of central directory", async () => {
		const err = await caught(
			readTable(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "short.xlsx"),
		);
		expect((err as TabularError).code).toBe("invalid_file");
	});

	it("rejects a zip64 marker with no zip64 record", async () => {
		const xlsx = await workbook([["a"], ["b"]]);
		const { view, at } = centralDirectoryEnd(xlsx);
		view.setUint32(at + 16, 0xffffffff, true);
		const err = await caught(readTable(xlsx, "zip64.xlsx"));
		expect((err as TabularError).code).toBe("invalid_file");
	});

	it.each([
		"xls",
		"ods",
	])("reports a .%s sheet over the cell cap as a limit", async (ext) => {
		const bytes = new Uint8Array(
			readFileSync(new URL(`./fixtures/members.${ext}`, import.meta.url)),
		);
		const err = await limitOf(
			readTable(bytes, `members.${ext}`, {
				limits: { maxCells: 2, maxColumns: 2 },
			}),
		);
		expect(err).toMatchObject({ limit: "cells", max: 2 });
		expect(err.actual).toBeUndefined();
	});

	it("rejects a zip with too many entries", async () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 30; i++) files[`f${i}.xml`] = encode("<a/>");
		const err = await limitOf(
			readTable(zipSync(files), "many.xlsx", { limits: { maxZipEntries: 20 } }),
		);
		expect(err).toMatchObject({ limit: "zip_entries", actual: 30, max: 20 });
	});

	it("rejects an xlsx with too many rows", async () => {
		const rows = Array.from({ length: 40 }, (_, i) => [`r${i}`, i]);
		const err = await limitOf(
			readTable(await workbook(rows), "rows.xlsx", { limits: { maxRows: 10 } }),
		);
		expect(err).toMatchObject({ limit: "rows", actual: 39, max: 10 });
	});

	it("does not count an xlsx header against the row cap", async () => {
		const rows = [["name"], ...Array.from({ length: 10 }, (_, i) => [`r${i}`])];
		const { sheets } = await readTable(await workbook(rows), "x.xlsx", {
			limits: { maxRows: 10 },
		});
		expect(sheets[0]?.rows).toHaveLength(11);
	});

	it("rejects an xlsx with too many columns", async () => {
		const row = Array.from({ length: 40 }, (_, i) => i);
		const err = await limitOf(
			readTable(await workbook([row]), "wide.xlsx", {
				limits: { maxColumns: 10 },
			}),
		);
		expect(err.limit).toBe("columns");
	});

	it("rejects an xlsx with too many cells", async () => {
		const rows = Array.from({ length: 40 }, (_, i) => [i, i, i]);
		const err = await limitOf(
			readTable(await workbook(rows), "cells.xlsx", {
				limits: { maxCells: 50 },
			}),
		);
		expect(err).toMatchObject({ limit: "cells", max: 50 });
		expect(err.actual).toBeGreaterThan(50);
	});

	it("does not count an xlsx header's cells", async () => {
		const rows = [["a", "b"], ...Array.from({ length: 25 }, (_, i) => [i, i])];
		const { sheets } = await readTable(await workbook(rows), "x.xlsx", {
			limits: { maxCells: 50 },
		});
		expect(sheets[0]?.rows).toHaveLength(26);
	});

	const LIFTED = {
		maxBytes: Number.POSITIVE_INFINITY,
		maxUncompressedBytes: Number.POSITIVE_INFINITY,
		maxRows: Number.POSITIVE_INFINITY,
		maxColumns: Number.POSITIVE_INFINITY,
		maxCells: Number.POSITIVE_INFINITY,
	};

	it.each([
		["the default limits", undefined],
		["lifted limits", LIFTED],
	])("refuses a workbook.xml that inflates to 700 MB under %s", async (_, limits) => {
		const err = await limitOf(
			readTable(workbookBomb(), "bomb.xlsx", { limits }),
		);
		expect(err).toMatchObject({
			limit: "uncompressed_bytes",
			max: DEFAULT_TABLE_LIMITS.maxUncompressedBytes,
		});
		expect(err.actual).toBeGreaterThan(700 * 1024 * 1024);
	});

	it.each([
		["the default limits", undefined],
		["lifted limits", LIFTED],
	])("refuses cells at A1 and ALL1048576 under %s", async (_, limits) => {
		const err = await limitOf(
			readTable(cornerCells(), "corner.xlsx", { limits }),
		);
		expect(err).toMatchObject({
			limit: "cells",
			max: DEFAULT_TABLE_LIMITS.maxCells,
		});
	});

	it("passes no unbounded limit to the workbook reader", async () => {
		const { hucreCodec } = await import("./workbook/hucre");
		const read = vi.spyOn(hucreCodec, "read");
		await readTable(await workbook([["a"], ["b"]]), "ok.xlsx", {
			limits: LIFTED,
		});
		expect(read).toHaveBeenCalledWith(expect.anything(), "xlsx", {
			maxDecompressedBytes: DEFAULT_TABLE_LIMITS.maxUncompressedBytes,
			maxTotalCells:
				DEFAULT_TABLE_LIMITS.maxCells + DEFAULT_TABLE_LIMITS.maxColumns,
		});
		read.mockRestore();
	});

	it.each([
		Number.MAX_SAFE_INTEGER,
		1e308,
	])("caps cells and columns at their ceilings when given %d", async (huge) => {
		const err = await limitOf(
			readTable(cornerCells(), "corner.xlsx", {
				limits: {
					maxUncompressedBytes: huge,
					maxZipEntries: huge,
					maxColumns: huge,
					maxCells: huge,
				},
			}),
		);
		expect(err).toMatchObject({
			limit: "cells",
			max: TABLE_LIMIT_CEILINGS.maxCells,
		});
		expect(err.message).toContain("20,000,000 cells");
	});

	it("passes the ceilings to the workbook reader for a huge finite limit", async () => {
		const { hucreCodec } = await import("./workbook/hucre");
		const read = vi.spyOn(hucreCodec, "read");
		await readTable(await workbook([["a"], ["b"]]), "ok.xlsx", {
			limits: {
				maxUncompressedBytes: 1e308,
				maxColumns: 1e308,
				maxCells: 1e308,
			},
		});
		expect(read).toHaveBeenCalledWith(expect.anything(), "xlsx", {
			maxDecompressedBytes: 2 * 1024 * 1024 * 1024,
			maxTotalCells: 20_000_000 + 16_384,
		});
		read.mockRestore();
	});

	it("reports the ceiling as the limit of a capped zip entry count", async () => {
		const count = TABLE_LIMIT_CEILINGS.maxZipEntries + 1;
		const err = await limitOf(
			readTable(asZip64(directoryOnly(count), count), "many.xlsx", {
				limits: { maxZipEntries: Number.MAX_SAFE_INTEGER },
			}),
		);
		expect(err).toMatchObject({
			limit: "zip_entries",
			actual: count,
			max: TABLE_LIMIT_CEILINGS.maxZipEntries,
		});
	});

	it.each([
		["NaN", Number.NaN],
		["undefined", undefined],
		["negative", -1],
		["a string", "5" as unknown as number],
	])("takes the default for a limit given as %s", async (_, value) => {
		const zip = directoryOnly(DEFAULT_TABLE_LIMITS.maxZipEntries + 1);
		const entries = await limitOf(
			readTable(zip, "many.xlsx", { limits: { maxZipEntries: value } }),
		);
		expect(entries.max).toBe(DEFAULT_TABLE_LIMITS.maxZipEntries);
		const oversized = {
			length: DEFAULT_TABLE_LIMITS.maxBytes + 1,
		} as unknown as Uint8Array;
		const bytes = await limitOf(
			readTable(oversized, "big.csv", { limits: { maxBytes: value } }),
		);
		const rows = await limitOf(
			readTable(
				`a\n${"1\n".repeat(DEFAULT_TABLE_LIMITS.maxRows + 1)}`,
				"rows.csv",
				{ limits: { maxRows: value } },
			),
		);
		expect(rows.max).toBe(DEFAULT_TABLE_LIMITS.maxRows);
		expect(bytes.max).toBe(DEFAULT_TABLE_LIMITS.maxBytes);
	});

	it("lifts maxBytes and maxRows with Infinity", async () => {
		const rows = DEFAULT_TABLE_LIMITS.maxRows + 1;
		const { sheets } = await readTable(`a\n${"1\n".repeat(rows)}`, "x.csv", {
			limits: {
				maxBytes: Number.POSITIVE_INFINITY,
				maxRows: Number.POSITIVE_INFINITY,
			},
		});
		expect(sheets[0]?.rows).toHaveLength(rows + 1);
	});

	it("reads an xlsx inside the limits", async () => {
		const { sheets } = await readTable(
			await workbook([["a"], ["b"]]),
			"ok.xlsx",
		);
		expect(sheets[0]?.rows).toEqual([["a"], ["b"]]);
	});
});

describe("readZipDirectory", () => {
	it("sums the declared sizes of a zip's entries", () => {
		const zip = zipSync({ "a.txt": encode("hello"), "b.txt": encode("hi") });
		expect(readZipDirectory(zip)).toEqual({ entries: 2, uncompressedBytes: 7 });
	});

	it("reads the entry count and offset from a zip64 record", () => {
		const zip = zipSync({ "a.txt": encode("hello"), "b.txt": encode("hi") });
		const out = asZip64(zip, 2);
		expect(readZipDirectory(out)).toEqual({ entries: 2, uncompressedBytes: 7 });
	});

	it("returns null for bytes with no directory", () => {
		expect(readZipDirectory(new Uint8Array([0x50, 0x4b, 1, 2]))).toBeNull();
		expect(readZipDirectory(new Uint8Array(0))).toBeNull();
	});
});
