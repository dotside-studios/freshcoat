import { IconButton } from "@freshcoat/ui/icon-button";
import { cn } from "@freshcoat/ui/lib/cn";
import { Menu, MenuItem } from "@freshcoat/ui/menu";
import { Popover } from "@freshcoat/ui/popover";
import { Tooltip, TooltipTrigger } from "@freshcoat/ui/tooltip";
import { createContext, type ReactNode, useContext } from "react";
import { MenuTrigger, Button as RACButton } from "react-aria-components";
import { VARIANT_UI } from "~/app/copy";
import AddIcon from "~icons/mingcute/add-line";
import MinusIcon from "~icons/mingcute/minimize-line";

/**
 * What the active variant changes on the selected layers. A control names
 * the keys it edits (`properties` keys, or `pos`, `size`, `rotation`,
 * `opacity`); on the side background any key reads the whole background.
 * Null with no active variant.
 */
export type Overrides = {
	label: string;
	changed: (keys: readonly string[]) => boolean;
	/** Drops those keys from the variant, as one undo step. */
	reset: (keys: readonly string[]) => void;
};

export const OverridesContext = createContext<Overrides | null>(null);

/** The accent dot on a control the active variant changes; it offers Reset
 *  to Default. Renders nothing when the variant leaves `keys` alone. */
export function OverrideMarker({
	keys,
	className,
}: {
	keys: readonly string[];
	className?: string;
}) {
	const overrides = useContext(OverridesContext);
	if (!overrides || keys.length === 0 || !overrides.changed(keys)) return null;
	const tip = VARIANT_UI.changedIn(overrides.label);
	return (
		<MenuTrigger>
			<TooltipTrigger delay={300}>
				<RACButton
					aria-label={tip}
					data-testid="override-marker"
					className={cn(
						"flex size-3 shrink-0 cursor-default items-center justify-center rounded-full outline-none data-hovered:bg-fc-accent-soft data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent pointer-coarse:size-6",
						className,
					)}
				>
					<span className="size-1.5 rounded-full bg-fc-accent" />
				</RACButton>
				<Tooltip>{tip}</Tooltip>
			</TooltipTrigger>
			<Popover placement="bottom start">
				<Menu aria-label={tip} onAction={() => overrides.reset(keys)}>
					<MenuItem id="reset">{VARIANT_UI.resetToDefault}</MenuItem>
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}

/** A control with no label of its own column (a field in a Pair), marked at
 *  its top-left corner. */
export function Marked({
	keys,
	children,
}: {
	keys: readonly string[];
	children: ReactNode;
}) {
	return (
		<div className="relative min-w-0">
			{children}
			<OverrideMarker
				keys={keys}
				className="absolute -top-1.5 -left-1.5 pointer-coarse:-top-3 pointer-coarse:-left-3"
			/>
		</div>
	);
}

/** A labelled row: a fixed label column, then the controls. `keys` are what
 *  the row edits, for the variant marker before its label. */
export function Row({
	label,
	keys,
	children,
	className,
}: {
	label: ReactNode;
	keys?: readonly string[];
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid min-h-fc-control grid-cols-[52px_minmax(0,1fr)] items-center gap-2",
				className,
			)}
		>
			<span className="flex min-w-0 items-center gap-1 text-fc-muted text-fc-sm">
				{keys ? <OverrideMarker keys={keys} className="-ml-1" /> : null}
				<span className="truncate">{label}</span>
			</span>
			<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
				{children}
			</div>
		</div>
	);
}

/** What a section's header carries: its marker, when the variant changes any
 *  of its keys, and then its own actions. */
export function sectionActions(
	keys: readonly string[],
	actions?: ReactNode,
): ReactNode {
	return (
		<>
			<OverrideMarker keys={keys} className="mr-0.5" />
			{actions}
		</>
	);
}

/** Says a section's values are shared by every variant, while one is
 *  active: a variant changes only a layer's properties, position, size,
 *  rotation and opacity. */
export function SharedNotice() {
	const overrides = useContext(OverridesContext);
	if (!overrides) return null;
	return <Notice>{VARIANT_UI.shared}</Notice>;
}

/** Two equal columns, for X/Y, W/H and similar pairs. */
export function Pair({
	children,
	cols = 2,
	className,
}: {
	children: ReactNode;
	cols?: 2 | 3 | 4;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid gap-1.5",
				cols === 2 && "grid-cols-2",
				cols === 3 && "grid-cols-3",
				cols === 4 && "grid-cols-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function AddButton({
	label,
	onPress,
	isDisabled,
}: {
	label: string;
	onPress: () => void;
	isDisabled?: boolean;
}) {
	return (
		<IconButton
			aria-label={label}
			tooltip={label}
			onPress={onPress}
			isDisabled={isDisabled}
			className="size-5 pointer-coarse:size-8"
		>
			<AddIcon />
		</IconButton>
	);
}

export function RemoveButton({
	label,
	onPress,
	isDisabled,
}: {
	label: string;
	onPress: () => void;
	isDisabled?: boolean;
}) {
	return (
		<IconButton
			aria-label={label}
			tooltip={label}
			onPress={onPress}
			isDisabled={isDisabled}
			className="size-5 pointer-coarse:size-8"
		>
			<MinusIcon />
		</IconButton>
	);
}

export function Notice({ children }: { children: ReactNode }) {
	return <p className="text-fc-faint text-fc-sm leading-snug">{children}</p>;
}

/** A thin rule between repeated items (fills, shadows, conditions). */
export function ItemGroup({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5 border-fc-border border-t pt-1.5 first:border-t-0 first:pt-0">
			{children}
		</div>
	);
}
