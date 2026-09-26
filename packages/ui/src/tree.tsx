import type { ReactNode } from "react";
import {
	Button,
	DropIndicator,
	type DropTarget,
	Tree as RACTree,
	TreeItem as RACTreeItem,
	type TreeItemProps as RACTreeItemProps,
	type TreeProps as RACTreeProps,
	TreeItemContent,
	type TreeItemContentRenderProps,
} from "react-aria-components";
import { ChevronRightIcon } from "./icons";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";

/** Horizontal indent per nesting level, in px. */
export const TREE_INDENT = 12;

function renderTreeDropIndicator(target: DropTarget) {
	return (
		<DropIndicator
			target={target}
			className={cn(
				"relative h-0 outline-none",
				"before:pointer-events-none before:absolute before:right-1 before:-top-px before:z-10 before:h-0.5 before:rounded-full",
				"before:left-[calc((var(--tree-item-level,1)-1)*12px+22px)]",
				"data-drop-target:before:bg-fc-accent",
			)}
		/>
	);
}

export interface TreeProps<T extends object> extends RACTreeProps<T> {}

/**
 * RAC Tree with the kit's row styling. When `dragAndDropHooks` has no
 * `renderDropIndicator`, a 2px accent line indented to the target level is used.
 */
export function Tree<T extends object>({
	className,
	dragAndDropHooks,
	...props
}: TreeProps<T>) {
	const hooks =
		dragAndDropHooks?.useDropIndicator && !dragAndDropHooks.renderDropIndicator
			? { ...dragAndDropHooks, renderDropIndicator: renderTreeDropIndicator }
			: dragAndDropHooks;
	return (
		<RACTree
			{...props}
			dragAndDropHooks={hooks}
			className={composeTw(
				className,
				"group/tree relative flex flex-col overflow-auto py-0.5 text-fc-base outline-none",
				"data-drop-target:bg-fc-accent-soft/40 data-focus-visible:-outline-offset-1",
			)}
		/>
	);
}

export interface TreeItemProps<T extends object>
	extends Omit<RACTreeItemProps<T>, "children"> {
	/** Row text, or any node (e.g. an inline rename field). */
	label: ReactNode;
	/** Leading glyph after the chevron, e.g. the layer kind. */
	icon?: ReactNode;
	/** Trailing controls. A function receives the row state (hovered, selected…). */
	actions?: ReactNode | ((state: TreeItemContentRenderProps) => ReactNode);
	/** Extra classes for the row's content box (not the row element). */
	contentClassName?: string;
	/** Nested `TreeItem`s, or a `Collection`. */
	children?: ReactNode;
}

export const treeRow =
	"group/row relative flex h-fc-control shrink-0 cursor-default select-none items-center text-fc-text outline-none " +
	"data-hovered:bg-fc-hover data-selected:bg-fc-active group-focus-within/tree:data-selected:bg-fc-accent-soft " +
	"data-disabled:text-fc-faint data-dragging:opacity-40 " +
	"data-drop-target:bg-fc-accent-soft data-drop-target:shadow-[inset_0_0_0_1px_var(--color-fc-accent)] " +
	"data-focus-visible:-outline-offset-1";

export function TreeItem<T extends object>({
	label,
	icon,
	actions,
	contentClassName,
	children,
	className,
	...props
}: TreeItemProps<T>) {
	return (
		<RACTreeItem {...props} className={composeTw(className, treeRow)}>
			<TreeItemContent>
				{(state) => (
					<div
						className={cn(
							"flex h-full min-w-0 flex-1 items-center gap-1 pr-1",
							contentClassName,
						)}
						style={{
							paddingInlineStart: `${(state.level - 1) * TREE_INDENT + 2}px`,
						}}
					>
						{state.allowsDragging && (
							<Button slot="drag" className="sr-only">
								Drag
							</Button>
						)}
						{state.hasChildItems ? (
							<Button
								slot="chevron"
								className="flex size-4 shrink-0 cursor-default items-center justify-center rounded-[2px] text-fc-muted outline-none data-hovered:text-fc-text pointer-coarse:size-6"
							>
								<ChevronRightIcon
									className={cn(
										"size-3 transition-transform duration-100",
										state.isExpanded && "rotate-90",
									)}
								/>
							</Button>
						) : (
							<span className="size-4 shrink-0 pointer-coarse:w-6" />
						)}
						{icon != null && (
							<span className="flex shrink-0 text-fc-muted group-data-selected/row:text-fc-text [&_svg]:size-3.5">
								{icon}
							</span>
						)}
						<span className="min-w-0 flex-1 truncate">{label}</span>
						{actions != null && (
							<span className="flex shrink-0 items-center gap-0.5">
								{typeof actions === "function" ? actions(state) : actions}
							</span>
						)}
					</div>
				)}
			</TreeItemContent>
			{children}
		</RACTreeItem>
	);
}
