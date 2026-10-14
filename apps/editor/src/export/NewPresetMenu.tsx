import {
	Menu,
	MenuItem,
	MenuSection,
	MenuSeparator,
} from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import type { ReactNode } from "react";
import { MenuTrigger } from "react-aria-components";
import { useController } from "~/app/context";
import { useEditor } from "~/state/hooks";
import { PRESET_STARTERS, presetFromStarter } from "./starters";

const GROUPS = [
	{ id: "print", title: "Print" },
	{ id: "digital", title: "Digital" },
] as const;

/** Opens a menu of starter presets from `children`, a button. */
export function NewPresetMenu({ children }: { children: ReactNode }) {
	const controller = useController();
	const presets = useEditor((s) => s.workspace?.presets);
	const templateId = useEditor((s) => s.workspace?.activeTemplateId);
	return (
		<MenuTrigger>
			{children}
			<Popover placement="bottom start">
				<Menu
					aria-label="New preset"
					onAction={(id) => {
						if (!templateId || !presets) return;
						controller.dispatch({
							type: "setPreset",
							preset: presetFromStarter(
								PRESET_STARTERS.find((s) => s.id === id),
								templateId,
								presets,
							),
						});
					}}
				>
					<MenuItem id="blank">Blank preset</MenuItem>
					<MenuSeparator />
					{GROUPS.map((group) => (
						<MenuSection key={group.id} title={group.title}>
							{PRESET_STARTERS.filter((s) => s.group === group.id).map((s) => (
								<MenuItem key={s.id} id={s.id}>
									{s.name}
								</MenuItem>
							))}
						</MenuSection>
					))}
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}
