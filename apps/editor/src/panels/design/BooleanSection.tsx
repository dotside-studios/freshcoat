import { Button } from "@freshcoat-js/ui/button";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { BOOLEAN } from "~/app/copy";
import { BOOLEAN_ICONS } from "~/app/icons";
import { BOOLEAN_OPS } from "~/doc/boolean";
import { isBooleanVector } from "~/doc/path";
import type { Inspect } from "./field-helpers";

const BUTTON = "pointer-coarse:size-7";

/** The operations, which combine the selected shapes. Over a single boolean
 *  layer they switch how it combines its own, the current one pressed, and
 *  Flatten makes it a plain vector. */
export function BooleanSection({ ins }: { ins: Inspect }) {
	const { controller } = ins;
	const only = ins.keys.length === 1 ? ins.layers[0] : undefined;
	const live = isBooleanVector(only) ? only : undefined;
	return (
		<div
			role="toolbar"
			aria-label={BOOLEAN.toolbar}
			className="flex items-center gap-1 border-fc-border border-b px-1.5 py-1"
		>
			{BOOLEAN_OPS.map((op) => {
				const Glyph = BOOLEAN_ICONS[op];
				if (live)
					return (
						<ToggleButton
							key={op}
							aria-label={BOOLEAN[op]}
							tooltip={BOOLEAN[op]}
							className={BUTTON}
							isSelected={live.properties.boolean.op === op}
							onChange={() => controller.setBooleanOp(op)}
						>
							<Glyph />
						</ToggleButton>
					);
				return (
					<IconButton
						key={op}
						aria-label={BOOLEAN[op]}
						tooltip={BOOLEAN[op]}
						className={BUTTON}
						onPress={() => void controller.booleanSelection(op)}
					>
						<Glyph />
					</IconButton>
				);
			})}
			{live && (
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto"
					onPress={() => controller.flattenSelection()}
				>
					{BOOLEAN.flatten}
				</Button>
			)}
		</div>
	);
}
