// @vitest-environment node
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { sampleValues } from "~/doc/values";
import { type LiveRequest, renderLiveFrame } from "~/render/live-frame";
import {
	createWorkerBackend,
	type PreviewWorkerLike,
	previewWorkerEnabled,
	previewWorkerSupported,
	StalePreviewError,
} from "~/render/preview-client";
import type { PreviewReply, PreviewRequest } from "~/render/preview-protocol";
import {
	createPreviewReceiver,
	createPreviewSender,
} from "~/render/preview-sync";
import { createRenderSession } from "~/render/session";
import { SAMPLES } from "~/samples";
import { VEND_SANS } from "~/samples/vend-sans";
import { doc, PNG_BYTES, PNG_SHA } from "./doc-fixture";

function request(over: Partial<LiveRequest> = {}): LiveRequest {
	const template = over.template ?? doc();
	return {
		template,
		side: 0,
		hidden: new Set(),
		values: sampleValues(template),
		fonts: new Map([["Inter", [new Uint8Array([1, 2, 3])]]]),
		photos: new Map(),
		density: 1,
		...over,
	};
}

describe("preview sync", () => {
	test("sends the template on a new identity, and assets, fonts and photos once", () => {
		const sender = createPreviewSender();
		const receiver = createPreviewReceiver();
		const first = request({
			photos: new Map([["ws:a", new Uint8Array([9])]]),
		});
		const u1 = structuredClone(sender.encode(first));
		expect(u1.template?.assets).toBeUndefined();
		expect(u1.newAssets?.map((a) => a.sha256)).toEqual([PNG_SHA]);
		expect(u1.blobs?.length).toBe(2);
		const r1 = receiver.apply(u1);
		expect(r1.template).toEqual(first.template);
		expect(r1.fonts).toEqual(first.fonts);
		expect(r1.photos).toEqual(first.photos);
		expect(r1.values).toEqual(first.values);

		// A drag: a new template, its assets array and everything else the same.
		const moved = {
			...first.template,
			name: "Moved",
			assets: first.template.assets,
		};
		const u2 = structuredClone(sender.encode({ ...first, template: moved }));
		expect(u2.template?.name).toBe("Moved");
		expect(u2).not.toHaveProperty("assets");
		expect(u2).not.toHaveProperty("newAssets");
		expect(u2).not.toHaveProperty("fonts");
		expect(u2).not.toHaveProperty("blobs");
		expect(u2).not.toHaveProperty("values");
		const r2 = receiver.apply(u2);
		expect(r2.template).toEqual(moved);
		expect(r2.template.assets).toBe(r1.template.assets);
		expect(r2.fonts).toBe(r1.fonts);
		expect(r2.photos).toBe(r1.photos);

		// Nothing changed: nothing but the side and density goes over.
		const same = { ...first, template: moved };
		expect(sender.encode(same)).toEqual({ side: 0, density: 1 });
	});

	test("a font added later sends only its bytes, and dropped bytes are let go", () => {
		const sender = createPreviewSender();
		const receiver = createPreviewReceiver();
		const inter = new Uint8Array([1]);
		const base = request({ fonts: new Map([["Inter", [inter]]]) });
		receiver.apply(structuredClone(sender.encode(base)));
		const roboto = new Uint8Array([2]);
		const more = {
			...base,
			fonts: new Map([
				["Inter", [inter]],
				["Roboto", [roboto]],
			]),
		};
		const u = structuredClone(sender.encode(more));
		expect(u.blobs).toEqual([[expect.any(Number), roboto]]);
		expect([...receiver.apply(u).fonts.keys()]).toEqual(["Inter", "Roboto"]);

		const fewer = { ...more, fonts: new Map([["Roboto", [roboto]]]) };
		expect(sender.encode(fewer)).not.toHaveProperty("blobs");
		const back = { ...fewer, fonts: new Map([["Inter", [inter]]]) };
		const resent = structuredClone(sender.encode(back));
		expect(resent.blobs).toEqual([[expect.any(Number), inter]]);
	});

	test("assets the template drops are sent again when they come back", () => {
		const sender = createPreviewSender();
		const receiver = createPreviewReceiver();
		const withAsset = request();
		receiver.apply(structuredClone(sender.encode(withAsset)));
		const { assets: _a, ...bare } = withAsset.template;
		receiver.apply(
			structuredClone(sender.encode({ ...withAsset, template: bare })),
		);
		const again = structuredClone(
			sender.encode({ ...withAsset, template: { ...withAsset.template } }),
		);
		expect(again.newAssets?.map((a) => a.sha256)).toEqual([PNG_SHA]);
		expect(receiver.apply(again).template.assets?.[0]?.sha256).toBe(PNG_SHA);
	});
});

type Sent = { message: PreviewRequest; transfer?: Transferable[] };

function fakeWorker() {
	const sent: Sent[] = [];
	let terminated = false;
	const worker: PreviewWorkerLike = {
		postMessage: (message, transfer) => sent.push({ message, transfer }),
		terminate: () => {
			terminated = true;
		},
		onmessage: null,
		onerror: null,
	};
	const reply = (data: PreviewReply) =>
		worker.onmessage?.({ data } as MessageEvent<PreviewReply>);
	return { worker, sent, reply, terminated: () => terminated };
}

function fakeCanvas(transfer: () => unknown = () => ({})) {
	return {
		transferControlToOffscreen: transfer,
	} as unknown as HTMLCanvasElement;
}

const RESULT = {
	geometry: new Map(),
	warnings: [],
	barcodes: [],
	timings: { compile: 1, layout: 1, lower: 1, paint: 1, total: 4 },
	scale: 1,
	stats: {
		paints: 1,
		surfaceCreates: 1,
		fontProviderBuilds: 1,
		imageDecodes: 0,
		paragraphBuilds: 0,
		lutImageBuilds: 0,
		mipmapBuilds: 0,
		pathBuilds: 0,
		backgroundSnapshots: 0,
		backgroundReuses: 0,
		finishNoiseBuilds: 0,
	},
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("preview worker client", () => {
	test("transfers the canvas, waits for the worker, and answers the latest render", async () => {
		const fake = fakeWorker();
		const canvas = fakeCanvas();
		const backend = createWorkerBackend({
			onLost() {},
			onFail() {},
			factory: () => fake.worker,
			createCanvas: () => canvas,
		});
		expect(fake.sent[0]?.message.type).toBe("init");
		expect(fake.sent[0]?.transfer?.length).toBe(1);

		const first = backend.render(request(), { snapshot: false });
		await tick();
		expect(fake.sent).toHaveLength(1);
		fake.reply({ type: "ready", ok: true });
		await tick();
		const r1 = fake.sent[1]?.message;
		expect(r1?.type).toBe("render");

		// A newer render replaces the first; the first's late reply is dropped.
		const second = backend.render(request(), { snapshot: false });
		await expect(first).rejects.toBeInstanceOf(StalePreviewError);
		await tick();
		const r2 = fake.sent[2]?.message as Extract<
			PreviewRequest,
			{ type: "render" }
		>;
		fake.reply({
			type: "render",
			id: (r1 as { id: number }).id,
			ok: true,
			...RESULT,
		});
		fake.reply({ type: "render", id: r2.id, ok: true, ...RESULT, scale: 2 });
		const frame = await second;
		expect(frame.scale).toBe(2);
		expect(frame.canvas).toBe(canvas);
		expect(backend.cacheStats()?.surfaceCreates).toBe(1);
		backend.dispose();
		expect(fake.terminated()).toBe(true);
	});

	test("hands back to the main thread when the worker cannot paint", async () => {
		const fake = fakeWorker();
		const failures: Error[] = [];
		const backend = createWorkerBackend({
			onLost() {},
			onFail: (e) => failures.push(e),
			factory: () => fake.worker,
			createCanvas: () => fakeCanvas(),
		});
		const pending = backend.render(request(), { snapshot: false });
		fake.reply({ type: "ready", ok: false, error: "no WebGL" });
		await expect(pending).rejects.toThrow("no WebGL");
		expect(failures.map((e) => e.message)).toEqual(["no WebGL"]);
		expect(fake.terminated()).toBe(true);
	});

	test("a canvas that cannot be transferred fails over too", async () => {
		const fake = fakeWorker();
		const failures: Error[] = [];
		createWorkerBackend({
			onLost() {},
			onFail: (e) => failures.push(e),
			factory: () => fake.worker,
			createCanvas: () =>
				fakeCanvas(() => {
					throw new Error("already transferred");
				}),
		});
		await tick();
		expect(failures.map((e) => e.message)).toEqual(["already transferred"]);
	});

	test("a crashed worker fails the render in flight and fails over", async () => {
		const fake = fakeWorker();
		const failures: Error[] = [];
		const backend = createWorkerBackend({
			onLost() {},
			onFail: (e) => failures.push(e),
			factory: () => fake.worker,
			createCanvas: () => fakeCanvas(),
		});
		fake.reply({ type: "ready", ok: true });
		const pending = backend.render(request(), { snapshot: false });
		await tick();
		fake.worker.onerror?.({ message: "out of memory" } as ErrorEvent);
		await expect(pending).rejects.toThrow("out of memory");
		expect(failures).toHaveLength(1);
	});

	test("a lost context asks for the frame again", () => {
		const fake = fakeWorker();
		let lost = 0;
		createWorkerBackend({
			onLost: () => lost++,
			onFail() {},
			factory: () => fake.worker,
			createCanvas: () => fakeCanvas(),
		});
		fake.reply({ type: "lost" });
		expect(lost).toBe(1);
	});

	test("without OffscreenCanvas the main thread paints", () => {
		expect(previewWorkerSupported()).toBe(false);
		expect(previewWorkerEnabled()).toBe(false);
	});

	test("the worker paints only when opted into", () => {
		class Canvas {
			transferControlToOffscreen() {}
		}
		const win: { __freshcoatPreviewWorker?: boolean } = {};
		vi.stubGlobal("window", win);
		vi.stubGlobal("Worker", class {});
		vi.stubGlobal("OffscreenCanvas", class {});
		vi.stubGlobal("createImageBitmap", () => {});
		vi.stubGlobal("HTMLCanvasElement", Canvas);
		try {
			expect(previewWorkerSupported()).toBe(true);
			expect(previewWorkerEnabled()).toBe(false);
			win.__freshcoatPreviewWorker = true;
			expect(previewWorkerEnabled()).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("main-thread fallback", () => {
	let ck: Awaited<ReturnType<typeof loadCanvasKit>>;
	let fonts: Map<string, Uint8Array[]>;

	beforeAll(async () => {
		ck = await loadCanvasKit();
		const src = VEND_SANS.kind === "local" ? VEND_SANS.files[0].src : "";
		fonts = new Map([
			[
				"Vend Sans",
				[
					new Uint8Array(
						Buffer.from(src.slice(src.indexOf(",") + 1), "base64"),
					),
				],
			],
		]);
	});

	test("paints a sample and reads its layer boxes and warnings", async () => {
		const sample = SAMPLES[0];
		if (!sample) throw new Error("no samples");
		const template = await sample.load();
		// No WebGL in node: the surface falls back to an offscreen raster.
		const session = createRenderSession(
			ck,
			(width, height) => ({ width, height }) as OffscreenCanvas,
		);
		const live = request({
			template,
			values: sampleValues(template),
			fonts,
			photos: new Map([["ws:x", PNG_BYTES]]),
			density: 0.5,
		});
		const out = await renderLiveFrame(session, live);
		expect(out.scale).toBe(0.5);
		expect(out.geometry.get("0/bg")).toBeDefined();
		expect(out.geometry.size).toBeGreaterThan(3);
		expect(Array.isArray(out.warnings)).toBe(true);
		expect(session.stats()?.surfaceCreates).toBe(1);

		// The worker's rebuilt request lays out the same boxes.
		const receiver = createPreviewReceiver();
		const rebuilt = receiver.apply(
			structuredClone(createPreviewSender().encode(live)),
		);
		session.reset();
		const again = await renderLiveFrame(session, rebuilt);
		expect(again.geometry).toEqual(out.geometry);
		expect(again.warnings).toEqual(out.warnings);
		session.dispose();
	});
});
