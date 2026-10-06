import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readTable, TabularError, writeTable } from "./tabular";
import { deepFreeze, members } from "./test-fixtures";
import type { Dataset } from "./types";

const dataset: Dataset = deepFreeze(members);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const rejection = (p: Promise<unknown>) =>
	p.then(
		() => null,
		(err: unknown) => (err instanceof TabularError ? err.code : String(err)),
	);

describe("readTable: delimited text", () => {
	it("keeps 007, quoted commas, unicode and CRLF", async () => {
		const csv =
			'id,name,note\r\n007,"Cruz, Ana","Café ☕ 日本"\r\n008,Ben,"say ""hi"""\r\n';
		const { sheets } = await readTable(csv, "people.csv");
		expect(sheets).toEqual([
			{
				name: "people",
				rows: [
					["id", "name", "note"],
					["007", "Cruz, Ana", "Café ☕ 日本"],
					["008", "Ben", 'say "hi"'],
				],
			},
		]);
	});

	it("reads bytes, dropping a byte order mark", async () => {
		const bytes = new TextEncoder().encode("﻿a,b\nñ,2\n");
		const { sheets } = await readTable(bytes, "x.CSV");
		expect(sheets[0]?.rows).toEqual([
			["a", "b"],
			["ñ", "2"],
		]);
	});

	it("reads a Windows-1252 file", async () => {
		const bytes = new Uint8Array([0x61, 0x0a, 0x43, 0x61, 0x66, 0xe9]);
		const { sheets } = await readTable(bytes, "legacy.csv");
		expect(sheets[0]?.rows).toEqual([["a"], ["Café"]]);
	});

	it("forces a tab for .tsv", async () => {
		const { sheets } = await readTable("a\tb\n1,2\t3\n", "x.tsv");
		expect(sheets[0]?.rows).toEqual([
			["a", "b"],
			["1,2", "3"],
		]);
	});

	it("trims empty trailing rows and columns and pads short rows", async () => {
		const { sheets } = await readTable("a,b,,\n1,,,\n,,,\n\n", "x.csv");
		expect(sheets[0]?.rows).toEqual([
			["a", "b"],
			["1", ""],
		]);
	});
});

/** What readTable gave for delimited text when SheetJS read it. */
function sheetJsRows(text: string, ext: string): string[][] {
	if (text.trim() === "") return [];
	const wb = XLSX.read(text, {
		type: "string",
		raw: true,
		...(ext === "tsv" ? { FS: "\t" } : {}),
	});
	const sheet = wb.Sheets[wb.SheetNames[0] as string] as XLSX.WorkSheet;
	const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		blankrows: true,
	});
	const filled = (c: string | undefined) => c !== undefined && c.trim() !== "";
	let height = rows.length;
	while (height > 0 && !(rows[height - 1] ?? []).some(filled)) height -= 1;
	let width = 0;
	for (const row of rows.slice(0, height)) {
		for (let c = row.length - 1; c >= width; c--) {
			if (filled(row[c])) width = c + 1;
		}
	}
	return rows
		.slice(0, height)
		.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? ""));
}

const rowsOf = async (text: string, name: string) =>
	(await readTable(text, name).catch(() => null))?.sheets[0]?.rows ?? [];

describe("readTable: delimited text matches SheetJS", () => {
	const fixtures = [
		'id,name,note\r\n007,"Cruz, Ana","Café ☕ 日本"\r\n008,Ben,"say ""hi"""\r\n',
		"a,b,,\n1,,,\n,,,\n\n",
		"a\tb\n1,2\t3\n",
		'a,"multi\r\nline",c\r\n1,2,3',
		'a,"open quote\nnever closed',
		'a,b"c,"d"e"\n"x""y",z',
		"a;b;c\n1;2;3",
		"a|b\n1|2",
		"sep=;\r\na;b,c\n",
		"sep=|\na|b",
		"a\rb\rc",
		"a,b\n\n\nc,d\n",
		'" spaced ", x ,\n',
		'"",""\n"a"',
	];
	it("on the edge-case fixtures", async () => {
		for (const text of fixtures) {
			for (const ext of ["csv", "tsv", "txt"]) {
				expect(await rowsOf(text, `x.${ext}`), `${ext}: ${text}`).toEqual(
					sheetJsRows(text, ext),
				);
			}
		}
	});

	it("on random text made of separators, quotes and line breaks", async () => {
		let seed = 7;
		const random = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const parts = [
			"a",
			"b",
			",",
			'"',
			'"',
			"\t",
			";",
			"|",
			"\r",
			"\n",
			"\r\n",
			" ",
			"é",
		];
		const starts = ["x", "sep=;\n", "sep=|\r\n", '"q', ",", "\n"];
		for (let i = 0; i < 1500; i++) {
			let text = starts[Math.floor(random() * starts.length)] as string;
			const n = 1 + Math.floor(random() * 30);
			for (let k = 0; k < n; k++) {
				text += parts[Math.floor(random() * parts.length)];
			}
			for (const ext of ["csv", "tsv", "txt"]) {
				expect(
					await rowsOf(text, `x.${ext}`),
					`${ext}: ${JSON.stringify(text)}`,
				).toEqual(sheetJsRows(text, ext));
			}
		}
	});
});

describe("readTable: JSON", () => {
	it("unions keys in first-seen order and stringifies nested values", async () => {
		const json = JSON.stringify({
			records: [
				{ a: 1, b: "x" },
				{ c: true, a: null, d: { e: [1] } },
			],
		});
		const { sheets } = await readTable(json, "data.json");
		expect(sheets[0]?.rows).toEqual([
			["a", "b", "c", "d"],
			["1", "x", "", ""],
			["", "", "true", '{"e":[1]}'],
		]);
	});

	it("reads a bare array and the rows and data wrappers", async () => {
		for (const doc of [
			[{ a: "1" }],
			{ rows: [{ a: "1" }] },
			{ data: [{ a: "1" }] },
		]) {
			const { sheets } = await readTable(JSON.stringify(doc), "d.json");
			expect(sheets[0]?.rows).toEqual([["a"], ["1"]]);
		}
	});

	it("reads NDJSON and JSONL", async () => {
		const lines = '{"a":"007"}\r\n\n{"b":2}\n';
		for (const name of ["x.ndjson", "x.jsonl"]) {
			const { sheets } = await readTable(lines, name);
			expect(sheets[0]?.rows).toEqual([
				["a", "b"],
				["007", ""],
				["", "2"],
			]);
		}
	});

	it("rejects JSON that is not a list of records", async () => {
		expect(await rejection(readTable("{", "x.json"))).toBe("invalid_file");
		expect(await rejection(readTable('{"a":1}', "x.json"))).toBe(
			"invalid_file",
		);
		expect(await rejection(readTable("[1,2]", "x.json"))).toBe("invalid_file");
	});
});

describe("readTable: errors", () => {
	it("rejects an empty file", async () => {
		for (const name of ["x.csv", "x.json", "x.ndjson", "x.tsv"]) {
			expect(await rejection(readTable("", name))).toBe("empty_file");
		}
		expect(await rejection(readTable("[]", "x.json"))).toBe("empty_file");
		expect(await rejection(readTable(",,\n,,\n", "x.csv"))).toBe("empty_file");
	});

	it("rejects an unknown extension", async () => {
		expect(await rejection(readTable("a", "x.pdf"))).toBe("unsupported_format");
		expect(await rejection(readTable("a", "noext"))).toBe("unsupported_format");
	});

	it("rejects a workbook given as text", async () => {
		expect(await rejection(readTable("a", "x.xlsx"))).toBe("invalid_file");
	});
});

describe("readTable: workbooks", () => {
	it("reads every sheet, dates as ISO text and other cells formatted", async () => {
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			wb,
			XLSX.utils.aoa_to_sheet([
				["name", "joined", "points", "ok"],
				["Ana", { t: "n", v: 45000, z: "d/m/yy" }, 12, true],
				["007", { t: "n", v: 45000.75, z: "d/m/yy" }, 1.5, false],
			]),
			"Members",
		);
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Empty");
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "Other");
		for (const bookType of ["xlsx", "ods", "xls"] as const) {
			const bytes = new Uint8Array(
				XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer,
			);
			const { sheets } = await readTable(bytes, `book.${bookType}`);
			expect(sheets.map((s) => s.name)).toEqual(["Members", "Other"]);
			expect(sheets[0]?.rows).toEqual([
				["name", "joined", "points", "ok"],
				["Ana", "2023-03-15", "12", "TRUE"],
				["007", "2023-03-15", "1.5", "FALSE"],
			]);
		}
	});

	it("rejects bytes that are not a workbook", async () => {
		const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(await rejection(readTable(garbage, "x.xlsx"))).toBe("invalid_file");
	});
});

describe("writeTable", () => {
	it("writes CSV with keys, quoting and photo names", async () => {
		const out = await writeTable(dataset, "csv");
		expect(out.mediaType).toBe("text/csv");
		expect(out.extension).toBe("csv");
		const lines = text(out.bytes).replace(/^﻿/, "").split("\r\n");
		expect(lines[0]).toBe("name,number,tier,photo,vip,joined,points");
		expect(lines[1]).toBe("Ana Cruz,007,gold,ana.png,true,2024-02-29,1200");
		expect(lines[2]).toBe("Ben Uy,,Gold Tier,,false,,");
	});

	it("round-trips CSV and TSV through readTable", async () => {
		const tricky: Dataset = {
			...dataset,
			records: [
				{
					id: "r_1",
					status: "pending",
					values: { name: 'Cruz, "Ana"\nJr.', number: "007", tier: "ü\tx" },
				},
			],
		};
		for (const format of ["csv", "tsv"] as const) {
			const out = await writeTable(tricky, format);
			const { sheets } = await readTable(out.bytes, `x.${format}`);
			expect(sheets[0]?.rows[1]?.slice(0, 3)).toEqual([
				'Cruz, "Ana"\nJr.',
				"007",
				"ü\tx",
			]);
		}
	});

	it("writes JSON and NDJSON with typed values", async () => {
		const json = JSON.parse(text((await writeTable(dataset, "json")).bytes));
		expect(json[0]).toEqual({
			name: "Ana Cruz",
			number: "007",
			tier: "gold",
			photo: "ana.png",
			vip: true,
			joined: "2024-02-29",
			points: 1200,
		});
		expect(json[3]).toMatchObject({ name: "Di Sy", vip: null });
		const nd = await writeTable(dataset, "ndjson");
		expect(nd.mediaType).toBe("application/x-ndjson");
		const lines = text(nd.bytes).trimEnd().split("\n");
		expect(lines).toHaveLength(5);
		expect(JSON.parse(lines[1] as string)).toMatchObject({ name: "Ben Uy" });
		const back = await readTable(nd.bytes, "x.ndjson");
		expect(back.sheets[0]?.rows[1]?.[0]).toBe("Ana Cruz");
	});

	it("round-trips XLSX with typed cells", async () => {
		const out = await writeTable(
			{ ...dataset, name: "A very long dataset name: with [odd] chars" },
			"xlsx",
		);
		expect(out.extension).toBe("xlsx");
		const wb = XLSX.read(out.bytes, { type: "array" });
		expect(wb.SheetNames).toEqual(["A very long dataset name  with"]);
		const sheet = wb.Sheets[wb.SheetNames[0] as string] as XLSX.WorkSheet;
		expect(sheet.B2).toMatchObject({ t: "s", v: "007" });
		expect(sheet.E2).toMatchObject({ t: "b", v: true });
		expect(sheet.F2).toMatchObject({ t: "n", v: 45351 });
		expect(sheet.G2).toMatchObject({ t: "n", v: 1200 });

		const { sheets } = await readTable(out.bytes, "back.xlsx");
		expect(sheets[0]?.rows[0]).toEqual([
			"name",
			"number",
			"tier",
			"photo",
			"vip",
			"joined",
			"points",
		]);
		expect(sheets[0]?.rows[1]).toEqual([
			"Ana Cruz",
			"007",
			"gold",
			"ana.png",
			"TRUE",
			"2024-02-29",
			"1200",
		]);
		expect(sheets[0]?.rows).toHaveLength(6);
	});
});
