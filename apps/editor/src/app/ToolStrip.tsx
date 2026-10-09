import { formatShortcut } from "@freshcoat-js/ui/kbd";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { Toolbar, ToolbarSeparator } from "@freshcoat-js/ui/toolbar";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "~/state/hooks";
import type { Tool } from "~/state/store";
import { COMMAND_BY_ID, type CommandContext } from "./commands";
import { TOOL_ICONS } from "./icons";

type Slot = Tool | readonly Tool[];

const GROUPS: Slot[][] = [
	["move", "hand"],
	[
		"frame",
		"rect",
		"ellipse",
		"pen",
		"text",
		["image", "placeholder"],
		"qr",
		"barcode",
	],
];

const LONG_PRESS_MS = 400;

const commandOf = (t: Tool) => COMMAND_BY_ID.get(`tool.${t}`);

function runTool(t: Tool, ctx: CommandContext) {
	const command = commandOf(t);
	if (command) void command.run(ctx);
}

function ToolButton({
	tool,
	isSelected,
	onPress,
}: {
	tool: Tool;
	isSelected: boolean;
	onPress: () => void;
}) {
	const command = commandOf(tool);
	const Icon = TOOL_ICONS[tool];
	const key = command?.keys?.[0];
	return (
		<ToggleButton
			aria-label={command?.label ?? tool}
			data-testid={`tool-${tool}`}
			tooltip={`${command?.label ?? tool}${key ? `  ${formatShortcut(key)}` : ""}`}
			isSelected={isSelected}
			onChange={onPress}
			className="data-selected:bg-fc-accent data-selected:text-white"
		>
			<Icon />
		</ToggleButton>
	);
}

function ToolFlyout({
	tools,
	current,
	ctx,
}: {
	tools: readonly Tool[];
	current: Tool;
	ctx: CommandContext;
}) {
	const [shown, setShown] = useState(tools[0] as Tool);
	const [open, setOpen] = useState(false);
	const anchor = useRef<HTMLDivElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const held = useRef(false);

	useEffect(() => {
		if (tools.includes(current)) setShown(current);
	}, [tools, current]);

	const clear = () => window.clearTimeout(timer.current);
	const choose = (t: Tool) => {
		setOpen(false);
		setShown(t);
		runTool(t, ctx);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the button inside takes focus and keys; a hold or right-click on it opens the group's menu
		<div
			ref={anchor}
			className="relative"
			data-testid={`tool-group-${tools[0]}`}
			onContextMenu={(e) => {
				e.preventDefault();
				setOpen(true);
			}}
			onPointerDownCapture={() => {
				held.current = false;
				clear();
				timer.current = window.setTimeout(() => {
					held.current = true;
					setOpen(true);
				}, LONG_PRESS_MS);
			}}
			onPointerUpCapture={clear}
			onPointerLeave={clear}
			onPointerCancel={clear}
		>
			<ToolButton
				tool={shown}
				isSelected={current === shown}
				onPress={() => {
					if (held.current) held.current = false;
					else choose(shown);
				}}
			/>
			<span
				aria-hidden
				className={cn(
					"pointer-events-none absolute right-0.5 bottom-0.5 size-1 [clip-path:polygon(100%_0,100%_100%,0_100%)]",
					current === shown ? "bg-white" : "bg-fc-muted",
				)}
			/>
			<Popover
				triggerRef={anchor}
				isOpen={open}
				onOpenChange={setOpen}
				placement="right top"
			>
				<Menu aria-label="Image tools" onAction={(k) => choose(k as Tool)}>
					{tools.map((t) => {
						const Icon = TOOL_ICONS[t];
						const command = commandOf(t);
						return (
							<MenuItem
								key={t}
								id={t}
								icon={<Icon />}
								shortcut={command?.keys?.[0]}
							>
								{command?.label ?? t}
							</MenuItem>
						);
					})}
				</Menu>
			</Popover>
		</div>
	);
}

export function ToolStrip({ ctx }: { ctx: CommandContext }) {
	const tool = useEditor((s) => s.tool);
	return (
		<Toolbar
			orientation="vertical"
			aria-label="Tools"
			className="z-10 flex w-10 shrink-0 flex-col items-center gap-0.5 border-fc-border border-r bg-fc-panel py-1.5 pointer-coarse:w-12"
		>
			{GROUPS.map((group, i) => (
				<div key={String(group[0])} className="contents">
					{i > 0 ? <ToolbarSeparator className="my-1 w-6" /> : null}
					{group.map((slot) =>
						typeof slot === "string" ? (
							<ToolButton
								key={slot}
								tool={slot}
								isSelected={tool === slot}
								onPress={() => runTool(slot, ctx)}
							/>
						) : (
							<ToolFlyout key={slot[0]} tools={slot} current={tool} ctx={ctx} />
						),
					)}
				</div>
			))}
		</Toolbar>
	);
}
