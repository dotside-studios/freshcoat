import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { SelectionBar } from "@freshcoat-js/ui/selection-bar";
import type { RecordStatus } from "@freshcoat-js/workspace";
import { MenuTrigger } from "react-aria-components";
import { plural } from "~/app/copy";
import CopyIcon from "~icons/mingcute/copy-2-line";
import DeleteIcon from "~icons/mingcute/delete-2-line";
import StatusIcon from "~icons/mingcute/list-check-line";
import { STATUSES } from "./cells";
import { ToolButton } from "./DataToolbar";
import { ExportSelected } from "./ExportSelected";

export type SelectionActions = {
	duplicate: () => void;
	remove: () => void;
	setStatus: (status: RecordStatus) => void;
	clear: () => void;
};

export function DataSelectionBar({
	datasetId,
	ids,
	actions,
}: {
	datasetId: string;
	ids: readonly string[];
	actions: SelectionActions;
}) {
	return (
		<SelectionBar
			label={ids.length ? plural(ids.length, "record") : null}
			onClear={actions.clear}
			className="-translate-x-1/2 absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-24px)]"
		>
			<ToolButton
				icon={<CopyIcon />}
				label="Duplicate"
				testId="duplicate-rows"
				showLabel="never"
				onPress={actions.duplicate}
			/>
			<ToolButton
				icon={<DeleteIcon />}
				label="Delete"
				testId="delete-rows"
				showLabel="never"
				shortcut="Mod+Backspace"
				onPress={actions.remove}
			/>
			<MenuTrigger>
				<ToolButton
					icon={<StatusIcon />}
					label="Mark"
					testId="status-menu"
					showLabel="always"
					menu
				/>
				<Popover placement="top">
					<Menu
						aria-label="Set status"
						onAction={(k) => actions.setStatus(k as RecordStatus)}
					>
						{STATUSES.map((s) => (
							<MenuItem key={s.id} id={s.id}>
								{`Mark ${s.label.toLowerCase()}`}
							</MenuItem>
						))}
					</Menu>
				</Popover>
			</MenuTrigger>
			<ExportSelected datasetId={datasetId} ids={ids} />
		</SelectionBar>
	);
}
