// prepareScene is the step compileScene runs before lowering — auto line heights
// then layout resolution — and it is NOT idempotent: resolveLayout folds a static
// container's own pos into its children, so a second pass folds it in twice and
// every layer inside that container slides off its box. A caller that needs the
// absolute tree before compiling therefore prepares once and compiles with
// `prepared: true`; these tests pin both halves of that contract.
import { describe, expect, test } from "vitest";
import {
	approxEngine,
	compileScene,
	createGroup,
	createRect,
	type Node,
	prepareScene,
} from "../src/index";

const measure = approxEngine.measureText;

// A static (layout-less) group holding one child, both positioned.
const scene = (): Node =>
	createGroup(
		[
			createRect({
				pos: { x: 10, y: 10 },
				size: { width: 20, height: 20 },
				fills: [{ kind: "solid", color: "#000000" }],
			}),
		],
		{ pos: { x: 100, y: 50 }, size: { width: 200, height: 200 } },
	);

const childPos = (n: Node) => {
	if (n.kind !== "group") throw new Error("expected a group");
	return n.children[0].pos;
};

describe("prepareScene", () => {
	test("folds a static container's pos into its children once", () => {
		expect(childPos(prepareScene(scene(), { measure }))).toEqual({
			x: 110,
			y: 60,
		});
	});

	test("preparing twice double-folds — which is why `prepared` exists", () => {
		const once = prepareScene(scene(), { measure });
		expect(childPos(prepareScene(once, { measure }))).toEqual({
			x: 210,
			y: 110,
		});
	});
});

describe("compileScene prepared", () => {
	test("a prepared tree lowers to the same commands as an authored one", () => {
		const authored = compileScene(scene(), {
			width: 300,
			height: 300,
			measure,
		});
		const prepared = compileScene(prepareScene(scene(), { measure }), {
			width: 300,
			height: 300,
			measure,
			prepared: true,
		});
		expect(prepared).toEqual(authored);
	});

	test("without the flag, a prepared tree is resolved a second time", () => {
		const authored = compileScene(scene(), {
			width: 300,
			height: 300,
			measure,
		});
		const twice = compileScene(prepareScene(scene(), { measure }), {
			width: 300,
			height: 300,
			measure,
		});
		expect(twice).not.toEqual(authored);
	});
});
