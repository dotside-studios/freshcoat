import type { CardOrientation, CropRegion } from "./types";

// CR80 card dimensions at 300dpi
export const CR80_LONG = 1012; // 3.375"
export const CR80_SHORT = 638; // 2.125"
export const CR80_ASPECT = CR80_LONG / CR80_SHORT; // ~1.586

export function defaultCropRegion(): CropRegion {
	return { x: 0, y: 0, width: 1, height: 1, orientation: "landscape" };
}

// Get CR80 output dimensions for a given orientation
export function cr80Dimensions(orientation: CardOrientation): {
	width: number;
	height: number;
} {
	return orientation === "landscape"
		? { width: CR80_LONG, height: CR80_SHORT }
		: { width: CR80_SHORT, height: CR80_LONG };
}

// Get the crop aspect ratio for a given orientation
export function cr80CropAspect(orientation: CardOrientation): number {
	return orientation === "landscape" ? CR80_ASPECT : 1 / CR80_ASPECT;
}

// Auto-detect orientation from image aspect ratio
export function detectOrientation(
	imgWidth: number,
	imgHeight: number,
): CardOrientation {
	return imgWidth >= imgHeight ? "landscape" : "portrait";
}

// Fit a CR80 rectangle centered within the image
export function fitCr80CropToImage(
	imgWidth: number,
	imgHeight: number,
	orientation?: CardOrientation,
): CropRegion {
	const orient = orientation ?? detectOrientation(imgWidth, imgHeight);
	const targetAspect = cr80CropAspect(orient);
	const imgAspect = imgWidth / imgHeight;

	if (imgAspect > targetAspect) {
		const cropWidth = targetAspect / imgAspect;
		return {
			x: (1 - cropWidth) / 2,
			y: 0,
			width: cropWidth,
			height: 1,
			orientation: orient,
		};
	}
	const cropHeight = imgAspect / targetAspect;
	return {
		x: 0,
		y: (1 - cropHeight) / 2,
		width: 1,
		height: cropHeight,
		orientation: orient,
	};
}
