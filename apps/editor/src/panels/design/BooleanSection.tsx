import { IconButton } from "@freshcoat-js/ui/icon-button";
import { memo } from "react";
import { BOOLEAN } from "~/app/copy";
import type { Icon } from "~/app/icons";
import { BOOLEAN_OPS, type BooleanOp } from "~/doc/boolean";
import ExcludeIcon from "~icons/mingcute/exclude-line";
import IntersectIcon from "~icons/mingcute/intersect-line";
import SubtractIcon from "~icons/mingcute/subtract-line";
import UnionIcon from "~icons/mingcute/union-line";
import type { Inspect } from "./field-helpers";

const ICONS: Record<BooleanOp, Icon> = {
	union: UnionIcon,
	subtract: SubtractIcon,
	intersect: IntersectIcon,
	exclude: ExcludeIcon,
};

export const BooleanSection = memo(function BooleanSection({
	ins,
}: {
	ins: Inspect;
}) {
	return (
		<div
			role="toolbar"
			aria-label={BOOLEAN.toolbar}
			className="flex items-center gap-1 border-fc-border border-b px-1.5 py-1"
		>
			{BOOLEAN_OPS.map((op) => {
				const Glyph = ICONS[op];
				return (
					<IconButton
						key={op}
						aria-label={BOOLEAN[op]}
						tooltip={BOOLEAN[op]}
						className="pointer-coarse:size-7"
						onPress={() => void ins.controller.booleanSelection(op)}
					>
						<Glyph />
					</IconButton>
				);
			})}
		</div>
	);
});
