import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	lazyRouteComponent,
	Navigate,
	Outlet,
	type RouterHistory,
	redirect,
	useRouteContext,
} from "@tanstack/react-router";
import type { EditorController } from "./controller";
import { Editor } from "./Editor";
import {
	legacyTarget,
	parseSearch,
	readHandoffIntent,
	type SearchRecord,
	stringifySearch,
	validateBenchSearch,
	validateEditorSearch,
} from "./url-state";

export type RouterContext = { controller: EditorController };

// Older links (`?kit`, `?bench`, `#section=…`) and `/` are redirected before
// anything renders, replacing the entry so Back does not return to them.
const rootRoute = createRootRouteWithContext<RouterContext>()({
	beforeLoad: ({ location }) => {
		const target = legacyTarget(
			location.pathname,
			location.search as SearchRecord,
			location.hash,
		);
		if (!target) return;
		// A hand-off from Figma rides in the fragment, which has to survive
		// the redirect from `/` to reach the editor.
		const hash = location.hash.replace(/^#/, "");
		const keep = hash && readHandoffIntent(hash).intent ? `#${hash}` : "";
		throw redirect({ href: `${hrefOf(target)}${keep}`, replace: true });
	},
	component: Outlet,
	notFoundComponent: () => <Navigate to="/edit" replace />,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
});

// One layout for the three sections, so moving between them keeps the editor
// mounted: the sections are store state, and their routes render nothing.
const editorRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "editor",
	validateSearch: validateEditorSearch,
	component: EditorLayout,
});

function EditorLayout() {
	const { controller } = useRouteContext({ from: "/editor" });
	return (
		<>
			<Editor controller={controller} />
			<Outlet />
		</>
	);
}

const sectionRoutes = (["edit", "data", "export"] as const).map((section) =>
	createRoute({ getParentRoute: () => editorRoute, path: section }),
);

const kitRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "kit",
	component: lazyRouteComponent(
		() => import("@freshcoat-js/ui/gallery"),
		"KitGallery",
	),
});

const benchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "bench",
	validateSearch: validateBenchSearch,
	component: lazyRouteComponent(() => import("./Bench"), "BenchPage"),
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	editorRoute.addChildren(sectionRoutes),
	kitRoute,
	benchRoute,
]);

function hrefOf(target: { to: string; search: SearchRecord }): string {
	return `${target.to}${stringifySearch(target.search)}`;
}

export function createAppRouter(opts: {
	controller: EditorController;
	history?: RouterHistory;
}) {
	return createRouter({
		routeTree,
		context: { controller: opts.controller },
		...(opts.history ? { history: opts.history } : {}),
		// Plain `key=value` pairs, as the phase 3 links wrote them; the default
		// JSON encoding would quote an id that reads as a number.
		parseSearch,
		stringifySearch,
	});
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
	interface Register {
		router: AppRouter;
	}
}
