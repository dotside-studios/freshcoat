// Decodes photos off the main thread, already scaled, and encodes the result
// small: a lossy WebP thumbnail for grids, or a lossless one (PNG where the
// browser cannot write WebP) for a live preview. The EXIF orientation is
// applied here, so what comes back is upright and carries no metadata.

export type ThumbnailRequest = {
	id: number;
	blob: Blob;
	/** "thumb" is lossy and small; "preview" is lossless */
	kind: "thumb" | "preview";
	/** thumbnails: at most this wide */
	maxWidth?: number;
	/** previews: the long edge at most this */
	maxEdge?: number;
	/** the photo's size as seen, when its header gave it */
	width?: number;
	height?: number;
};

export type ThumbnailReply =
	| { id: number; ok: true; blob: Blob; width: number; height: number }
	| { id: number; ok: false; error: string };

type Scope = {
	postMessage(message: ThumbnailReply): void;
	onmessage: ((event: MessageEvent<ThumbnailRequest>) => void) | null;
};
const scope = self as unknown as Scope;

async function encode(
	canvas: OffscreenCanvas,
	kind: ThumbnailRequest["kind"],
): Promise<Blob> {
	const webp = await canvas.convertToBlob(
		kind === "thumb"
			? { type: "image/webp", quality: 0.8 }
			: { type: "image/webp", quality: 1 },
	);
	if (webp.type === "image/webp") return webp;
	return kind === "thumb"
		? canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
		: canvas.convertToBlob({ type: "image/png" });
}

/** The size to scale to: never up, and never below one pixel. */
function target(
	req: ThumbnailRequest,
	width: number,
	height: number,
): { width: number; height: number } {
	const scale =
		req.kind === "thumb"
			? Math.min(1, (req.maxWidth ?? width) / width)
			: Math.min(1, (req.maxEdge ?? width) / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

async function decode(req: ThumbnailRequest): Promise<ImageBitmap> {
	if (req.width && req.height) {
		const size = target(req, req.width, req.height);
		return createImageBitmap(req.blob, {
			resizeWidth: size.width,
			resizeHeight: size.height,
			resizeQuality: req.kind === "thumb" ? "medium" : "high",
			imageOrientation: "from-image",
		});
	}
	// No header size to plan from: decode, then scale.
	const full = await createImageBitmap(req.blob, {
		imageOrientation: "from-image",
	});
	const size = target(req, full.width, full.height);
	if (size.width === full.width && size.height === full.height) return full;
	try {
		return await createImageBitmap(full, {
			resizeWidth: size.width,
			resizeHeight: size.height,
			resizeQuality: req.kind === "thumb" ? "medium" : "high",
		});
	} finally {
		full.close();
	}
}

async function handle(req: ThumbnailRequest): Promise<ThumbnailReply> {
	const bitmap = await decode(req);
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		// A canvas in main memory: encoding reads its pixels straight back, and
		// a GPU canvas would make every thumbnail a readback that queues
		// behind the page's own frames.
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("no 2d context");
		ctx.drawImage(bitmap, 0, 0);
		const blob = await encode(canvas, req.kind);
		return {
			id: req.id,
			ok: true,
			blob,
			width: bitmap.width,
			height: bitmap.height,
		};
	} finally {
		bitmap.close();
	}
}

scope.onmessage = (event) => {
	const req = event.data;
	handle(req).then(
		(reply) => scope.postMessage(reply),
		(err: unknown) =>
			scope.postMessage({
				id: req.id,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			}),
	);
};
