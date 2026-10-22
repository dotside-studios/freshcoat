import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readXlsx } from "hucre/xlsx";
import { describe, expect, it } from "vitest";
import oracle from "./fixtures/delimited-sheetjs.json" with { type: "json" };
import { applyMapping, importDefaults } from "./mapping";
import { readTable, TabularError, writeTable } from "./tabular";
import { deepFreeze, members } from "./test-fixtures";
import type { Column, Dataset, DatasetAsset } from "./types";

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

const rowsOf = async (text: string, name: string) =>
	(await readTable(text, name).catch(() => null))?.sheets[0]?.rows ?? [];

// What SheetJS read from the same text, recorded when it was the reader.
describe("readTable: delimited text matches SheetJS", () => {
	it("on the edge-case fixtures", async () => {
		for (const { text, rows } of oracle.fixed) {
			for (const ext of ["csv", "tsv", "txt"] as const) {
				expect(await rowsOf(text, `x.${ext}`), `${ext}: ${text}`).toEqual(
					rows[ext],
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
		const hash = createHash("sha256");
		for (let i = 0; i < 1500; i++) {
			let text = starts[Math.floor(random() * starts.length)] as string;
			const n = 1 + Math.floor(random() * 30);
			for (let k = 0; k < n; k++) {
				text += parts[Math.floor(random() * parts.length)];
			}
			for (const ext of ["csv", "tsv", "txt"]) {
				hash.update(JSON.stringify(await rowsOf(text, `x.${ext}`)));
			}
		}
		expect(hash.digest("hex")).toBe(oracle.random);
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
	const fixture = (ext: string) =>
		new Uint8Array(
			readFileSync(new URL(`./fixtures/members.${ext}`, import.meta.url)),
		);

	it("reads every sheet, dates as ISO text and other cells formatted", async () => {
		const formats = {
			xlsx: ["12.5%", "1,234.50"],
			xlsm: ["12.5%", "1,234.50"],
			ods: ["12.50%", "1,234.50"],
			xls: ["0.125", "1234.5"],
		};
		for (const [ext, [share, fee]] of Object.entries(formats)) {
			const { sheets } = await readTable(fixture(ext), `book.${ext}`);
			expect(
				sheets.map((s) => s.name),
				ext,
			).toEqual(["Members", "Other"]);
			expect(sheets[0]?.rows, ext).toEqual([
				["name", "joined", "points", "ok", "share", "fee"],
				["Ana", "2023-03-15", "12", "TRUE", share, fee],
				["007", "2023-03-15", "1.5", "FALSE", "0.3", "0.333333333333333"],
			]);
		}
	});

	it("rejects a .numbers file as a format it does not read", async () => {
		expect(
			await rejection(readTable(new Uint8Array([0x50, 0x4b]), "x.numbers")),
		).toBe("unsupported_format");
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

	describe("formula escaping", () => {
		const withValues = (
			values: Dataset["records"][number]["values"],
			columns: Dataset["columns"] = dataset.columns,
		): Dataset => ({
			...dataset,
			columns,
			records: [{ id: "r_1", status: "pending", values }],
		});
		const body = async (
			data: Dataset,
			format: "csv" | "tsv",
			options?: { escapeFormulas?: boolean },
		) =>
			text((await writeTable(data, format, options)).bytes)
				.replace(/^﻿/, "")
				.split("\r\n");

		it.each([
			["=", "=1+1"],
			["+", "+cmd"],
			["-", "-2+3"],
			["@", "@SUM(A1)"],
		])("prefixes a quote to a text cell starting with %s", async (_n, raw) => {
			for (const [format, sep] of [
				["csv", ","],
				["tsv", "\t"],
			] as const) {
				const lines = await body(withValues({ name: raw }), format);
				expect(lines[1]?.split(sep)[0]).toBe(`'${raw}`);
			}
		});

		it("prefixes a quote to a text cell starting with a tab", async () => {
			expect((await body(withValues({ name: "\tx" }), "csv"))[1]).toMatch(
				/^'\tx,/,
			);
			expect((await body(withValues({ name: "\tx" }), "tsv"))[1]).toMatch(
				/^"'\tx"\t/,
			);
		});

		it("prefixes a quote to a cell starting with a carriage return", async () => {
			for (const format of ["csv", "tsv"] as const) {
				const out = await writeTable(withValues({ name: "\rx" }), format);
				expect(text(out.bytes)).toContain(`\r\n"'\rx"`);
			}
		});

		it("leaves numbers stored as numbers unchanged", async () => {
			const data = withValues({ name: "n", points: -5, delta: 3.2, gain: 3.2 });
			const columns = [
				...dataset.columns,
				{ key: "delta", type: "number" },
				{ key: "gain", type: "number" },
			] as Dataset["columns"];
			const csv = await body({ ...data, columns }, "csv");
			expect(csv[1]).toBe("n,,,,,,-5,3.2,3.2");
			const signed = withValues({ name: "n", points: -5 });
			expect((await body(signed, "tsv"))[1]).toBe("n\t\t\t\t\t\t-5");
		});

		it("escapes a numeric-looking string", async () => {
			const csv = await body(withValues({ name: "-5", points: "+3" }), "csv");
			expect(csv[1]).toBe("'-5,,,,,,'+3");
		});

		it("escapes an image cell's file name", async () => {
			const data = {
				...withValues({ photo: `ws:${dataset.assets[0]?.sha256}` }),
				assets: [
					{ ...(dataset.assets[0] as DatasetAsset), name: "-front.png" },
				],
			};
			expect((await body(data, "csv"))[1]).toBe(",,,'-front.png,,,");
		});

		it("escapes a formula in an image cell with no asset", async () => {
			const hyperlink = '=HYPERLINK("http://evil.example","x")';
			const csv = await body(withValues({ photo: hyperlink }), "csv");
			expect(csv[1]).toBe(`,,,"'=HYPERLINK(""http://evil.example"",""x"")",,,`);
			const tsv = await body(withValues({ photo: "@SUM(1+1)" }), "tsv");
			expect(tsv[1]).toBe("\t\t\t'@SUM(1+1)\t\t\t");
		});

		it("reads image cells back as written", async () => {
			const values = ['=HYPERLINK("http://evil.example","x")', "@SUM(1+1)"];
			for (const format of ["csv", "tsv"] as const) {
				for (const photo of values) {
					const out = await writeTable(withValues({ photo }), format);
					const { sheets } = await readTable(out.bytes, `x.${format}`);
					expect(sheets[0]?.rows[1]?.[3], `${format}: ${photo}`).toBe(photo);
				}
			}
		});

		it("doubles a quote before a trigger, in image cells too", async () => {
			const csv = await body(
				withValues({ name: "'=x", tier: "''-y", photo: "'@z.png" }),
				"csv",
			);
			expect(csv[1]).toBe("''=x,,'''-y,''@z.png,,,");
			expect((await body(withValues({ name: "'x" }), "csv"))[1]).toBe(
				"'x,,,,,,",
			);
		});

		it("escapes before quoting", async () => {
			const csv = await body(withValues({ name: '=a,"b"' }), "csv");
			expect(csv[1]?.startsWith(`"'=a,""b"""`)).toBe(true);
		});

		it("leaves cells unchanged when escapeFormulas is false", async () => {
			const columns = [{ key: "h", type: "text" }] as Dataset["columns"];
			const data = withValues({ h: "@x" }, columns);
			for (const format of ["csv", "tsv"] as const) {
				expect(await body(data, format, { escapeFormulas: false })).toEqual([
					"h",
					"@x",
					"",
				]);
			}
		});

		it("reads every text value back as written", async () => {
			const values = ["=1+1", "'=1+1", "''@x", "'x", "-", "'", "\tx", "\rx"];
			for (const format of ["csv", "tsv"] as const) {
				for (const name of values) {
					const out = await writeTable(withValues({ name }), format);
					const { sheets } = await readTable(out.bytes, `x.${format}`);
					expect(sheets[0]?.rows[1]?.[0], `${format}: ${name}`).toBe(name);
				}
			}
		});

		it("keeps the quote when unescapeFormulas is false", async () => {
			const out = await writeTable(withValues({ name: "=1+1" }), "csv");
			const { sheets } = await readTable(out.bytes, "x.csv", {
				unescapeFormulas: false,
			});
			expect(sheets[0]?.rows[1]?.[0]).toBe("'=1+1");
		});

		it("does not unescape workbooks or JSON", async () => {
			const { sheets } = await readTable('[{"a":"\'=x"}]', "x.json");
			expect(sheets[0]?.rows[1]).toEqual(["'=x"]);
		});

		it("round-trips phone numbers, signed amounts and photo names", async () => {
			const asset = {
				...(dataset.assets[0] as DatasetAsset),
				name: "-front.png",
			};
			const columns: Column[] = [
				{ key: "phone", type: "text", pattern: "^\\+[0-9 ]+$", maxLength: 16 },
				{ key: "amount", type: "text", maxLength: 9 },
				{ key: "photo", type: "image" },
			];
			const source: Dataset = {
				...dataset,
				columns,
				assets: [asset],
				records: [
					{
						id: "r_1",
						status: "pending",
						values: {
							phone: "+63 912 345 6789",
							amount: "-1,200.00",
							photo: `ws:${asset.sha256}`,
						},
					},
				],
			};
			for (const format of ["csv", "tsv"] as const) {
				const out = await writeTable(source, format);
				const { sheets } = await readTable(out.bytes, `x.${format}`);
				const rows = sheets[0]?.rows ?? [];
				expect(rows[1]).toEqual([
					"+63 912 345 6789",
					"-1,200.00",
					"-front.png",
				]);
				const plan = importDefaults(sheets, columns);
				const { dataset: back, issues } = applyMapping(
					{ ...source, records: [] },
					rows,
					{ ...plan, mode: "replace" },
				);
				expect(issues).toEqual([]);
				expect(back.records[0]?.values).toEqual(source.records[0]?.values);
			}
		});
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
		const book = await readXlsx(out.bytes, { readStyles: true });
		expect(book.sheets.map((s) => s.name)).toEqual([
			"A very long dataset name  with",
		]);
		const sheet = book.sheets[0];
		expect(sheet?.rows[1]?.slice(1)).toEqual([
			"007",
			"gold",
			"ana.png",
			true,
			new Date("2024-02-29T00:00:00Z"),
			1200,
		]);
		expect(sheet?.cells?.get("1,5")?.style?.numFmt).toBe("yyyy-mm-dd");

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
