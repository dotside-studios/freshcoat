import { cn } from "@freshcoat-js/ui/lib/cn";
import type { DatasetAsset } from "@freshcoat-js/workspace";
import { type ThumbWidth, useThumbnail } from "./thumbnails";

/** A photo's thumbnail, with an empty box of the same size until it is
 *  made. */
export function AssetThumb({
	asset,
	width = 160,
	className,
}: {
	asset: DatasetAsset;
	width?: ThumbWidth;
	className?: string;
}) {
	const url = useThumbnail(asset, width);
	return url ? (
		<img src={url} alt="" className={className} draggable={false} />
	) : (
		<span aria-hidden="true" className={cn("block", className)} />
	);
}
