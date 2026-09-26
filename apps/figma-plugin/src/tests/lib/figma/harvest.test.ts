import { describe, expect, it } from "vitest";
import type { FieldMeta } from "~/lib/figma/binding";
import {
	planHarvest,
	reconcileFields,
	renameInMarker,
} from "~/lib/figma/harvest";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";

const meta = (over: Partial<FieldMeta> & { id: string }): FieldMeta => ({
	format: "text",
	title: over.id,
	required: true,
	source: "user",
	...over,
});

describe("reconcileFields", () => {
	it("creates metadata for a new field with defaults", () => {
		const { meta: out } = reconcileFields({}, [
			{ id: "display_name", format: "text", default: "Aurora" },
		]);
		expect(out.display_name).toEqual({
			id: "display_name",
			format: "text",
			title: "Display Name",
			required: true,
			source: "user",
			default: "Aurora",
		});
	});

	it("refreshes a non-overridden field's format and default", () => {
		const existing = { brand: meta({ id: "brand", format: "text" }) };
		const { meta: out, typeChanges } = reconcileFields(existing, [
			{ id: "brand", format: "color" },
		]);
		expect(out.brand.format).toBe("color");
		expect(typeChanges).toEqual([]);
	});

	it("keeps an overridden field and never mutates the input", () => {
		const existing = {
			brand: meta({ id: "brand", title: "Brand Color", overridden: true }),
		};
		const { meta: out } = reconcileFields(existing, [
			{ id: "brand", format: "text", default: "x" },
		]);
		expect(out.brand.title).toBe("Brand Color");
		expect(out.brand.default).toBeUndefined();
		expect(existing.brand.title).toBe("Brand Color"); // untouched
	});

	it("flags a format change on an overridden field instead of clobbering", () => {
		const existing = {
			link: meta({ id: "link", format: "url", overridden: true }),
		};
		const { meta: out, typeChanges } = reconcileFields(existing, [
			{ id: "link", format: "text" },
		]);
		expect(out.link.format).toBe("url"); // kept
		expect(typeChanges).toEqual([{ id: "link", from: "url", to: "text" }]);
	});

	it("keeps fields that are absent from the new drafts (binding outlives marker)", () => {
		const existing = { kept: meta({ id: "kept" }) };
		const { meta: out } = reconcileFields(existing, []);
		expect(out.kept).toBeDefined();
	});
});

describe("renameInMarker", () => {
	it("rewrites a token marker", () => {
		expect(renameInMarker("text:{{old}}", "old", "new")).toBe("text:{{new}}");
	});

	it("rewrites an unmarked whole-name token", () => {
		expect(renameInMarker("{{old}}", "old", "new")).toBe("{{new}}");
	});

	it("rewrites within a quoted template, leaving other tokens", () => {
		expect(renameInMarker('text:"{{old}} and {{x}}"', "old", "new")).toBe(
			'text:"{{new}} and {{x}}"',
		);
	});

	it("preserves qr opts", () => {
		expect(renameInMarker("qr:{{old}};ec=M", "old", "new")).toBe(
			"qr:{{new}};ec=M",
		);
	});

	it("matches the exact id, not a prefix", () => {
		expect(renameInMarker("text:{{old_id}}", "old", "new")).toBeNull();
	});

	it("returns null when the name has no such token (pluginData-only rename)", () => {
		expect(renameInMarker("Background", "old", "new")).toBeNull();
		expect(renameInMarker("text:{{other}}", "old", "new")).toBeNull();
	});
});

const bbox = { x: 0, y: 0, width: 10, height: 10 };

function textNode(id: string, name: string, characters: string): FigmaNode {
	return {
		id,
		name,
		type: "TEXT",
		absoluteBoundingBox: bbox,
		characters,
		style: {
			fontFamily: "Inter",
			fontSize: 16,
			fontWeight: 400,
			textAlignHorizontal: "LEFT",
			textAlignVertical: "TOP",
		},
		fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
	};
}

function slotFrame(id: string, children: FigmaNode[]): FigmaContainerNode {
	return { id, name: id, type: "FRAME", absoluteBoundingBox: bbox, children };
}

describe("planHarvest", () => {
	it("emits node bindings and reconciled slot metadata", () => {
		const tree = slotFrame("front", [
			textNode("n1", "text:{{headline}}", "Hello"),
			textNode("n2", "color:{{brand}}", "x"),
		]);
		const plan = planHarvest([{ slotId: "front", tree, existingMeta: {} }]);

		expect(plan.nodeBindings).toEqual([
			{ nodeId: "n1", record: { bind: { text: "{{headline}}" } } },
			{ nodeId: "n2", record: { bind: { textColor: "{{brand}}" } } },
		]);
		expect(plan.slotMeta[0].slotId).toBe("front");
		expect(plan.slotMeta[0].meta.headline).toMatchObject({
			format: "text",
			default: "Hello",
		});
		expect(plan.slotMeta[0].meta.brand).toMatchObject({ format: "color" });
	});

	it("preserves an overridden field and flags a format change", () => {
		const tree = slotFrame("front", [textNode("n2", "color:{{brand}}", "x")]);
		const existingMeta = {
			brand: {
				id: "brand",
				format: "text" as const,
				title: "Brand",
				required: true,
				source: "user" as const,
				overridden: true,
			},
		};
		const plan = planHarvest([{ slotId: "front", tree, existingMeta }]);
		expect(plan.slotMeta[0].meta.brand.format).toBe("text"); // kept
		expect(plan.slotMeta[0].typeChanges).toEqual([
			{ id: "brand", from: "text", to: "color" },
		]);
	});

	it("registers a field only an if: layer names as a toggle", () => {
		const tree = slotFrame("front", [
			textNode("n1", "if:{{show_badge}}", "VIP"),
			textNode("n2", "if:{{headline}}", "{{headline}}"),
		]);
		const plan = planHarvest([{ slotId: "front", tree, existingMeta: {} }]);
		expect(plan.slotMeta[0].meta.show_badge).toMatchObject({
			format: "boolean",
			required: false,
		});
		// A field a layer renders keeps that layer's format.
		expect(plan.slotMeta[0].meta.headline.format).toBe("text");
	});

	it("skips nodes with no inferable binding (cleared markers persist)", () => {
		const tree = slotFrame("front", [textNode("n3", "Just a label", "Static")]);
		const plan = planHarvest([{ slotId: "front", tree, existingMeta: {} }]);
		expect(plan.nodeBindings).toEqual([]);
	});
});
