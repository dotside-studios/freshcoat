/**
 * Counts component renders through React's devtools hook, which react-dom
 * reads when it loads, so this runs from `setupFiles`. A fiber that keeps its
 * object from the previous commit was not visited; one that was visited
 * rendered only if React flagged it with PerformedWork.
 */

type Fiber = {
	tag: number;
	type: unknown;
	flags: number;
	child: Fiber | null;
	sibling: Fiber | null;
};
type Root = { current: Fiber };

const PERFORMED_WORK = 1;
// Function, class, forward ref and simple memo components.
const COMPONENT_TAGS = new Set([0, 1, 11, 15]);

let tracking = false;
let counts: Map<string, number> | null = null;
const lastSeen = new WeakMap<Root, WeakSet<Fiber>>();

// The bundler suffixes a function named like the memo const it sits in.
function nameOf(type: unknown): string | undefined {
	const t = type as {
		displayName?: string;
		name?: string;
		render?: { name?: string };
	};
	const name =
		typeof type === "function"
			? t.displayName || t.name
			: t?.displayName || t?.render?.name;
	return name?.replace(/(?<=[a-z])\d+$/, "");
}

function walk(root: Root) {
	if (!tracking) return;
	const prev = lastSeen.get(root);
	const seen = new WeakSet<Fiber>();
	const stack: Fiber[] = [root.current];
	while (stack.length) {
		const f = stack.pop() as Fiber;
		seen.add(f);
		if (
			counts &&
			COMPONENT_TAGS.has(f.tag) &&
			!prev?.has(f) &&
			f.flags & PERFORMED_WORK
		) {
			const name = nameOf(f.type);
			if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		if (f.sibling) stack.push(f.sibling);
		if (f.child) stack.push(f.child);
	}
	lastSeen.set(root, seen);
}

const g = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
g.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= {
	supportsFiber: true,
	renderers: new Map(),
	inject: () => 1,
	checkDCE() {},
	onScheduleFiberRoot() {},
	onCommitFiberRoot: (_id: number, root: Root) => walk(root),
	onCommitFiberUnmount() {},
	onPostCommitFiberRoot() {},
};

/** Follows commits from now on; call before the first render. */
export function trackRenders(on = true) {
	tracking = on;
}

/** Renders per component name while `fn` runs. */
export function countRenders(fn: () => void): Map<string, number> {
	const out = new Map<string, number>();
	counts = out;
	try {
		fn();
	} finally {
		counts = null;
	}
	return out;
}
