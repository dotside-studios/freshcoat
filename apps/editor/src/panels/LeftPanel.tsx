import { cn } from "@freshcoat/ui/lib/cn";
import { type ReactNode, useId, useState } from "react";
import { LEFT_PANEL } from "~/app/copy";
import { LayersTree } from "./layers/LayersTree";
import {
	type LeftSection,
	SectionHeader,
	useCollapsedSections,
} from "./layers/SectionHeader";
import { SidesHeaderActions, SidesList } from "./layers/SidesList";
import { TemplatesHeaderActions, TemplatesList } from "./layers/TemplatesList";
import { VariantsHeaderActions, VariantsList } from "./layers/VariantsList";

export function LeftPanel() {
	const { collapsed, toggle } = useCollapsedSections();
	const [renamingVariant, setRenamingVariant] = useState<string | null>(null);

	const section = (
		id: LeftSection,
		body: ReactNode,
		actions?: ReactNode,
		fill = false,
	) => (
		<Section
			id={id}
			title={LEFT_PANEL[id]}
			expanded={!collapsed.has(id)}
			onToggle={() => toggle(id)}
			actions={actions}
			fill={fill}
		>
			{body}
		</Section>
	);

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			data-testid="left-panel-content"
		>
			{section("templates", <TemplatesList />, <TemplatesHeaderActions />)}
			{section("sides", <SidesList />, <SidesHeaderActions />)}
			{section(
				"variants",
				<VariantsList
					renaming={renamingVariant}
					onRenamingChange={setRenamingVariant}
				/>,
				<VariantsHeaderActions onAdded={setRenamingVariant} />,
			)}
			{section("layers", <LayersTree />, undefined, true)}
		</div>
	);
}

/** One section: its header, and a body that is gone while collapsed. Layers
 *  (`fill`) takes whatever height the sections above leave it. */
function Section({
	id,
	title,
	expanded,
	onToggle,
	actions,
	fill,
	children,
}: {
	id: LeftSection;
	title: string;
	expanded: boolean;
	onToggle: () => void;
	actions?: ReactNode;
	fill: boolean;
	children: ReactNode;
}) {
	const bodyId = `${useId()}-body`;
	return (
		<section
			aria-label={title}
			data-section={id}
			className={cn(
				fill && expanded
					? "flex min-h-0 flex-1 flex-col"
					: "shrink-0 border-fc-border border-b",
			)}
		>
			<SectionHeader
				title={title}
				expanded={expanded}
				controls={bodyId}
				onToggle={onToggle}
				actions={actions}
			/>
			<div
				id={bodyId}
				hidden={!expanded}
				className={cn(
					!expanded ? "hidden" : fill && "flex min-h-0 flex-1 flex-col",
				)}
			>
				{children}
			</div>
		</section>
	);
}
