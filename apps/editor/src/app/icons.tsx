import type { Element } from "@freshcoat-js/coatfile";
import type { ComponentType, SVGProps } from "react";
import type { BooleanOp } from "~/doc/boolean";
import { isEllipseVector } from "~/doc/factories";
import type { Layer } from "~/doc/path";
import type { Tool } from "~/state/store";
import BackgroundIcon from "~icons/mingcute/background-line";
import BarcodeIcon from "~icons/mingcute/barcode-line";
import MoveIcon from "~icons/mingcute/cursor-2-line";
import ExcludeIcon from "~icons/mingcute/exclude-line";
import FrameIcon from "~icons/mingcute/frame-line";
import HandIcon from "~icons/mingcute/hand-line";
import IntersectIcon from "~icons/mingcute/intersect-line";
import PenIcon from "~icons/mingcute/pen-line";
import PlaceholderIcon from "~icons/mingcute/photo-album-line";
import ImageIcon from "~icons/mingcute/pic-line";
import QrIcon from "~icons/mingcute/qrcode-line";
import EllipseIcon from "~icons/mingcute/round-line";
import RectIcon from "~icons/mingcute/square-line";
import SubtractIcon from "~icons/mingcute/subtract-line";
import TextIcon from "~icons/mingcute/text-line";
import UnionIcon from "~icons/mingcute/union-line";
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
	pen: PenIcon,
	image: ImageIcon,
	placeholder: PlaceholderIcon,
	qr: QrIcon,
	barcode: BarcodeIcon,
};

export const BOOLEAN_ICONS: Record<BooleanOp, Icon> = {
	union: UnionIcon,
	subtract: SubtractIcon,
	intersect: IntersectIcon,
	exclude: ExcludeIcon,
};

export function layerIcon(layer: Layer, background = false): Icon {
	if (background) return BackgroundIcon;
	const el = layer as Element;
	switch (el.type) {
		case "rect":
			return RectIcon;
		case "vector":
			if (el.properties.boolean) return BOOLEAN_ICONS[el.properties.boolean.op];
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
