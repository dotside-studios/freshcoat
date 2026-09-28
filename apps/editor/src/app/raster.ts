import { rasterSize, sizedSvg, svgSize } from "./svg";

export async function rasterizeSvg(markup: string): Promise<Blob> {
	const size = rasterSize(svgSize(markup));
	const url = URL.createObjectURL(
		new Blob([sizedSvg(markup, size)], { type: "image/svg+xml" }),
	);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2D canvas");
		ctx.drawImage(img, 0, 0, size.width, size.height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
				"image/png",
			),
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}
