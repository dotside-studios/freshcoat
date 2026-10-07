import { describe, expect, it } from "vitest";
import { resolveValues, variantsFor } from "./binding";
import { toTemplateValue } from "./columns";
import {
	exportSize,
	fileExtension,
	fileNameFor,
	fileNamePattern,
	imageFormat,
	pdfRenderScale,
	planExport,
} from "./plan";
import {
	deepFreeze,
	type memberCard,
	members,
	preset,
	workspace,
} from "./test-fixtures";
import type {
	DataRecord,
	Dataset,
	ExportItem,
	ExportPreset,
	VariantSource,
	Workspace,
} from "./types";

const ws: Workspace = deepFreeze(workspace);
const plan = (changes: Partial<ExportPreset>) =>
	planExport(ws, { ...preset, ...changes });

describe("planExport", () => {
	it("names files with the format's extension", () => {
		expect(plan({ format: "jpeg-zip" })[0]?.fileName).toBe(
			"member-card-1-front.jpg",
		);
		expect(plan({ format: "webp-zip", scale: 2 })[0]?.fileName).toBe(
			"member-card-1-front@2x.webp",
		);
		// a size from a photo is the photo's pixels, so no density suffix
		expect(
			plan({
				format: "jpeg-zip",
				scale: 2,
				size: { kind: "image", field: "photo" },
			})[0]?.fileName,
		).toBe("member-card-1-front.jpg");
	});

	it("plans every record but skipped ones, in record then side order", () => {
		const items = plan({ records: "all" });
		expect(items.map((i) => i.key)).toEqual([
			"r_00000001:front",
			"r_00000001:back",
			"r_00000002:front",
			"r_00000002:back",
			"r_00000003:front",
			"r_00000003:back",
			"r_00000005:front",
			"r_00000005:back",
		]);
		expect(items.map((i) => i.recordIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
		expect(items[0]).toEqual({
			key: "r_00000001:front",
			recordId: "r_00000001",
			recordIndex: 0,
			side: "front",
			fileName: "member-card-1-front.png",
			values: {
				name: "Ana Cruz",
				number: "M-0001",
				photo: expect.stringMatching(/^ws:/),
				vip: "false",
			},
			variantId: "gold",
		});
		expect(items[6]?.values.number).toBe("M-0004");
		expect(items[4]?.variantId).toBeUndefined();
		expect("variantId" in (items[4] ?? {})).toBe(false);
	});

	it("filters pending, failed and selected records", () => {
		const ids = (p: Partial<ExportPreset>) => [
			...new Set(plan(p).map((i) => i.recordId)),
		];
		expect(ids({ records: "pending" })).toEqual(["r_00000001", "r_00000005"]);
		expect(ids({ records: "failed" })).toEqual(["r_00000003"]);
		expect(
			ids({
				records: "selected",
				selected: ["r_00000005", "r_00000004", "nope"],
			}),
		).toEqual(["r_00000004", "r_00000005"]);
		expect(ids({ records: "selected" })).toEqual([]);
		const failed = plan({ records: "failed" });
		expect(failed[0]?.recordIndex).toBe(0);
		expect(failed[0]?.values.number).toBe("M-0001");
	});

	it("filters sides, keeping the template's order", () => {
		expect(
			plan({ records: "pending", sides: ["back", "nope"] }).map((i) => i.key),
		).toEqual(["r_00000001:back", "r_00000005:back"]);
		expect(plan({ sides: [] })).toEqual([]);
	});

	it("names files from tokens, sanitised, deduped, with the scale", () => {
		const items = plan({
			records: "pending",
			fileName: "{{ name }} {{tier}}/{{record}}-{{missing}}",
			scale: 2,
			sides: ["front"],
		});
		expect(items.map((i) => i.fileName)).toEqual([
			"Ana-Cruz-gold-r_00000001-@2x.png",
			"Ed-Go--r_00000005-@2x.png",
		]);
		const dup = plan({ fileName: "card", sides: ["front"], records: "all" });
		expect(dup.map((i) => i.fileName)).toEqual([
			"card.png",
			"card-2.png",
			"card-3.png",
			"card-4.png",
		]);
	});

	it("pads the index to the width of the count", () => {
		const many: Workspace = {
			...ws,
			datasets: [
				{
					...ws.datasets[0],
					records: Array.from({ length: 12 }, (_, i) => ({
						id: `r_${i}`,
						values: {},
						status: "pending" as const,
					})),
				} as Workspace["datasets"][number],
			],
		};
		const items = planExport(many, { ...preset, sides: ["back"] });
		expect(items[0]?.fileName).toBe("member-card-01-back.png");
		expect(items[11]?.fileName).toBe("member-card-12-back.png");
	});

	it("plans one item per side with defaults for an unbound template", () => {
		const items = plan({ templateId: "t_plain", scale: 3 });
		expect(items).toEqual([
			{
				key: ":front",
				recordId: "",
				recordIndex: 0,
				side: "front",
				fileName: "plain-1-front@3x.png",
				values: { name: "Member", number: "0000", photo: "", vip: "false" },
			},
			expect.objectContaining({ key: ":back", side: "back" }),
		]);
	});

	it("uses defaults when the bound dataset is gone", () => {
		const gone: Workspace = { ...ws, datasets: [] };
		const items = planExport(gone, preset);
		expect(items).toHaveLength(2);
		expect(items[0]?.values.number).toBe("0000");
	});

	it("plans nothing for an unknown template", () => {
		expect(plan({ templateId: "nope" })).toEqual([]);
	});
});

describe("planExport against the per-record functions", () => {
	it("plans what resolveValues, variantsFor and fileNameFor give", () => {
		const fileName = "{{name}}-{{tier}}-{{number}}-{{side}}";
		const entry = ws.templates[0] as Workspace["templates"][number];
		const items = plan({ records: "all", fileName });
		const records = members.records.filter((r) => r.status !== "skipped");
		const expected = records.flatMap((record, recordIndex) => {
			const values = resolveValues(
				entry.template,
				entry.binding,
				members,
				record,
				recordIndex,
			);
			const cells = Object.fromEntries(
				members.columns.map((c) => [
					c.key,
					toTemplateValue(c, record.values[c.key] ?? null),
				]),
			);
			return variantsFor(
				entry.template,
				entry.binding,
				members,
				record,
			).flatMap((variantId) =>
				["front", "back"].map((side) => ({
					key: `${record.id}:${side}`,
					recordId: record.id,
					recordIndex,
					side,
					fileName: `${fileNameFor(fileName, {
						template: entry.template.id,
						side,
						index: recordIndex + 1,
						count: records.length,
						record: record.id,
						variant: variantId,
						cells,
						values,
					})}.png`,
					values,
					...(variantId !== undefined ? { variantId } : {}),
				})),
			);
		});
		expect(items).toEqual(expected);
		expect(items.map((i) => i.fileName)).toEqual([
			"Ana-Cruz-gold-007-front.png",
			"Ana-Cruz-gold-007-back.png",
			"Ben-Uy-Gold-Tier--front.png",
			"Ben-Uy-Gold-Tier--back.png",
			"Cy-Ong-bronze--front.png",
			"Cy-Ong-bronze--back.png",
			"Ed-Go---front.png",
			"Ed-Go---back.png",
		]);
	});
});

describe("planExport file names against the regex expansion", () => {
	const SOURCE_EXTENSION =
		/\.(jpe?g|jfif|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i;
	const legacyExpand = (
		source: string,
		ctx: Parameters<typeof fileNameFor>[1],
	) => {
		const width = String(Math.max(ctx.count, 1)).length;
		const expanded = source.replace(
			/\{\{\s*([^{}]*?)\s*\}\}/g,
			(_, token: string) => {
				switch (token) {
					case "template":
						return ctx.template;
					case "side":
						return ctx.side;
					case "index":
						return String(ctx.index).padStart(width, "0");
					case "record":
						return ctx.record;
					case "variant":
						return ctx.variant ?? "default";
					default:
						return (ctx.cells?.[token] ?? ctx.values?.[token] ?? "").replace(
							SOURCE_EXTENSION,
							"",
						);
				}
			},
		);
		const clean = expanded.replace(/[^\w.-]/g, "-");
		return clean === "" || /^\.+$/.test(clean) ? "file" : clean;
	};
	const legacyNames = (items: ExportItem[], pattern: string) => {
		const used = new Set<string>();
		const unique = (base: string) => {
			let name = base;
			for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
			used.add(name.toLowerCase());
			return name;
		};
		const count = new Set(items.map((i) => i.recordId)).size;
		return items.map((item) => {
			const record = dataset.records.find((r) => r.id === item.recordId);
			const cells = Object.fromEntries(
				dataset.columns.map((c) => [
					c.key,
					toTemplateValue(c, record?.values[c.key] ?? null),
				]),
			);
			const base = legacyExpand(fileNamePattern(pattern), {
				template: "member-card",
				side: item.side,
				index: item.recordIndex + 1,
				count,
				record: item.recordId,
				variant: item.variantId,
				cells,
				values: item.values,
			});
			return `${unique(base)}.png`;
		});
	};
	const names = [
		"Ana Cruz",
		"Ana Cruz",
		"ana cruz",
		"Ana-Cruz-2",
		"ANA CRUZ",
		undefined,
		"",
		"...",
		"IMG_1.JPG",
		"img_1.png",
		"Ana-Cruz",
		"Zoë Ñ",
	];
	const dataset: Dataset = {
		...members,
		records: names.map(
			(name, i): DataRecord => ({
				id: `r_${i}`,
				values: name === undefined ? {} : { name },
				status: "pending",
			}),
		),
	};
	const fixture: Workspace = { ...ws, datasets: [dataset] };

	it.each([
		"{{name}}",
		"{{ name }}-{{side}}",
		"{{name}}-{{index}}",
		"{{missing}}",
		"{{name}}.{{tier}}.{{number}}",
		"{{template}}/{{record}}/{{variant}}",
		"{{name}}{{name}}-{{",
		"",
	])("matches for %j", (fileName) => {
		const items = planExport(fixture, { ...preset, fileName });
		expect(items).toHaveLength(names.length * 2);
		expect(items.map((i) => i.fileName)).toEqual(legacyNames(items, fileName));
	});

	it("pads the index to the record count", () => {
		const items = planExport(fixture, { ...preset, sides: ["front"] });
		expect(items.map((i) => i.fileName).slice(8, 10)).toEqual([
			"member-card-09-front.png",
			"member-card-10-front.png",
		]);
	});
});

describe("planExport under every variant", () => {
	const variants: NonNullable<typeof memberCard.variants> = [
		{
			id: "gold",
			label: "Gold",
			overrides: [
				{
					name: "front",
					elements: [{ id: "name", properties: { color: "#b8860b" } }],
				},
			],
		},
		// changes nothing, so it renders as Default and is left out
		{
			id: "same",
			label: "Same",
			overrides: [
				{ name: "front", elements: [{ id: "name", properties: {} }] },
			],
		},
		{
			id: "night",
			label: "Night",
			overrides: [
				{
					name: "back",
					background: {
						id: "back_bg",
						type: "rect",
						pos: { x: 0, y: 0 },
						size: { width: 1012, height: 638 },
						properties: { fill: "#000000" },
					},
				},
			],
		},
	];
	const withSource = (variant: VariantSource, bound = true): Workspace => {
		const [member, plain] = ws.templates;
		const entry = bound ? member : plain;
		return {
			...ws,
			templates: [
				{
					...entry,
					template: { ...entry.template, variants },
					binding: {
						...(entry.binding ?? { datasetId: "", fields: {} }),
						variant,
					},
				},
			],
		} as Workspace;
	};
	const all = withSource({ kind: "all" });

	it("plans each record in Default, then each variant that changes something", () => {
		const items = planExport(all, { ...preset, records: "pending" });
		expect(items.map((i) => i.key)).toEqual([
			"r_00000001:front:default",
			"r_00000001:back:default",
			"r_00000001:front:gold",
			"r_00000001:back:gold",
			"r_00000001:front:night",
			"r_00000001:back:night",
			"r_00000005:front:default",
			"r_00000005:back:default",
			"r_00000005:front:gold",
			"r_00000005:back:gold",
			"r_00000005:front:night",
			"r_00000005:back:night",
		]);
		expect(items.map((i) => i.variantId)).toEqual(
			[undefined, undefined, "gold", "gold", "night", "night"].concat([
				undefined,
				undefined,
				"gold",
				"gold",
				"night",
				"night",
			]),
		);
		expect("variantId" in (items[0] ?? {})).toBe(false);
		expect(items.map((i) => i.recordIndex)).toEqual([
			0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
		]);
		// the column the binding used to read is not consulted under all
		expect(items[2]?.values.name).toBe("Ana Cruz");
	});

	it("plans only Default when no variant changes anything", () => {
		const bare: Workspace = {
			...all,
			templates: [
				{
					...all.templates[0],
					template: { ...all.templates[0].template, variants: [variants[1]] },
				},
			],
		} as Workspace;
		const items = planExport(bare, {
			...preset,
			records: "pending",
			sides: ["front"],
		});
		expect(items.map((i) => i.key)).toEqual([
			"r_00000001:front:default",
			"r_00000005:front:default",
		]);
	});

	it("appends the variant to a pattern that does not name it", () => {
		const names = (fileName: string, scale = 1) =>
			planExport(all, {
				...preset,
				records: "pending",
				sides: ["front"],
				fileName,
				scale,
			}).map((i) => i.fileName);
		expect(names("", 2).slice(0, 3)).toEqual([
			"member-card-1-front-default@2x.png",
			"member-card-1-front-gold@2x.png",
			"member-card-1-front-night@2x.png",
		]);
		expect(names("{{name}}").slice(0, 3)).toEqual([
			"Ana-Cruz-default.png",
			"Ana-Cruz-gold.png",
			"Ana-Cruz-night.png",
		]);
		expect(names("{{ variant }}_{{record}}").slice(0, 2)).toEqual([
			"default_r_00000001.png",
			"gold_r_00000001.png",
		]);
	});

	it("leaves keys and patterns alone under any other source", () => {
		const fixed = withSource({ kind: "fixed", id: "night" });
		const items = planExport(fixed, {
			...preset,
			records: "pending",
			sides: ["front"],
			fileName: "{{record}}-{{variant}}",
		});
		expect(items.map((i) => [i.key, i.fileName, i.variantId])).toEqual([
			["r_00000001:front", "r_00000001-night.png", "night"],
			["r_00000005:front", "r_00000005-night.png", "night"],
		]);
		// by column: a record whose tier names no variant is Default
		const byColumn = plan({
			records: "all",
			sides: ["front"],
			fileName: "{{variant}}",
		});
		expect(byColumn.map((i) => [i.key, i.fileName])).toEqual([
			["r_00000001:front", "gold.png"],
			["r_00000002:front", "gold-2.png"],
			["r_00000003:front", "default.png"],
			["r_00000005:front", "default-2.png"],
		]);
	});

	it("honours a fixed variant for a template with no dataset", () => {
		const items = planExport(withSource({ kind: "fixed", id: "gold" }, false), {
			...preset,
			templateId: "t_plain",
		});
		expect(items.map((i) => [i.key, i.variantId])).toEqual([
			[":front", "gold"],
			[":back", "gold"],
		]);
		expect(items[0]?.fileName).toBe("plain-1-front.png");
		const unknown = planExport(
			withSource({ kind: "fixed", id: "bronze" }, false),
			{ ...preset, templateId: "t_plain" },
		);
		expect(unknown.map((i) => i.variantId)).toEqual([undefined, undefined]);
	});

	it("plans every variant for a template with no dataset", () => {
		const items = planExport(withSource({ kind: "all" }, false), {
			...preset,
			templateId: "t_plain",
			sides: ["front"],
		});
		expect(items).toEqual([
			expect.objectContaining({
				key: ":front:default",
				recordId: "",
				fileName: "plain-1-front-default.png",
				values: { name: "Member", number: "0000", photo: "", vip: "false" },
			}),
			expect.objectContaining({
				key: ":front:gold",
				variantId: "gold",
				fileName: "plain-1-front-gold.png",
			}),
			expect.objectContaining({
				key: ":front:night",
				variantId: "night",
				fileName: "plain-1-front-night.png",
			}),
		]);
	});

	it("honours the variant source when the bound dataset is gone", () => {
		const gone: Workspace = {
			...withSource({ kind: "fixed", id: "night" }),
			datasets: [],
		};
		expect(planExport(gone, preset).map((i) => i.variantId)).toEqual([
			"night",
			"night",
		]);
	});
});

describe("fileNamePattern", () => {
	it("uses the default for an empty pattern", () => {
		expect(fileNamePattern(" ")).toBe("{{template}}-{{index}}-{{side}}");
		expect(fileNamePattern("", true)).toBe(
			"{{template}}-{{index}}-{{side}}-{{variant}}",
		);
	});

	it("appends the variant only when exporting every one and it is absent", () => {
		expect(fileNamePattern("{{name}}")).toBe("{{name}}");
		expect(fileNamePattern("{{name}}", true)).toBe("{{name}}-{{variant}}");
		expect(fileNamePattern("{{variant}}/{{name}}", true)).toBe(
			"{{variant}}/{{name}}",
		);
		expect(fileNamePattern("{{ variant }}", true)).toBe("{{ variant }}");
	});
});

describe("fileNameFor", () => {
	const ctx = {
		template: "t",
		side: "front",
		index: 3,
		count: 120,
		record: "r_1",
	};

	it("fills tokens and falls back to the default pattern", () => {
		expect(fileNameFor("{{template}}-{{index}}-{{side}}", ctx)).toBe(
			"t-003-front",
		);
		expect(fileNameFor("", ctx)).toBe("t-003-front");
		expect(
			fileNameFor("{{a}}", { ...ctx, cells: { a: "x" }, values: { a: "y" } }),
		).toBe("x");
		expect(fileNameFor("{{f}}", { ...ctx, values: { f: "José Ñ" } })).toBe(
			"Jos---",
		);
		expect(fileNameFor("{{nothing}}", ctx)).toBe("file");
	});

	it("names the variant, or default", () => {
		expect(fileNameFor("{{side}}-{{variant}}", ctx)).toBe("front-default");
		expect(fileNameFor("{{variant}}", { ...ctx, variant: "gold" })).toBe(
			"gold",
		);
		// the token names the variant even where a column shares its key
		expect(
			fileNameFor("{{variant}}", {
				...ctx,
				variant: "gold",
				cells: { variant: "Gold Tier" },
			}),
		).toBe("gold");
	});

	it("drops a photo's own extension from a token's value", () => {
		const name = (file_name: string, pattern = "{{file_name}}") =>
			fileNameFor(pattern, { ...ctx, cells: { file_name } });
		expect(name("IMG_1001.jpg")).toBe("IMG_1001");
		expect(name("IMG_1001.JPEG")).toBe("IMG_1001");
		expect(name("scan.tiff")).toBe("scan");
		expect(name("shot.heic", "{{file_name}}-marked")).toBe("shot-marked");
		// only the last extension, and only a photo's
		expect(name("holiday.2024.png")).toBe("holiday.2024");
		expect(name("notes.txt")).toBe("notes.txt");
		expect(name(".jpg")).toBe("file");
	});
});

describe("planExport with photo file names", () => {
	const photos: Workspace = {
		...ws,
		datasets: [
			{
				...members,
				records: [
					["IMG_1001.jpg", "pending"],
					["IMG_1002.JPG", "pending"],
					["IMG_1001.jpeg", "pending"],
					["img_1001.png", "pending"],
				].map(([name, status], i) => ({
					id: `r_${i}`,
					values: { name },
					status: status as "pending",
				})),
			},
		],
	};
	const names = (format: ExportPreset["format"]) =>
		planExport(photos, {
			...preset,
			sides: ["front"],
			fileName: "{{name}}",
			format,
		}).map((i) => i.fileName);

	it("takes the output format's extension and dedupes", () => {
		expect(names("jpeg-zip")).toEqual([
			"IMG_1001.jpg",
			"IMG_1002.jpg",
			"IMG_1001-2.jpg",
			"img_1001-3.jpg",
		]);
		expect(names("webp-zip")[0]).toBe("IMG_1001.webp");
	});
});

describe("pdfRenderScale", () => {
	it("clamps dpi / 96 to 1..4", () => {
		expect(pdfRenderScale(300)).toBe(3.125);
		expect(pdfRenderScale(72)).toBe(1);
		expect(pdfRenderScale(600)).toBe(4);
	});
});

describe("preset helpers", () => {
	it("defaults the size to the template's", () => {
		expect(exportSize({})).toEqual({ kind: "template" });
		expect(exportSize({ size: { kind: "image", field: "photo" } })).toEqual({
			kind: "image",
			field: "photo",
		});
	});

	it("maps a format to what each file is encoded as", () => {
		expect(imageFormat({ format: "png-zip" })).toBe("png");
		expect(imageFormat({ format: "jpeg-zip" })).toBe("jpeg");
		expect(imageFormat({ format: "webp-zip" })).toBe("webp");
		expect(imageFormat({ format: "pdf" })).toBe("png");
		expect(imageFormat({ format: "pdf", pdfPageImage: "jpeg" })).toBe("jpeg");
		expect(fileExtension("jpeg-zip")).toBe("jpg");
		expect(fileExtension("pdf")).toBe("png");
	});
});
