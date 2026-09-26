import type { Template } from "@freshcoat/coatfile";
import { Checkbox } from "@freshcoat/ui/checkbox";
import { NumberField } from "@freshcoat/ui/number-field";
import { ToggleButton } from "@freshcoat/ui/toggle";
import { useRef, useState } from "react";
import { useController } from "~/app/context";
import { resizeTemplate } from "~/doc/ops";
import { resizeWithConstraints } from "~/doc/resize";
import LinkIcon from "~icons/mingcute/link-line";
import UnlinkIcon from "~icons/mingcute/unlink-line";

const MAX_SIDE = 16384;

/** Width, height, lock ratio and resize with constraints. */
export function SizeSection({ template }: { template: Template }) {
	const [locked, setLocked] = useState(false);
	const [constrained, setConstrained] = useState(false);
	const ratio = useRef(template.width / template.height);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<span className="w-16 shrink-0 truncate text-fc-muted text-fc-sm">
					Size
				</span>
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<TemplateSizeFields
						template={template}
						constrained={constrained}
						ratio={locked ? ratio.current : undefined}
					/>
					<ToggleButton
						aria-label="Lock aspect ratio"
						tooltip={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
						isSelected={locked}
						onChange={(on) => {
							ratio.current = template.width / template.height;
							setLocked(on);
						}}
					>
						{locked ? <LinkIcon /> : <UnlinkIcon />}
					</ToggleButton>
				</div>
			</div>
			<Checkbox
				className="ml-18"
				isSelected={constrained}
				onChange={setConstrained}
			>
				Resize with constraints
			</Checkbox>
		</div>
	);
}

/**
 * The template's W and H fields. Every side shares the size, so this is the
 * same edit wherever it is shown: one undo step per run of changes.
 */
export function TemplateSizeFields({
	template,
	constrained = false,
	ratio,
}: {
	template: Template;
	/** Layers follow their constraints instead of staying where they are. */
	constrained?: boolean;
	/** Width over height to keep, when the ratio is locked. */
	ratio?: number;
}) {
	const controller = useController();
	const resize = (w: number, h: number) =>
		controller.edit(
			(t) =>
				constrained ? resizeWithConstraints(t, w, h) : resizeTemplate(t, w, h),
			{ mergeKey: "resize", scope: "base" },
		);

	return (
		<>
			<NumberField
				label="W"
				aria-label="Template width"
				className="min-w-0 flex-1"
				value={template.width}
				min={1}
				max={MAX_SIDE}
				precision={0}
				onChange={(w) =>
					resize(w, ratio ? clampSide(Math.round(w / ratio)) : template.height)
				}
			/>
			<NumberField
				label="H"
				aria-label="Template height"
				className="min-w-0 flex-1"
				value={template.height}
				min={1}
				max={MAX_SIDE}
				precision={0}
				onChange={(h) =>
					resize(ratio ? clampSide(Math.round(h * ratio)) : template.width, h)
				}
			/>
		</>
	);
}

function clampSide(n: number): number {
	return Math.min(MAX_SIDE, Math.max(1, n));
}
