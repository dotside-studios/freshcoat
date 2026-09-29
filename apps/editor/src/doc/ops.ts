import type {
	Background,
	Element,
	FieldDefinition,
	FontDescriptor,
	Insets,
	Template,
	TemplateFrame,
	Variant,
} from "@freshcoat-js/coatfile";
import {
	applyVariant,
	assetUri,
	bytesToBase64,
	checkVariants,
	collectAssetRefs,
	FORMAT_MINOR,
	FORMAT_VERSION,
	formatVersionStatus,
	hasInsets,
	parseAssetUri,
	resolveInsets,
	subtleSha256,
	type VariantElementDelta,
} from "@freshcoat-js/coatfile";
import type { CanvasKit } from "canvaskit-wasm";
import { BOOLEAN, INSETS, KEY_RULE, plural, VARIANT_COPY } from "~/app/copy";
import { type Draft, produce } from "~/state/immer";
import { type BooleanOp, combineShapes, isBooleanShape } from "./boolean";
import { round2 } from "./factories";
import {
	isAutoLayoutChild,
	type LayerGeometry,
	parentOrigin,
	type Rect,
	rectOf,
	unionRects,
} from "./geometry";
import { collectIds, nextFreeId, uniquifyTree } from "./ids";
import {
	childEntries,
	compareKeys,
	getElement,
	isAncestor,
	isBackgroundPath,
	keyOf,
	MASK_SOURCE,
	parseKey,
	walkLayers,
} from "./path";
import { type OpOk, type OpRefused, type OpResult, ok, refuse } from "./result";
import {
	listAt,
	mergeDefined,
	updateAt,
	updateBackground,
	updateList,
	updateSide,
} from "./tree";
import { DELTA_SHELL, type DeltaShellKey, sameJson } from "./variant-edit";

export type { OpOk, OpRefused, OpResult, RefusalCode } from "./result";
export { ok, refuse, unwrap } from "./result";

/** A top-level parent: the side itself. */
export type SideRoot = { side: number };
export type ParentRef = string | SideRoot;

/** Shell fields merge; `properties` merges one level deep. `undefined`
 *  removes a key. */
export type ElementPatch = Partial<Omit<Element, "type" | "properties">> & {
	properties?: Record<string, unknown>;
};

const NOT_FOUND = "That layer no longer exists";
const FIELD_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MAX_SIDE = 16384;

// ── Layers ───────────────────────────────────────────────────────────────────

export function updateElement(
	t: Template,
	key: string,
	patch: ElementPatch | ((el: Element | Background) => Element | Background),
): OpResult {
	const p = parseKey(key);
	const el = p && getElement(t, p);
	if (!p || !el) return refuse("not_found", NOT_FOUND);
	const apply = <T extends Element | Background>(e: T): T => {
		if (typeof patch === "function") return patch(e) as T;
		const { properties, ...shell } = patch;
		const merged = mergeDefined(e, shell);
		return properties
			? ({ ...merged, properties: mergeDefined(e.properties, properties) } as T)
			: merged;
	};
	const next = isBackgroundPath(p)
		? updateBackground(t, p.side, apply)
		: updateAt(t, p.side, p.path, apply);
	return ok(next, [key]);
}

type ParentInfo = { side: number; path: number[]; list: Element[] };

function resolveParent(t: Template, parent: ParentRef): ParentInfo | string {
	if (typeof parent !== "string") {
		const frame = t.template_data[parent.side];
		return frame
			? { side: parent.side, path: [], list: frame.elements }
			: "not_found";
	}
	const p = parseKey(parent);
	if (!p) return "not_found";
	if (isBackgroundPath(p)) return "background";
	const list = listAt(t, p.side, p.path);
	if (!list) return getElement(t, p) ? "not_a_container" : "not_found";
	return { side: p.side, path: p.path, list };
}

function parentRefusal(code: string): OpResult {
	if (code === "background")
		return refuse("background", "Layers can't go inside the background");
	if (code === "not_a_container")
		return refuse("not_a_container", "Only frames and masks hold layers");
	return refuse("not_found", NOT_FOUND);
}

/** Inserts `elements` at `index` of the parent's children, each (and all it
 *  holds) given ids unused on the side. */
export function insertElements(
	t: Template,
	parent: ParentRef,
	index: number,
	elements: Element[],
): OpResult {
	const info = resolveParent(t, parent);
	if (typeof info === "string") return parentRefusal(info);
	const at = clampIndex(index, info.list.length);
	const used = usedIds(t, info.side);
	const fresh = elements.map((el) => uniquifyTree(el, used));
	const next = updateList(t, info.side, info.path, (list) => [
		...list.slice(0, at),
		...fresh,
		...list.slice(at),
	]);
	return ok(
		next,
		fresh.map((_, i) =>
			keyOf({ side: info.side, path: [...info.path, at + i] }),
		),
	);
}

type Target = { key: string; path: number[]; side: number };

/** Parses and checks layer keys: no background, no mask source, and none
 *  inside another listed one. Sorted in document order. */
function targetsOf(t: Template, keys: string[]): Target[] | OpResult {
	const out: Target[] = [];
	for (const key of [...new Set(keys)].sort(compareKeys)) {
		const p = parseKey(key);
		if (!p || !getElement(t, p)) return refuse("not_found", NOT_FOUND);
		if (isBackgroundPath(p))
			return refuse("background", "The background can't be moved or removed");
		if (p.path.at(-1) === MASK_SOURCE)
			return refuse("mask_source", "A mask needs its source");
		out.push({ key, path: p.path, side: p.side });
	}
	return out.filter((a) => !out.some((b) => isAncestor(b.key, a.key)));
}

/** Removes layers and, in every variant, the changes to them and to
 *  everything they hold. */
export function removeElements(t: Template, keys: string[]): OpResult {
	const targets = targetsOf(t, keys);
	if (!Array.isArray(targets)) return targets;
	const removed = removeTargets(t, targets);
	const bySide = new Map<number, Set<string>>();
	for (const tg of targets) {
		const ids = bySide.get(tg.side) ?? new Set<string>();
		subtreeIds(getElement(t, tg.key) as Element, ids);
		bySide.set(tg.side, ids);
	}
	let next = removed;
	for (const [side, ids] of bySide)
		next = editDeltas(next, t.template_data[side]?.name ?? "", (d) =>
			ids.has(d.id) ? [] : [d],
		);
	return ok(next, []);
}

function removeTargets(t: Template, targets: Target[]): Template {
	let next = t;
	// Deepest and last first, so the paths still to remove stay valid.
	for (const tg of [...targets].reverse()) {
		const idx = tg.path.at(-1) as number;
		next = updateList(next, tg.side, tg.path.slice(0, -1), (list) =>
			list.filter((_, i) => i !== idx),
		);
	}
	return next;
}

/**
 * Reorders or reparents layers, inserting them at `index` of the target's
 * children as the list reads before the move. Reparented layers keep their
 * absolute position.
 */
export function moveElements(
	t: Template,
	keys: string[],
	targetParent: ParentRef,
	index: number,
	geometry: LayerGeometry,
): OpResult {
	const targets = targetsOf(t, keys);
	if (!Array.isArray(targets)) return targets;
	if (targets.length === 0) return refuse("empty_selection", "Nothing to move");
	const info = resolveParent(t, targetParent);
	if (typeof info === "string") return parentRefusal(info);
	const parentKey =
		info.path.length === 0 ? null : keyOf({ side: info.side, path: info.path });
	for (const tg of targets) {
		if (tg.side !== info.side)
			return refuse("cross_side", "Layers must stay on one side");
		if (parentKey && (tg.key === parentKey || isAncestor(tg.key, parentKey)))
			return refuse("into_descendant", "A layer can't move inside itself");
	}

	const newOrigin =
		parentKey === null
			? { x: 0, y: 0 }
			: (() => {
					const r = rectOf(t, parentKey, geometry) as Rect;
					return { x: r.x, y: r.y };
				})();
	const sameList = (tg: Target) =>
		tg.path.length - 1 === info.path.length &&
		info.path.every((v, i) => tg.path[i] === v);

	const shifts: PosShift[] = [];
	const moving = targets.map((tg) => {
		const el = getElement(t, tg.key) as Element;
		if (sameList(tg)) return el;
		const r = rectOf(t, tg.key, geometry);
		if (!r) return el;
		const pos = { x: round2(r.x - newOrigin.x), y: round2(r.y - newOrigin.y) };
		shifts.push(posShift(el, pos));
		return { ...el, pos } as Element;
	});
	const at =
		clampIndex(index, info.list.length) -
		targets.filter((tg) => sameList(tg) && (tg.path.at(-1) as number) < index)
			.length;

	const removed = removeTargets(t, targets);
	// Removing can shift the target parent's own path.
	const shifted = shiftPath(info.path, targets);
	const placed = updateList(removed, info.side, shifted, (list) => [
		...list.slice(0, at),
		...moving,
		...list.slice(at),
	]);
	const next = shiftDeltaPositions(
		placed,
		t.template_data[info.side]?.name ?? "",
		shifts,
	);
	return ok(
		next,
		moving.map((_, i) =>
			keyOf({ side: info.side, path: [...shifted, at + i] }),
		),
	);
}

// Where `path` lands once `removed` are taken out of the tree.
function shiftPath(path: number[], removed: Target[]): number[] {
	const out = path.slice();
	for (let depth = 0; depth < path.length; depth++) {
		const prefix = path.slice(0, depth);
		const n = removed.filter(
			(r) =>
				r.path.length === depth + 1 &&
				prefix.every((v, i) => r.path[i] === v) &&
				(r.path[depth] as number) < path[depth],
		).length;
		out[depth] -= n;
	}
	return out;
}

/** A copy of each layer directly above it, offset by `offset` (10) on both
 *  axes unless its parent places it with auto layout. Every variant's changes
 *  to a layer, and to what it holds, are copied to the copy, offset alike. */
export function duplicateElements(
	t: Template,
	keys: string[],
	opts: { offset?: number } = {},
): OpResult {
	const targets = targetsOf(t, keys);
	if (!Array.isArray(targets)) return targets;
	const offset = opts.offset ?? 10;
	let next = t;
	const copies: Element[] = [];
	const copied: {
		side: number;
		root: string;
		ids: Map<string, string>;
		offset: number;
	}[] = [];
	for (const tg of [...targets].reverse()) {
		const el = getElement(next, tg.key) as Element;
		const parentPath = tg.path.slice(0, -1);
		const parent =
			parentPath.length > 0
				? getElement(next, { side: tg.side, path: parentPath })
				: undefined;
		const placed =
			parent?.type === "frame" &&
			parent.properties.layout !== undefined &&
			!el.layoutChild?.absolute;
		const used = usedIds(next, tg.side);
		const copy = uniquifyTree(
			placed || offset === 0
				? el
				: {
						...el,
						pos: {
							x: (el.pos?.x ?? 0) + offset,
							y: (el.pos?.y ?? 0) + offset,
						},
					},
			used,
		);
		copies.push(copy);
		const ids = new Map<string, string>();
		pairIds(el, copy, ids);
		copied.push({
			side: tg.side,
			root: el.id,
			ids,
			offset: placed ? 0 : offset,
		});
		const idx = tg.path.at(-1) as number;
		next = updateList(next, tg.side, parentPath, (list) => [
			...list.slice(0, idx + 1),
			copy,
			...list.slice(idx + 1),
		]);
	}
	const keysOut = keysOfObjects(next, copies.reverse());
	for (const { side, root, ids, offset: by } of copied)
		next = editDeltas(next, t.template_data[side]?.name ?? "", (d) => {
			const id = ids.get(d.id);
			if (id === undefined) return [d];
			// Only the copy itself is offset; what it holds sits in it.
			const moved = by !== 0 && d.id === root;
			return [
				d,
				{
					...d,
					id,
					...(moved && d.pos
						? { pos: { x: d.pos.x + by, y: d.pos.y + by } }
						: {}),
				},
			];
		});
	return ok(next, keysOut);
}

function keysOfObjects(t: Template, els: Element[]): string[] {
	const byObject = new Map<unknown, string>();
	t.template_data.forEach((_, side) => {
		for (const e of walkLayers(t, side)) byObject.set(e.element, e.key);
	});
	return els.map((el) => byObject.get(el) as string);
}

/** Wraps sibling layers in a frame at their union box, placed where the
 *  topmost of them was. */
export function groupElements(
	t: Template,
	keys: string[],
	geometry: LayerGeometry,
): OpResult {
	const targets = targetsOf(t, keys);
	if (!Array.isArray(targets)) return targets;
	if (targets.length === 0)
		return refuse("empty_selection", "Select layers to group");
	const parentPath = targets[0].path.slice(0, -1);
	const side = targets[0].side;
	const siblings = targets.every(
		(tg) =>
			tg.side === side &&
			tg.path.length === parentPath.length + 1 &&
			parentPath.every((v, i) => tg.path[i] === v),
	);
	if (!siblings) return refuse("not_siblings", "Layers must share a parent");

	const rects = targets.map((tg) => rectOf(t, tg.key, geometry) as Rect);
	const box = unionRects(rects);
	const origin = parentOrigin(t, targets[0].key, geometry);
	const shifts: PosShift[] = [];
	const children = targets.map((tg, i) => {
		const el = getElement(t, tg.key) as Element;
		const pos = {
			x: round2(rects[i].x - box.x),
			y: round2(rects[i].y - box.y),
		};
		shifts.push(posShift(el, pos));
		return { ...el, pos } as Element;
	});
	const frame: Element = {
		id: nextFreeId(usedIds(t, side), "group"),
		type: "frame",
		pos: { x: round2(box.x - origin.x), y: round2(box.y - origin.y) },
		size: { width: round2(box.width), height: round2(box.height) },
		properties: { children },
	};
	const indexes = targets.map((tg) => tg.path.at(-1) as number);
	const at = Math.max(...indexes) - (indexes.length - 1);
	const grouped = updateList(t, side, parentPath, (list) => {
		const rest = list.filter((_, i) => !indexes.includes(i));
		return [...rest.slice(0, at), frame, ...rest.slice(at)];
	});
	const next = shiftDeltaPositions(
		grouped,
		t.template_data[side]?.name ?? "",
		shifts,
	);
	return ok(next, [keyOf({ side, path: [...parentPath, at] })]);
}

/**
 * Combines sibling shapes into one vector layer with `op`, in the bottom-most
 * one's place, keeping its fill, stroke and effects, as Figma does.
 */
export function booleanElements(
	t: Template,
	keys: string[],
	op: BooleanOp,
	ck: CanvasKit,
): OpResult {
	const targets = targetsOf(t, keys);
	if (!Array.isArray(targets)) return targets;
	if (targets.length < 2) return refuse("too_few", BOOLEAN.tooFew);
	const parentPath = targets[0].path.slice(0, -1);
	const side = targets[0].side;
	const siblings = targets.every(
		(tg) =>
			tg.side === side &&
			tg.path.length === parentPath.length + 1 &&
			parentPath.every((v, i) => tg.path[i] === v),
	);
	if (!siblings) return refuse("not_siblings", "Layers must share a parent");
	const elements = targets.map((tg) => getElement(t, tg.key) as Element);
	const odd = targets.filter((_, i) => !isBooleanShape(elements[i]));
	if (odd.length)
		return refuse(
			"not_a_shape",
			BOOLEAN.notShape,
			odd.map((tg) => tg.key),
		);
	if (targets.some((tg) => isAutoLayoutChild(t, tg.key)))
		return refuse("auto_layout", BOOLEAN.autoLayout);
	const shape = combineShapes(ck, elements, op);
	if (!shape) return refuse("empty_result", BOOLEAN.empty);

	const bottom = elements[0] as Exclude<
		Element,
		{ type: "frame" | "mask" | "text" | "image" | "qr_code" | "barcode" }
	>;
	const {
		id: _id,
		type: _type,
		pos: _pos,
		size: _size,
		rotation: _rotation,
		properties,
		...shell
	} = bottom;
	const combined: Element = {
		...shell,
		id: nextFreeId(usedIds(t, side), op),
		type: "vector",
		pos: { x: shape.box.x, y: shape.box.y },
		size: { width: shape.box.width, height: shape.box.height },
		properties: {
			d: shape.d,
			...(shape.fillRule ? { fillRule: shape.fillRule } : {}),
			...(properties.fill !== undefined ? { fill: properties.fill } : {}),
			...(properties.stroke !== undefined ? { stroke: properties.stroke } : {}),
		},
	};
	const indexes = targets.map((tg) => tg.path.at(-1) as number);
	const at = Math.min(...indexes);
	const replaced = updateList(t, side, parentPath, (list) => {
		const rest = list.filter((_, i) => !indexes.includes(i));
		return [...rest.slice(0, at), combined, ...rest.slice(at)];
	});
	const ids = new Set<string>();
	for (const el of elements) subtreeIds(el, ids);
	const next = editDeltas(replaced, t.template_data[side]?.name ?? "", (d) =>
		ids.has(d.id) ? [] : [d],
	);
	return ok(next, [keyOf({ side, path: [...parentPath, at] })]);
}

/** Lifts a frame's children into its parent at the frame's index, each
 *  keeping its absolute box. */
export function ungroup(
	t: Template,
	key: string,
	geometry: LayerGeometry,
): OpResult {
	const p = parseKey(key);
	const el = p && getElement(t, p);
	if (!p || !el) return refuse("not_found", NOT_FOUND);
	if (isBackgroundPath(p) || el.type !== "frame")
		return refuse("not_a_frame", "Only a frame can be ungrouped");
	if (el.rotation)
		return refuse("rotated", "A rotated frame can't be ungrouped");
	if (el.properties.layout)
		return refuse("auto_layout", "Remove the frame's auto layout first");
	const origin = parentOrigin(t, key, geometry);
	const frameRect = rectOf(t, key, geometry) as Rect;
	const shifts: PosShift[] = [];
	const lifted = el.properties.children.map((child, i) => {
		const r = geometry.get(`${key}/${i}`)?.rect;
		const x = r ? r.x - origin.x : frameRect.x - origin.x + (child.pos?.x ?? 0);
		const y = r ? r.y - origin.y : frameRect.y - origin.y + (child.pos?.y ?? 0);
		const pos = { x: round2(x), y: round2(y) };
		shifts.push(posShift(child, pos));
		return { ...child, pos } as Element;
	});
	const idx = p.path.at(-1) as number;
	const parentPath = p.path.slice(0, -1);
	const ungrouped = updateList(t, p.side, parentPath, (list) => [
		...list.slice(0, idx),
		...lifted,
		...list.slice(idx + 1),
	]);
	const sideName = t.template_data[p.side]?.name ?? "";
	const next = editDeltas(
		shiftDeltaPositions(ungrouped, sideName, shifts),
		sideName,
		(d) => (d.id === el.id ? [] : [d]),
	);
	return ok(
		next,
		lifted.map((_, i) =>
			keyOf({ side: p.side, path: [...parentPath, idx + i] }),
		),
	);
}

/** Renames a layer, and the variant overrides on its side that name it. */
export function renameElement(
	t: Template,
	key: string,
	newId: string,
): OpResult {
	const p = parseKey(key);
	const el = p && getElement(t, p);
	if (!p || !el) return refuse("not_found", NOT_FOUND);
	const id = newId.trim();
	if (!id) return refuse("empty_id", "A layer name can't be empty");
	if (id === el.id) return ok(t, [key]);
	if (collectIds(t, p.side).has(id))
		return refuse("duplicate_id", `"${id}" is already used on this side`);
	const renamed = updateElement(t, key, (e) => ({ ...e, id })) as {
		template: Template;
	};
	const sideName = t.template_data[p.side].name;
	const next = produce(renamed.template, (d) => {
		for (const ov of overridesOf(d))
			if (ov.name === sideName)
				for (const e of ov.elements ?? []) if (e.id === el.id) e.id = id;
	});
	return ok(next, [key]);
}

// ── Sides ────────────────────────────────────────────────────────────────────

type Override = Variant["overrides"][number];

/** Every variant's overrides, as drafts. */
function overridesOf(d: Draft<Template>): Draft<Override>[] {
	return (d.variants ?? []).flatMap((v) => v.overrides);
}

/** Removes the overrides `drop` matches; a variant that loses none keeps its
 *  list. */
function dropOverrides(d: Draft<Template>, drop: (ov: Override) => boolean) {
	for (const v of d.variants ?? [])
		if (v.overrides.some(drop))
			v.overrides = v.overrides.filter((ov) => !drop(ov));
}

/** Renames a side (rewriting the overrides that name it) or replaces its
 *  background. */
export function setFrameProp(
	t: Template,
	side: number,
	patch: { name?: string; background?: Background },
): OpResult {
	const frame = t.template_data[side];
	if (!frame) return refuse("not_found", "That side no longer exists");
	let next = t;
	if (patch.name !== undefined && patch.name !== frame.name) {
		const name = patch.name.trim();
		if (!name) return refuse("empty_name", "A side needs a name");
		if (t.template_data.some((f, i) => i !== side && f.name === name))
			return refuse("duplicate_side", `A side called "${name}" already exists`);
		next = produce(
			updateSide(next, side, (f) => ({ ...f, name })),
			(d) => {
				for (const ov of overridesOf(d))
					if (ov.name === frame.name) ov.name = name;
			},
		);
	}
	if (patch.background)
		next = updateBackground(next, side, () => patch.background as Background);
	return ok(next, patch.background ? [keyOf({ side, background: true })] : []);
}

export function addSide(t: Template, name: string): OpResult {
	const clean = name.trim();
	if (!clean) return refuse("empty_name", "A side needs a name");
	if (t.template_data.some((f) => f.name === clean))
		return refuse("duplicate_side", `A side called "${clean}" already exists`);
	const frame: TemplateFrame = {
		name: clean,
		background: {
			id: "background",
			type: "rect",
			properties: { fill: "#ffffff" },
		},
		elements: [],
	};
	const side = t.template_data.length;
	return ok({ ...t, template_data: [...t.template_data, frame] }, [
		keyOf({ side, background: true }),
	]);
}

export function removeSide(t: Template, side: number): OpResult {
	const frame = t.template_data[side];
	if (!frame) return refuse("not_found", "That side no longer exists");
	if (t.template_data.length === 1)
		return refuse("last_side", "A template needs at least one side");
	const next = produce(t, (d) => {
		d.template_data.splice(side, 1);
		dropOverrides(d, (ov) => ov.name === frame.name);
	});
	return ok(next, []);
}

export function moveSide(t: Template, from: number, to: number): OpResult {
	const n = t.template_data.length;
	if (!t.template_data[from] || !Number.isInteger(to) || to < 0 || to >= n)
		return refuse("invalid_index", "No side there");
	if (from === to) return ok(t, []);
	const list = t.template_data.slice();
	const [frame] = list.splice(from, 1);
	list.splice(to, 0, frame);
	return ok({ ...t, template_data: list }, []);
}

// ── Template ─────────────────────────────────────────────────────────────────

export type TemplateMeta = Partial<
	Pick<
		Template,
		"name" | "id" | "description" | "version" | "product" | "author"
	>
>;

/** An empty optional string is removed, since the format rejects one. */
export function setTemplateMeta(t: Template, patch: TemplateMeta): OpResult {
	for (const k of ["name", "id"] as const) {
		if (k in patch && !patch[k]?.trim())
			return refuse("empty_name", `The template ${k} can't be empty`);
	}
	const clean: Record<string, unknown> = { ...patch };
	for (const k of ["description", "version", "product"] as const)
		if (k in clean && clean[k] === "") clean[k] = undefined;
	return ok(mergeDefined(t, clean), []);
}

/** Changes the size without scaling content; backgrounds with an explicit
 *  size follow. */
export function resizeTemplate(t: Template, w: number, h: number): OpResult {
	const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE;
	if (!valid(w) || !valid(h))
		return refuse(
			"invalid_size",
			`Width and height must be whole numbers from 1 to ${MAX_SIDE}`,
		);
	if (!safeAreaFits(t.safeArea, w, h))
		return refuse("safe_area_too_large", INSETS.safeAreaTooLarge);
	const follow = (bg: Draft<Background> | undefined) => {
		if (bg?.size && (bg.size.width !== w || bg.size.height !== h))
			bg.size = { width: w, height: h };
	};
	const next = produce(t, (d) => {
		d.width = w;
		d.height = h;
		for (const f of d.template_data) follow(f.background);
		for (const ov of overridesOf(d)) follow(ov.background);
	});
	return ok(next, []);
}

function safeAreaFits(
	safeArea: Insets | undefined,
	width: number,
	height: number,
): boolean {
	const s = resolveInsets(safeArea);
	return s.left + s.right < width && s.top + s.bottom < height;
}

/** Sets the template's bleed or safe area; all zero removes it. A template
 *  that gains one is stamped with the format version that reads it. */
export function setTemplateInsets(
	t: Template,
	key: "bleed" | "safeArea",
	value: Insets | undefined,
): OpResult {
	const sides = resolveInsets(value);
	if (!Object.values(sides).every((n) => Number.isFinite(n) && n >= 0))
		return refuse("invalid_inset", INSETS.negative);
	if (key === "safeArea" && !safeAreaFits(value, t.width, t.height))
		return refuse("safe_area_too_large", INSETS.safeAreaTooLarge);
	const next = hasInsets(sides) ? value : undefined;
	if (sameJson(t[key], next)) return ok(t, []);
	return ok(
		produce(t, (d) => {
			if (next === undefined) delete d[key];
			else {
				d[key] = next;
				if (olderMinor(d.format_version)) d.format_version = FORMAT_VERSION;
			}
		}),
		[],
	);
}

function olderMinor(formatVersion: string): boolean {
	if (formatVersionStatus(formatVersion) !== "current") return false;
	const minor = Number(/^\s*\d+\.(\d+)/.exec(formatVersion)?.[1] ?? 0);
	return minor < FORMAT_MINOR;
}

// ── Fields ───────────────────────────────────────────────────────────────────

export function addField(
	t: Template,
	key: string,
	def: FieldDefinition,
): OpResult {
	if (!FIELD_KEY.test(key)) return refuse("invalid_field_key", KEY_RULE);
	if (key in t.fields.properties)
		return refuse("duplicate_field", `A field called "${key}" already exists`);
	return ok(setFieldDefinition(t, key, def), []);
}

export function updateField(
	t: Template,
	key: string,
	def: FieldDefinition,
): OpResult {
	if (!(key in t.fields.properties))
		return refuse("unknown_field", `No field called "${key}"`);
	return ok(setFieldDefinition(t, key, def), []);
}

function setFieldDefinition(
	t: Template,
	key: string,
	def: FieldDefinition,
): Template {
	return produce(t, (d) => {
		d.fields.properties[key] = def;
	});
}

/** Renames a field and every reference to it: `{{tokens}}` in layers and
 *  variants, `visibleWhen` conditions, and `required`. */
export function renameField(
	t: Template,
	oldKey: string,
	newKey: string,
): OpResult {
	if (!(oldKey in t.fields.properties))
		return refuse("unknown_field", `No field called "${oldKey}"`);
	if (oldKey === newKey) return ok(t, []);
	if (!FIELD_KEY.test(newKey)) return refuse("invalid_field_key", KEY_RULE);
	if (newKey in t.fields.properties)
		return refuse(
			"duplicate_field",
			`A field called "${newKey}" already exists`,
		);
	const token = new RegExp(`\\{\\{(\\s*)${oldKey}(\\s*)\\}\\}`, "g");
	// Walks the draft, so only the objects holding a rewritten token or
	// condition are copied.
	const rewrite = (node: Record<string, unknown>) => {
		for (const [k, v] of Object.entries(node)) {
			if (typeof v === "string") {
				const next = v.replace(token, `{{$1${newKey}$2}}`);
				if (next !== v) node[k] = next;
			} else if (v && typeof v === "object") {
				rewrite(v as Record<string, unknown>);
				if (k === "visibleWhen") renameConditions(v, oldKey, newKey);
			}
		}
	};
	const next = produce(t, (d) => {
		const properties: Record<string, FieldDefinition> = {};
		for (const [k, v] of Object.entries(t.fields.properties))
			properties[k === oldKey ? newKey : k] = v;
		d.fields.properties = properties;
		t.fields.required?.forEach((r, i) => {
			if (r === oldKey && d.fields.required) d.fields.required[i] = newKey;
		});
		rewrite(d.template_data as unknown as Record<string, unknown>);
		if (d.variants) rewrite(d.variants as unknown as Record<string, unknown>);
	});
	return ok(next, []);
}

function renameConditions(value: unknown, from: string, to: string): void {
	for (const c of Array.isArray(value) ? value : [value]) {
		const cond = c as { field?: unknown } | null;
		if (cond && cond.field === from) cond.field = to;
	}
}

/** Removes a field; refused while any layer reads it, listing those layers. */
export function removeField(t: Template, key: string): OpResult {
	if (!(key in t.fields.properties))
		return refuse("unknown_field", `No field called "${key}"`);
	const references = fieldReferences(t, key);
	if (references.length > 0)
		return refuse(
			"field_in_use",
			`"${key}" is used by ${plural(references.length, "layer")}`,
			references,
		);
	const next = produce(t, (d) => {
		delete d.fields.properties[key];
		const required = t.fields.required;
		if (required?.includes(key))
			d.fields.required = required.filter((r) => r !== key);
	});
	return ok(next, []);
}

/** Layer keys that read a field through a token or `visibleWhen`, plus
 *  `variant:<id>` for variant overrides that do. */
export function fieldReferences(t: Template, field: string): string[] {
	const token = new RegExp(`\\{\\{\\s*${field}\\s*\\}\\}`);
	const mentions = (v: unknown): boolean => {
		if (typeof v === "string") return token.test(v);
		if (Array.isArray(v)) return v.some(mentions);
		if (v && typeof v === "object") return Object.values(v).some(mentions);
		return false;
	};
	const out: string[] = [];
	t.template_data.forEach((_, side) => {
		for (const { key, element } of walkLayers(t, side)) {
			const {
				children: _c,
				mask: _m,
				...own
			} = element.properties as Record<string, unknown>;
			const when = (element as Element).visibleWhen;
			const conds = when ? (Array.isArray(when) ? when : [when]) : [];
			if (mentions(own) || conds.some((c) => c.field === field)) out.push(key);
		}
	});
	for (const v of t.variants ?? [])
		if (v.overrides.some(mentions)) out.push(`variant:${v.id}`);
	return out;
}

// ── Fonts and assets ─────────────────────────────────────────────────────────

export function addFont(t: Template, descriptor: FontDescriptor): OpResult {
	if (t.fonts?.some((f) => f.family === descriptor.family))
		return refuse(
			"duplicate_font",
			`"${descriptor.family}" is already in the template`,
		);
	return ok({ ...t, fonts: [...(t.fonts ?? []), descriptor] }, []);
}

/** Removes a font; refused while a text layer uses the family. */
export function removeFont(t: Template, family: string): OpResult {
	if (!t.fonts?.some((f) => f.family === family))
		return refuse("unknown_font", `"${family}" isn't in the template`);
	const references = fontReferences(t, family);
	if (references.length > 0)
		return refuse(
			"font_in_use",
			`"${family}" is used by ${plural(references.length, "layer")}`,
			references,
		);
	const fonts = t.fonts.filter((f) => f.family !== family);
	if (fonts.length > 0) return ok({ ...t, fonts }, []);
	const { fonts: _dropped, ...rest } = t;
	return ok(rest as Template, []);
}

export function fontReferences(t: Template, family: string): string[] {
	const out: string[] = [];
	t.template_data.forEach((_, side) => {
		for (const { key, element } of walkLayers(t, side)) {
			if (element.type !== "text") continue;
			const p = element.properties;
			if (
				p.font.family === family ||
				p.spans?.some((s) => s.font?.family === family)
			)
				out.push(key);
		}
	});
	const inDelta = (d: VariantElementDelta) => {
		const font = d.properties.font as { family?: unknown } | undefined;
		const spans = d.properties.spans as
			| { font?: { family?: unknown } }[]
			| undefined;
		return (
			font?.family === family ||
			(Array.isArray(spans) && spans.some((s) => s.font?.family === family))
		);
	};
	for (const v of t.variants ?? [])
		if (v.overrides.some((ov) => ov.elements?.some(inDelta)))
			out.push(`variant:${v.id}`);
	return out;
}

/** Embeds an image, keyed by its sha256, and returns the `asset:` src. */
export async function attachImageAsset(
	t: Template,
	bytes: Uint8Array,
	contentType: string,
): Promise<{ ok: true; template: Template; src: string }> {
	const sha256 = await subtleSha256(bytes);
	const src = assetUri(sha256);
	if (t.assets?.some((a) => a.sha256 === sha256))
		return { ok: true, template: t, src };
	return {
		ok: true,
		template: {
			...t,
			assets: [
				...(t.assets ?? []),
				{ sha256, base64: bytesToBase64(bytes), contentType },
			],
		},
		src,
	};
}

/** Drops carried assets nothing references, local font files included. */
export function pruneUnusedAssets(t: Template): Template {
	if (!t.assets) return t;
	const used = collectAssetRefs(t);
	for (const f of t.fonts ?? [])
		if (f.kind === "local")
			for (const file of f.files) {
				const sha = parseAssetUri(file.src);
				if (sha) used.add(sha);
			}
	const assets = t.assets.filter((a) => used.has(a.sha256));
	if (assets.length === t.assets.length) return t;
	if (assets.length > 0) return { ...t, assets };
	const { assets: _dropped, ...rest } = t;
	return rest as Template;
}

// ── Variants ─────────────────────────────────────────────────────────────────

const VARIANT_ID = /^[a-z0-9-]+$/;
/** Export file names and bindings say `default` for Default. */
const RESERVED_VARIANT_ID = "default";

export type AddVariantResult =
	| (OpOk & { variantId: string })
	| (OpRefused & { variantId?: undefined });

function findVariant(t: Template, id: string): Variant | undefined {
	return t.variants?.find((v) => v.id === id);
}

function unknownVariant(): OpRefused {
	return refuse("unknown_variant", VARIANT_COPY.unknown);
}

/** Replaces one variant, keeping every other and the list's order. */
function withVariant(t: Template, id: string, next: Variant): Template {
	return {
		...t,
		variants: (t.variants ?? []).map((v) => (v.id === id ? next : v)),
	};
}

/** A variant id from a label: lowercase, `-` between words, `variant` when
 *  nothing is left, and `-2`, `-3` until no other variant has it. */
export function variantIdFor(t: Template, label: string): string {
	const slug =
		label
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "variant";
	const used = new Set((t.variants ?? []).map((v) => v.id));
	used.add(RESERVED_VARIANT_ID);
	if (!used.has(slug)) return slug;
	let n = 2;
	while (used.has(`${slug}-${n}`)) n++;
	return `${slug}-${n}`;
}

/**
 * The swatch a variant would suggest: the first side's background colour with
 * the variant applied (Default without an id), or its first gradient stop.
 * Undefined for an image background or a colour read from a field.
 */
export function suggestSwatch(t: Template, id?: string): string | undefined {
	const applied =
		id !== undefined && findVariant(t, id) ? applyVariant(t, id) : t;
	const bg = applied.template_data[0]?.background;
	if (bg?.type !== "rect") return undefined;
	const fills = bg.properties.fill;
	const fill = Array.isArray(fills) ? fills[0] : fills;
	const colour = typeof fill === "string" ? fill : fill?.stops[0]?.color;
	return colour && !colour.includes("{{") ? colour : undefined;
}

/** Appends a variant labelled `label`. With `from`, it starts as a copy of
 *  that variant's changes and swatch; without, it changes nothing and takes
 *  the suggested swatch. */
export function addVariant(
	t: Template,
	opts: { label: string; from?: string },
): AddVariantResult {
	const label = opts.label.trim();
	if (!label) return refuse("empty_label", VARIANT_COPY.emptyLabel);
	const source =
		opts.from === undefined ? undefined : findVariant(t, opts.from);
	if (opts.from !== undefined && !source) return unknownVariant();
	const id = variantIdFor(t, label);
	const swatch = source ? source.swatch : suggestSwatch(t);
	const variant: Variant = {
		id,
		label,
		...(swatch ? { swatch } : {}),
		overrides: source ? structuredClone(source.overrides) : [],
	};
	return {
		...ok({ ...t, variants: [...(t.variants ?? []), variant] }, []),
		variantId: id,
	};
}

/** Changes a variant's label; its id stays. */
export function renameVariant(
	t: Template,
	id: string,
	label: string,
): OpResult {
	const v = findVariant(t, id);
	if (!v) return unknownVariant();
	const clean = label.trim();
	if (!clean) return refuse("empty_label", VARIANT_COPY.emptyLabel);
	if (clean === v.label) return ok(t, []);
	return ok(withVariant(t, id, { ...v, label: clean }), []);
}

/** Sets a variant's swatch (a CSS colour), or clears it with none or "". */
export function setVariantSwatch(
	t: Template,
	id: string,
	swatch?: string,
): OpResult {
	const v = findVariant(t, id);
	if (!v) return unknownVariant();
	const clean = swatch?.trim() || undefined;
	if (clean === v.swatch) return ok(t, []);
	const { swatch: _old, ...rest } = v;
	return ok(withVariant(t, id, clean ? { ...rest, swatch: clean } : rest), []);
}

export function moveVariant(
	t: Template,
	id: string,
	toIndex: number,
): OpResult {
	const list = t.variants ?? [];
	const from = list.findIndex((v) => v.id === id);
	if (from < 0) return unknownVariant();
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= list.length)
		return refuse("invalid_index", VARIANT_COPY.noIndex);
	if (from === toIndex) return ok(t, []);
	const variants = list.slice();
	const [v] = variants.splice(from, 1);
	variants.splice(toIndex, 0, v as Variant);
	return ok({ ...t, variants }, []);
}

export function removeVariant(t: Template, id: string): OpResult {
	if (!findVariant(t, id)) return unknownVariant();
	const variants = (t.variants ?? []).filter((v) => v.id !== id);
	if (variants.length > 0) return ok({ ...t, variants }, []);
	const { variants: _dropped, ...rest } = t;
	return ok(rest as Template, []);
}

/** Changes a variant's id. Files, bindings and orders that saved the old one
 *  show Default afterwards, which is why the UI warns first. */
export function changeVariantId(
	t: Template,
	id: string,
	next: string,
): OpResult {
	const v = findVariant(t, id);
	if (!v) return unknownVariant();
	const clean = next.trim();
	if (!clean) return refuse("invalid_variant_id", VARIANT_COPY.emptyId);
	if (clean === id) return ok(t, []);
	if (!VARIANT_ID.test(clean))
		return refuse("invalid_variant_id", VARIANT_COPY.idRule);
	if (clean === RESERVED_VARIANT_ID)
		return refuse("invalid_variant_id", VARIANT_COPY.reservedId);
	if (findVariant(t, clean))
		return refuse("duplicate_variant_id", VARIANT_COPY.idTaken(clean));
	return ok(withVariant(t, id, { ...v, id: clean }), []);
}

/**
 * Gives back Default's values in a variant. With an element and `keys`, those
 * keys of its change (`properties` keys, shell fields or `hidden`); with an
 * element alone, its whole change. Without an element, `keys` of `["background"]`
 * drops the side's replaced background, and no keys the side's whole override.
 */
export function resetOverride(
	t: Template,
	id: string,
	side: string,
	elementId?: string,
	keys?: string[],
): OpResult {
	const v = findVariant(t, id);
	if (!v) return unknownVariant();
	const overrides = v.overrides.flatMap((ov): Override[] => {
		if (ov.name !== side) return [ov];
		if (elementId === undefined) {
			if (!keys) return [];
			if (!keys.includes("background") || !ov.background) return [ov];
			const { background: _bg, ...rest } = ov;
			return rest.elements?.length ? [rest] : [];
		}
		if (!ov.elements?.some((d) => d.id === elementId)) return [ov];
		const elements = ov.elements.flatMap((d): Delta[] => {
			if (d.id !== elementId) return [d];
			if (!keys) return [];
			const properties = { ...d.properties };
			const next: Record<string, unknown> = { ...d };
			for (const k of keys) {
				if ((DELTA_SHELL as readonly string[]).includes(k) || k === "hidden")
					delete next[k as DeltaShellKey | "hidden"];
				else delete properties[k];
			}
			const out = { ...next, properties } as Delta;
			return isEmptyDelta(out) ? [] : [out];
		});
		const { elements: _e, ...rest } = ov;
		if (elements.length) return [{ ...rest, elements }];
		return rest.background ? [rest] : [];
	});
	if (sameOverrides(overrides, v.overrides)) return ok(t, []);
	return ok(withVariant(t, id, { ...v, overrides }), []);
}

/** Hides a layer in one variant, or shows it again, adding or dropping the
 *  change that says so. */
export function setHiddenInVariant(
	t: Template,
	id: string,
	side: string,
	elementId: string,
	hidden: boolean,
): OpResult {
	const v = findVariant(t, id);
	if (!v) return unknownVariant();
	const index = t.template_data.findIndex((f) => f.name === side);
	if (index < 0) return refuse("not_found", VARIANT_COPY.noSide);
	if (!collectIds(t, index).has(elementId))
		return refuse("not_found", VARIANT_COPY.noLayer);
	let found = false;
	const overrides = v.overrides.flatMap((ov): Override[] => {
		if (ov.name !== side || !ov.elements) return [ov];
		const elements = ov.elements.flatMap((d): Delta[] => {
			if (d.id !== elementId) return [d];
			const { hidden: _h, ...rest } = d;
			const out: Delta = found || !hidden ? rest : { ...rest, hidden: true };
			found = true;
			return isEmptyDelta(out) ? [] : [out];
		});
		const { elements: _e, ...rest } = ov;
		if (elements.length) return [{ ...rest, elements }];
		return rest.background ? [rest] : [];
	});
	if (!found && hidden) {
		const delta: Delta = { id: elementId, properties: {}, hidden: true };
		const at = overrides.findIndex((ov) => ov.name === side);
		if (at >= 0) {
			const ov = overrides[at] as Override;
			overrides[at] = { ...ov, elements: [...(ov.elements ?? []), delta] };
		} else overrides.push({ name: side, elements: [delta] });
	}
	if (sameOverrides(overrides, v.overrides)) return ok(t, []);
	return ok(withVariant(t, id, { ...v, overrides }), []);
}

/** Drops every variant change whose layer is not on its side
 *  (`variant_orphan_override`), across every variant. */
export function removeUnusedChanges(t: Template): OpResult {
	let next = t;
	for (const issue of checkVariants(t)) {
		if (issue.code !== "variant_orphan_override") continue;
		const r = resetOverride(next, issue.variantId, issue.side, issue.elementId);
		if (!r.ok) return r;
		next = r.template;
	}
	return ok(next, []);
}

function isEmptyDelta(d: Delta): boolean {
	return (
		Object.keys(d.properties).length === 0 &&
		DELTA_SHELL.every((k) => d[k] === undefined) &&
		d.hidden === undefined
	);
}

function sameOverrides(a: Override[], b: Override[]): boolean {
	return sameJson(a, b);
}

// ── Keeping variants in step with the layers ─────────────────────────────────

type Delta = VariantElementDelta;

/**
 * Rewrites every variant's deltas on the side called `sideName`: each delta
 * becomes the list `fn` returns. An element list left empty is dropped, and so
 * is an override left with nothing in it. Untouched variants keep their
 * identity.
 */
function editDeltas(
	t: Template,
	sideName: string,
	fn: (d: Delta) => Delta[],
): Template {
	if (!t.variants?.length) return t;
	let changed = false;
	const variants = t.variants.map((v) => {
		let touched = false;
		const overrides = v.overrides.flatMap((ov) => {
			if (ov.name !== sideName || !ov.elements) return [ov];
			let same = true;
			const elements = ov.elements.flatMap((d) => {
				const out = fn(d);
				if (out.length !== 1 || out[0] !== d) same = false;
				return out;
			});
			if (same) return [ov];
			touched = true;
			const { elements: _drop, ...rest } = ov;
			if (elements.length > 0) return [{ ...rest, elements }];
			return rest.background ? [rest] : [];
		});
		if (!touched) return v;
		changed = true;
		return { ...v, overrides };
	});
	return changed ? { ...t, variants } : t;
}

/** How far a layer's own `pos` moved when it changed parent. */
type PosShift = { id: string; dx: number; dy: number };

function posShift(el: Element, pos: { x: number; y: number }): PosShift {
	return {
		id: el.id,
		dx: pos.x - (el.pos?.x ?? 0),
		dy: pos.y - (el.pos?.y ?? 0),
	};
}

/** Moves each variant's `pos` for a layer by what its base `pos` moved, so a
 *  layer that changes parent keeps where each variant put it. */
function shiftDeltaPositions(
	t: Template,
	sideName: string,
	shifts: PosShift[],
): Template {
	const byId = new Map(
		shifts.filter((s) => s.dx !== 0 || s.dy !== 0).map((s) => [s.id, s]),
	);
	if (byId.size === 0) return t;
	return editDeltas(t, sideName, (d) => {
		const s = byId.get(d.id);
		if (!s || !d.pos) return [d];
		return [
			{
				...d,
				pos: { x: round2(d.pos.x + s.dx), y: round2(d.pos.y + s.dy) },
			},
		];
	});
}

/** Ids on a side, plus those variant deltas on it name: a new layer must not
 *  pick up a change left behind by a removed one. */
function usedIds(t: Template, side: number): Set<string> {
	const used = collectIds(t, side);
	const name = t.template_data[side]?.name;
	for (const v of t.variants ?? [])
		for (const ov of v.overrides)
			if (ov.name === name) for (const d of ov.elements ?? []) used.add(d.id);
	return used;
}

function subtreeIds(el: Element, out: Set<string>): void {
	out.add(el.id);
	for (const [, c] of childEntries(el)) subtreeIds(c, out);
}

/** Maps each id in `from` to the id at the same place in `to`, its copy. */
function pairIds(from: Element, to: Element, out: Map<string, string>): void {
	out.set(from.id, to.id);
	const a = childEntries(from);
	const b = childEntries(to);
	a.forEach(([, c], i) => {
		const other = b[i]?.[1];
		if (other) pairIds(c, other, out);
	});
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clampIndex(index: number, length: number): number {
	if (!Number.isFinite(index)) return length;
	return Math.max(0, Math.min(length, Math.trunc(index)));
}
