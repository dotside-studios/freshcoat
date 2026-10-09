import { toast } from "@freshcoat-js/ui/toast";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatDate } from "~/app/format";
import { PRESETS } from "~/doc/new-document";
import { findSample } from "~/samples";
import { readAutosave, restoreNotices } from "./autosave";
import type { CommandContext } from "./commands";
import type { EditorController } from "./controller";
import { OPEN_HINT } from "./copy";
import { readHandoff } from "./handoff";
import type { AppRouter } from "./router";
import { hostOf, setSendBackTarget } from "./send-back";
import {
	type IntentTarget,
	parseSearch,
	planView,
	readHandoffIntent,
	readIntent,
	runIntent,
	sectionOfPath,
	urlOf,
	type ViewStep,
	viewOfUrl,
} from "./url-state";

// StrictMode mounts effects twice; the intent must still run once per page.
let intentTaken = false;

/** Keeps the URL and the editor in step: acts on an open intent once, and
 *  mirrors what is shown in the route. Off, it leaves the URL alone.
 *  Returns whether the welcome screen should point at "Open file…"
 *  (`#open=1`). */
export function useUrlState(
	controller: EditorController,
	ctx: CommandContext,
	enabled = true,
): { openHint: boolean } {
	const router = useRouter();
	const [openHint, setOpenHint] = useState(false);

	useEffect(() => {
		if (!enabled || intentTaken) return;
		intentTaken = true;
		const here = router.history.location;
		const { intent, search } = readIntent(here.search);
		const handoff = readHandoffIntent(here.hash);
		if (!intent && !handoff.intent) return;
		void router.navigate({
			href: `${here.pathname}${search}${handoff.hash}`,
			replace: true,
		});
		const askOpen = handoff.intent?.kind === "open";
		if (!intent) {
			if (askOpen) {
				if (controller.state.workspace) toastOpenHint(ctx);
				else setOpenHint(true);
			} else if (handoff.intent?.kind === "coat")
				void openHandoff(
					controller,
					handoff.intent.data,
					handoff.intent.returnTo,
				);
			return;
		}
		void (async () => {
			// Read before opening: once the opened document is edited, autosave
			// writes over what was there.
			const saved = await readAutosave();
			const opened = await runIntent(intent, intentTarget(controller), (id) =>
				Boolean(findSample(id)),
			);
			if (!opened) {
				const what = intent.kind === "new" ? intent.presetId : intent.id;
				toast(`Nothing called “${what}” to open`, { tone: "warning" });
				if (askOpen) setOpenHint(true);
				return;
			}
			if (askOpen) toastOpenHint(ctx);
			if (!saved) return;
			toast(`Unsaved work from ${formatDate(new Date(saved.savedAt))}`, {
				timeout: 0,
				action: {
					label: "Restore",
					onAction: () => ctx.confirmDiscard(() => controller.restore(saved)),
				},
			});
		})();
	}, [controller, ctx, router, enabled]);

	useEffect(() => {
		if (!enabled) return;
		const sync = new RouteSync(controller, router);
		return () => sync.dispose();
	}, [controller, router, enabled]);

	return { openHint };
}

/** The welcome screen's "Open file…" hint, for when a workspace is showing
 *  instead. Its action is File > Open, unsaved-work check included. */
function toastOpenHint(ctx: CommandContext): void {
	toast(OPEN_HINT, {
		timeout: 0,
		action: {
			label: "Open file…",
			onAction: () => ctx.confirmDiscard(ctx.pickFile),
		},
	});
}

/**
 * Opens a template handed over in a link. It joins the open workspace; with
 * none open, it joins the autosaved one, restored, so unsaved work is never
 * set aside for it; failing that, it starts a workspace of its own.
 */
async function openHandoff(
	controller: EditorController,
	data: string,
	returnTo?: string,
): Promise<void> {
	// Read before opening: once the opened document is edited, autosave
	// writes over what was there.
	const saved = controller.state.workspace ? null : await readAutosave();
	const result = await readHandoff(data);
	if (!result.ok) {
		const from = returnTo ? hostOf(returnTo) : "Figma";
		toast(`Couldn't open the template from ${from}: ${result.reason}`, {
			tone: "danger",
			timeout: 0,
		});
		return;
	}
	const restored = saved !== null && !controller.state.workspace;
	if (restored) controller.restore(saved, restoreNotices(saved));
	controller.open(result.template, result.fileName, result.notices);
	const templateId = controller.state.workspace?.activeTemplateId;
	if (returnTo && templateId)
		setSendBackTarget({ origin: returnTo, templateId });
	if (restored)
		toast(`Added ${result.template.name} to your unsaved workspace`, {
			tone: "success",
		});
}

function intentTarget(controller: EditorController): IntentTarget {
	const starters = controller as unknown as {
		openStarter?: (id: string) => Promise<unknown> | unknown;
		hasStarter?: (id: string) => boolean;
	};
	return {
		openSample: (id) => controller.openSample(id),
		...(typeof starters.openStarter === "function"
			? {
					openStarter: (id: string) =>
						starters.openStarter?.call(controller, id),
					...(typeof starters.hasStarter === "function"
						? {
								hasStarter: (id: string) =>
									Boolean(starters.hasStarter?.call(controller, id)),
							}
						: {}),
				}
			: {}),
		newDocument: async (presetId) => {
			const preset = PRESETS.find((p) => p.id === presetId);
			if (!preset) return false;
			await controller.newDocument(preset);
			return true;
		},
	};
}

/**
 * The route follows the store, one navigation per animation frame: a section
 * change pushes a history entry so Back returns to it, anything else replaces
 * the current one. The route is read back after Back, Forward or an edited
 * URL, and once each time a workspace opens.
 */
class RouteSync {
	private ready = false;
	private frame = 0;
	private popped = false;
	private offs: (() => void)[];

	constructor(
		private controller: EditorController,
		private router: AppRouter,
	) {
		this.offs = [
			controller.store.subscribe(() => this.changed()),
			controller.onWorkspaceOpened(() => this.apply()),
			// Only a move through history is the user's; a push or replace is
			// this class writing, or a redirect on the way to one of the others.
			router.history.subscribe(({ action }) => {
				if (action.type !== "PUSH" && action.type !== "REPLACE")
					this.popped = true;
			}),
			router.subscribe("onResolved", () => {
				if (!this.popped) return;
				if (!sectionOfPath(router.history.location.pathname)) return;
				this.popped = false;
				if (this.ready) this.apply();
			}),
		];
		if (controller.state.workspace) this.apply();
	}

	dispose(): void {
		for (const off of this.offs) off();
		cancelAnimationFrame(this.frame);
	}

	private changed(): void {
		if (!this.controller.state.workspace) {
			// Back on the welcome screen: nothing is shown, so nothing to address.
			if (this.ready) {
				this.ready = false;
				this.write("replace");
			}
			return;
		}
		if (!this.ready || this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.write("auto");
		});
	}

	/** Brings the editor to the route, then rewrites the route to what it
	 *  shows, which drops any id the workspace did not have. */
	private apply(): void {
		const c = this.controller;
		const state = c.state;
		const ws = state.workspace;
		if (!ws) return;
		const here = this.router.history.location;
		const view = viewOfUrl(here.pathname, parseSearch(here.search));
		const steps = planView(state, view, (id) => {
			if (id === ws.activeTemplateId) return c.template ?? undefined;
			const slot = ws.templates.find((s) => s.id === id);
			return slot?.parked?.doc.history.present ?? slot?.template;
		});
		for (const step of steps) this.run(step);
		this.ready = true;
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.write("replace");
	}

	private run(step: ViewStep): void {
		const c = this.controller;
		const s = c.state;
		switch (step.type) {
			case "template":
				c.switchTemplate(step.id);
				return;
			case "side":
				c.dispatch({ type: "setSide", side: step.index });
				return;
			case "dataset":
				if (s.workspace?.activeDatasetId !== step.id)
					c.dispatch({ type: "setActiveDataset", id: step.id });
				return;
			case "preset":
				if (s.workspace?.activePresetId !== step.id)
					c.dispatch({ type: "setActivePreset", id: step.id });
				return;
			case "section":
				c.dispatch({ type: "setSection", section: step.section });
				return;
			case "previewRecord":
				// Clearing resets the preview to sample values; skip it when
				// nothing is previewed, or values typed by hand would be lost.
				if (s.previewRecordId !== step.id) c.previewRecord(step.id);
				return;
			case "exportRecord":
				c.dispatch({ type: "setRecord", id: step.id });
				return;
		}
	}

	private write(mode: "auto" | "replace"): void {
		const state = this.controller.state;
		const here = this.router.history.location;
		const href = urlOf(state, parseSearch(here.search));
		if (href === `${here.pathname}${here.search}`) return;
		const push =
			mode === "auto" &&
			state.workspace !== null &&
			state.section !== (sectionOfPath(here.pathname) ?? "edit");
		void this.router.navigate({ href, replace: !push });
	}
}
