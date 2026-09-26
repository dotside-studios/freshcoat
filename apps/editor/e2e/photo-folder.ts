import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { probePath } from "./helpers";

const PROBE = probePath("watermark-probe");
export const PHOTO_INPUT = "input[data-testid=generated-photos]";

/** A JPEG comment segment, which changes a file's bytes but not its pixels. */
function withComment(jpeg: Buffer, text: string): Buffer {
	const body = Buffer.from(text, "latin1");
	const segment = Buffer.alloc(4 + body.length);
	segment.writeUInt16BE(0xfffe, 0);
	segment.writeUInt16BE(body.length + 2, 2);
	body.copy(segment, 4);
	return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/**
 * `count` camera-sized photos in a folder on disk, picked into a file input
 * on the page. One noisy photo is made in the page and written `count` times
 * with a different comment, so each is its own photo: the page reads them
 * from disk as it would a user's, instead of holding them all in memory.
 */
export async function pickGeneratedPhotos(
	page: Page,
	dir: string,
	opts: { count: number; width: number; height: number },
): Promise<void> {
	const base64 = await page.evaluate(
		async ({ path, width, height }) => {
			const probe = await import(/* @vite-ignore */ path);
			return probe.photoBase64({
				name: "photo.jpg",
				width,
				height,
				top: [180, 120, 60],
				noise: true,
			});
		},
		{ path: PROBE, width: opts.width, height: opts.height },
	);
	const photo = Buffer.from(base64 as string, "base64");
	mkdirSync(dir, { recursive: true });
	const paths: string[] = [];
	for (let i = 1; i <= opts.count; i++) {
		const name = `photo-${String(i).padStart(4, "0")}.jpg`;
		const path = join(dir, name);
		writeFileSync(path, withComment(photo, `freshcoat test photo ${i}`));
		paths.push(path);
	}
	await page.evaluate((testId) => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.dataset.testid = testId;
		input.hidden = true;
		document.body.appendChild(input);
	}, "generated-photos");
	await page.setInputFiles(PHOTO_INPUT, paths);
}

export type WatermarkRun = {
	count: number;
	importMs: number;
	sourceBytes: number;
	ms: number;
	itemsPerSecond: number;
	ok: number;
	failed: unknown[];
	parts: { name: string; bytes: number }[];
	stats: { poolSize: number; maxHeld: number; window: number };
	poolSize: number;
	largestImagePixels: number;
	heap: { baseline: number; peak: number; growth: number; available: boolean };
};

/** Watermarks the picked photos at their own size as JPEG, into zip parts. */
export function runWatermarkExport(
	page: Page,
	partBytes: number,
): Promise<WatermarkRun> {
	return page.evaluate(
		async ({ path, selector, partBytes }) => {
			const probe = await import(/* @vite-ignore */ path);
			return probe.runWatermarkExport({ selector, partBytes });
		},
		{ path: PROBE, selector: PHOTO_INPUT, partBytes },
	);
}
