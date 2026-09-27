import { base64ToBytes } from "@freshcoat-js/coatfile/assets";
import { collectRasterTargets } from "~/main/raster-targets";
import type {
	FieldOverviewItem,
	MainToUi,
	PluginSettings,
	SelectionDetail,
	UiToMain,
} from "~/shared/protocol";
import { DEFAULT_SETTINGS } from "~/shared/protocol";
import {
	type HarnessState,
	MEMBER_CARD,
	RASTERS,
	STATES,
	THUMB_FOR,
} from "./fixtures";
import {
	EMPTY_PNG,
	RASTER_PNG,
	THUMB_AURORA,
	THUMB_EMBER,
	THUMB_MOSS,
} from "./pngs";

// A stand-in for the plugin's main thread. The UI runs in an iframe exactly as
// it does in Figma and talks to `parent`, which is this page: it answers each
// request the way `src/main/index.ts` does, from the fixtures of one state.

const params = new URLSearchParams(location.search);
const stateName = params.get("state") ?? "layer-empty";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const width = Number(params.get("w") ?? DEFAULT_SETTINGS.windowWidth);
const height = Number(params.get("h") ?? DEFAULT_SETTINGS.windowHeight);
const state: HarnessState | undefined = STATES[stateName];

const bytes = (b64: string): number[] => [...base64ToBytes(b64)];
const THUMBS = {
	aurora: bytes(THUMB_AURORA),
	ember: bytes(THUMB_EMBER),
	moss: bytes(THUMB_MOSS),
};

type Harness = {
	/** Every message the UI sent, in order. */
	log: UiToMain[];
	send: (msg: MainToUi) => void;
	settings: PluginSettings;
	state: string;
};

declare global {
	interface Window {
		harness: Harness;
	}
}

document.documentElement.classList.add(`figma-${theme}`);
document.body.classList.add(`figma-${theme}`);

const frame = document.createElement("iframe");
frame.title = "Plugin";
frame.src = `/ui.html?theme=${theme}`;
frame.style.cssText = `width:${width}px;height:${height}px;border:0;display:block;`;
document.body.appendChild(frame);

const log: UiToMain[] = [];
let settings: PluginSettings = { ...DEFAULT_SETTINGS, ...state?.settings };
let selection: SelectionDetail | null = state?.selection ?? null;
let fields: FieldOverviewItem[] = state?.fields ?? [];

function send(msg: MainToUi): void {
	frame.contentWindow?.postMessage({ pluginMessage: msg }, "*");
}

window.harness = { log, send, settings, state: stateName };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function read(
	msg: Extract<UiToMain, { type: "request-read" }>,
): Promise<void> {
	if (!state) return;
	const scene = state.scene ?? MEMBER_CARD;
	const targets = collectRasterTargets(scene);
	send({ type: "read-progress", text: "Reading frames…" });
	await delay(50);
	for (let i = 1; i <= targets.length; i++) {
		send({
			type: "read-progress",
			text: `Rasterizing layer ${i} of ${targets.length}…`,
		});
		await delay(50);
	}
	if (state.read === "hang") {
		send({
			type: "read-progress",
			text: `Rasterizing layer 1 of ${targets.length + 2}…`,
		});
		return;
	}
	if (state.read === "fail") {
		send({
			type: "read-failed",
			message: `The frame for "Member card" is no longer on the canvas. Pick it again.`,
		});
		return;
	}
	const slots = Object.entries(msg.sideAssignment).map(([slot, nodeId]) => {
		// A product export gets frames a little off its print size, which is
		// the mistake the size check exists for.
		const off = state.read === "wrong-size" ? 12 : 0;
		const tree = {
			...scene,
			id: nodeId,
			name: slot,
			absoluteBoundingBox: {
				x: 0,
				y: 0,
				width: scene.absoluteBoundingBox.width + off,
				height: scene.absoluteBoundingBox.height,
			},
		};
		return {
			slot,
			nodeId,
			nodeName: slot,
			width: tree.absoluteBoundingBox.width,
			height: tree.absoluteBoundingBox.height,
			tree,
		};
	});
	const rasters = targets
		.filter((id) => id !== "10:7")
		.map((nodeId) => ({
			nodeId,
			bytes: bytes(RASTERS[nodeId] === "empty" ? EMPTY_PNG : RASTER_PNG),
		}));
	send({
		type: "read-document",
		product: msg.product,
		mode: msg.mode,
		slots,
		colorways: [],
		rasters,
	});
}

function handle(msg: UiToMain): void {
	log.push(msg);
	switch (msg.type) {
		case "request-settings":
			send({ type: "settings", settings });
			break;
		case "save-settings":
			settings = { ...settings, ...msg.settings };
			window.harness.settings = settings;
			break;
		case "request-fields":
			send({ type: "fields-overview", fields });
			break;
		case "request-thumbnails":
			send({
				type: "thumbnails",
				items: msg.nodeIds
					.filter((id) => THUMB_FOR[id])
					.map((nodeId) => ({ nodeId, bytes: THUMBS[THUMB_FOR[nodeId]] })),
			});
			break;
		case "set-binding":
			if (selection && selection.nodeId === msg.nodeId) {
				selection = {
					...selection,
					name: msg.setName ?? selection.name,
					bind: msg.bind,
					fields: msg.fields.map((m) => ({
						id: m.id,
						format: m.format,
						meta: m,
					})),
				};
			}
			send({ type: "selection-detail", detail: selection });
			send({ type: "fields-overview", fields });
			break;
		case "clear-binding":
			if (selection && selection.nodeId === msg.nodeId) {
				selection = { ...selection, bind: {}, fields: [] };
			}
			send({ type: "selection-detail", detail: selection });
			send({ type: "fields-overview", fields });
			break;
		case "harvest":
			fields = state?.harvested ?? state?.fields ?? [];
			send({ type: "selection-detail", detail: selection });
			send({ type: "fields-overview", fields });
			break;
		case "request-read":
			void read(msg);
			break;
		case "resize-window":
			frame.style.width = `${msg.width}px`;
			frame.style.height = `${msg.height}px`;
			break;
		default:
			// focus-node, resize-node, open-external, products-loaded: recorded in
			// the log for tests to assert on, nothing to answer.
			break;
	}
}

window.addEventListener("message", (e) => {
	if (e.source !== frame.contentWindow) return;
	const msg = (e.data as { pluginMessage?: UiToMain })?.pluginMessage;
	if (msg) handle(msg);
});

// Main's own startup sequence: settings, the page's frames, the selection and
// the fields, pushed unprompted once the panel exists.
frame.addEventListener("load", () => {
	if (!state) {
		document.body.insertAdjacentText("beforeend", `Unknown state ${stateName}`);
		return;
	}
	send({ type: "settings", settings });
	send({ type: "cards", ...state.cards });
	send({ type: "selection-detail", detail: selection });
	send({ type: "fields-overview", fields });
	document.documentElement.dataset.ready = "true";
});
