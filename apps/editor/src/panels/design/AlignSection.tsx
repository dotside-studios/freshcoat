import { IconButton } from "@freshcoat-js/ui/icon-button";
import { memo } from "react";
import type { Icon } from "~/app/icons";
import type { AlignMode } from "~/doc/geometry";
import { useEditor } from "~/state/hooks";
import AlignBottomIcon from "~icons/mingcute/align-bottom-line";
import AlignHCenterIcon from "~icons/mingcute/align-horizontal-center-line";
import AlignLeftIcon from "~icons/mingcute/align-left-2-line";
import AlignRightIcon from "~icons/mingcute/align-right-2-line";
import AlignTopIcon from "~icons/mingcute/align-top-line";
import AlignVCenterIcon from "~icons/mingcute/align-vertical-center-line";
import DistributeHIcon from "~icons/mingcute/distribute-spacing-horizontal-line";
import DistributeVIcon from "~icons/mingcute/distribute-spacing-vertical-line";
import type { Inspect } from "./field-helpers";

const ALIGN: [AlignMode, string, Icon][] = [
	["left", "Align left", AlignLeftIcon],
	["hcenter", "Align horizontal centers", AlignHCenterIcon],
	["right", "Align right", AlignRightIcon],
	["top", "Align top", AlignTopIcon],
	["vcenter", "Align vertical centers", AlignVCenterIcon],
	["bottom", "Align bottom", AlignBottomIcon],
	["hdistribute", "Distribute horizontally", DistributeHIcon],
	["vdistribute", "Distribute vertically", DistributeVIcon],
];

export const AlignSection = memo(function AlignSection({
	ins,
}: {
	ins: Inspect;
}) {
	// A count, so a new render result does not re-render the row.
	const movable = useEditor(
		(s) => ins.keys.filter((k) => !s.geometry.get(k)?.autoLayoutChild).length,
	);
	return (
		<div
			role="toolbar"
			aria-label="Align"
			className="flex items-center justify-between border-fc-border border-b px-1.5 py-1"
		>
			{ALIGN.map(([mode, label, Glyph]) => (
				<IconButton
					key={mode}
					aria-label={label}
					tooltip={label}
					isDisabled={
						movable === 0 || (mode.endsWith("distribute") && movable < 3)
					}
					className="pointer-coarse:size-7"
					onPress={() => ins.controller.alignSelection(mode)}
				>
					<Glyph />
				</IconButton>
			))}
		</div>
	);
});
