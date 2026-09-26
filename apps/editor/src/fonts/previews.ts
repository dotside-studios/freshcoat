import { useEffect, useState } from "react";
import { previewCssUrl } from "./catalogue";

/** A face to register: the name it goes by in CSS, and one source. */
export type PreviewFace = { src: string; unicodeRange?: string };

export type PreviewLoaderOptions = {
	/** requests allowed at once */
	limit?: number;
	/** fetches a preview stylesheet's text */
	fetchCss?: (url: string) => Promise<string>;
	/** registers the faces under `name`; rejects when none loads */
	loadFaces?: (name: string, faces: PreviewFace[]) => Promise<void>;
};

export type PreviewRequest = {
	/** the CSS family to show the row in, or null to use the UI font */
	result: Promise<string | null>;
	/** drops a request that has not started yet */
	cancel: () => void;
};

/** The faces a css2 stylesheet lists, with their unicode ranges. */
export function parsePreviewCss(css: string): PreviewFace[] {
	const out: PreviewFace[] = [];
	for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
		const src = /src:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(block)?.[1];
		if (!src) continue;
		const range = /unicode-range:\s*([^;}]+)/.exec(block)?.[1]?.trim();
		out.push(range ? { src, unicodeRange: range } : { src });
	}
	return out;
}

/**
 * The name a family's preview is registered under: apart from any face the UI
 * itself uses (a preview holds only the glyphs of the family's name), and one
 * CSS identifier, since FontFace parses its family and "Source Sans 3" is not.
 */
export function previewName(family: string): string {
	return `fc-preview-${family.replace(/[^A-Za-z0-9]+/g, "-")}`;
}

async function defaultFetchCss(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status}`);
	return res.text();
}

async function defaultLoadFaces(
	name: string,
	faces: PreviewFace[],
): Promise<void> {
	if (typeof FontFace === "undefined" || typeof document === "undefined")
		throw new Error("no FontFace");
	const loaded = await Promise.allSettled(
		faces.map(async (face) => {
			const font = new FontFace(name, `url("${face.src}")`, {
				unicodeRange: face.unicodeRange ?? "U+0-10FFFF",
			});
			await font.load();
			document.fonts.add(font);
		}),
	);
	if (!loaded.some((r) => r.status === "fulfilled"))
		throw new Error("no face loaded");
}

/**
 * Fetches family previews at most `limit` at a time, once each per session.
 * A request that is cancelled before it starts is forgotten, so a row scrolled
 * past quickly costs nothing; one that fails resolves to null for good, since
 * the row reads fine in the UI font and retrying would only repeat the error.
 */
export function createPreviewLoader({
	limit = 6,
	fetchCss = defaultFetchCss,
	loadFaces = defaultLoadFaces,
}: PreviewLoaderOptions = {}) {
	/** started or finished, by family */
	const started = new Map<string, Promise<string | null>>();
	type Job = {
		family: string;
		result: Promise<string | null>;
		settle: (v: string | null) => void;
		waiting: number;
	};
	const queue: Job[] = [];
	let active = 0;

	const run = async (family: string): Promise<string | null> => {
		try {
			const faces = parsePreviewCss(await fetchCss(previewCssUrl(family)));
			if (faces.length === 0) return null;
			const name = previewName(family);
			await loadFaces(name, faces);
			return name;
		} catch {
			return null;
		}
	};

	const pump = () => {
		while (active < limit) {
			const job = queue.shift();
			if (!job) return;
			active++;
			started.set(job.family, job.result);
			void run(job.family).then((v) => {
				active--;
				job.settle(v);
				pump();
			});
		}
	};

	return {
		request(family: string): PreviewRequest {
			const hit = started.get(family);
			if (hit) return { result: hit, cancel: () => {} };
			let job = queue.find((j) => j.family === family);
			if (!job) {
				let settle: (v: string | null) => void = () => {};
				const result = new Promise<string | null>((r) => {
					settle = r;
				});
				job = { family, result, settle, waiting: 0 };
				queue.push(job);
			}
			const mine = job;
			mine.waiting++;
			pump();
			let cancelled = false;
			return {
				result: mine.result,
				cancel: () => {
					if (cancelled) return;
					cancelled = true;
					mine.waiting--;
					const at = queue.indexOf(mine);
					if (mine.waiting <= 0 && at >= 0) queue.splice(at, 1);
				},
			};
		},
		/** requests running now */
		get inFlight() {
			return active;
		},
		/** requests waiting for a slot */
		get waiting() {
			return queue.length;
		},
	};
}

export type PreviewLoader = ReturnType<typeof createPreviewLoader>;

let shared: PreviewLoader | null = null;

/** The session's loader, shared by every picker. */
export function previewLoader(): PreviewLoader {
	shared ??= createPreviewLoader();
	return shared;
}

/**
 * The CSS family to show `family` in while the row is mounted, or null until
 * (or unless) its preview loads. Unmounting before the request starts drops it.
 */
export function useFontPreview(
	family: string | null,
	loader: PreviewLoader = previewLoader(),
): string | null {
	const [face, setFace] = useState<{ family: string; css: string | null }>();
	useEffect(() => {
		if (!family) return;
		const req = loader.request(family);
		let live = true;
		void req.result.then((css) => {
			if (live) setFace({ family, css });
		});
		return () => {
			live = false;
			req.cancel();
		};
	}, [family, loader]);
	return face && face.family === family ? face.css : null;
}
