import { formatShortcut } from "@freshcoat-js/ui/kbd";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { Toolbar, ToolbarSeparator } from "@freshcoat-js/ui/toolbar";
import { useEditor } from "~/state/hooks";
import type { Tool } from "~/state/store";
import { COMMAND_BY_ID, type CommandContext } from "./commands";
import { TOOL_ICONS } from "./icons";

const GROUPS: Tool[][] = [
	["move", "hand"],
	["frame", "rect", "ellipse", "text", "image", "qr", "barcode"],
];

export function ToolStrip({ ctx }: { ctx: CommandContext }) {
	const tool = useEditor((s) => s.tool);
	return (
		<Toolbar
			orientation="vertical"
			aria-label="Tools"
			className="z-10 flex w-10 shrink-0 flex-col items-center gap-0.5 border-fc-border border-r bg-fc-panel py-1.5 pointer-coarse:w-12"
		>
			{GROUPS.map((group, i) => (
				<div key={group[0]} className="contents">
					{i > 0 ? <ToolbarSeparator className="my-1 w-6" /> : null}
					{group.map((t) => {
						const command = COMMAND_BY_ID.get(`tool.${t}`);
						const Icon = TOOL_ICONS[t];
						const key = command?.keys?.[0];
						return (
							<ToggleButton
								key={t}
								aria-label={command?.label ?? t}
								data-testid={`tool-${t}`}
								tooltip={`${command?.label ?? t}${key ? `  ${formatShortcut(key)}` : ""}`}
								isSelected={tool === t}
								onChange={() => command && void command.run(ctx)}
								className="data-selected:bg-fc-accent data-selected:text-white"
							>
								<Icon />
							</ToggleButton>
						);
					})}
				</div>
			))}
		</Toolbar>
	);
}
