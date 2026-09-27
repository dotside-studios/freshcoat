import type { Element } from "@freshcoat-js/coatfile";
import type { ComponentType, SVGProps } from "react";
import { isEllipseVector } from "~/doc/factories";
import type { Layer } from "~/doc/path";
import type { Tool } from "~/state/store";
import BackgroundIcon from "~icons/mingcute/background-line";
import BarcodeIcon from "~icons/mingcute/barcode-line";
import MoveIcon from "~icons/mingcute/cursor-2-line";
import FrameIcon from "~icons/mingcute/frame-line";
import HandIcon from "~icons/mingcute/hand-line";
import ImageIcon from "~icons/mingcute/pic-line";
import QrIcon from "~icons/mingcute/qrcode-line";
import EllipseIcon from "~icons/mingcute/round-line";
import RectIcon from "~icons/mingcute/square-line";
import TextIcon from "~icons/mingcute/text-line";
import VectorIcon from "~icons/mingcute/vector-bezier-line";
import MaskIcon from "~icons/mingcute/vector-group-line";

export type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export const TOOL_ICONS: Record<Tool, Icon> = {
	move: MoveIcon,
	hand: HandIcon,
	frame: FrameIcon,
	rect: RectIcon,
	ellipse: EllipseIcon,
	text: TextIcon,
	image: ImageIcon,
	qr: QrIcon,
	barcode: BarcodeIcon,
};

export function layerIcon(layer: Layer, background = false): Icon {
	if (background) return BackgroundIcon;
	const el = layer as Element;
	switch (el.type) {
		case "rect":
			return RectIcon;
		case "vector":
			return isEllipseVector(el) ? EllipseIcon : VectorIcon;
		case "text":
			return TextIcon;
		case "image":
			return ImageIcon;
		case "qr_code":
			return QrIcon;
		case "barcode":
			return BarcodeIcon;
		case "frame":
			return FrameIcon;
		case "mask":
			return MaskIcon;
	}
}
