import { PanelSection } from "@freshcoat-js/ui/panel";
import { memo } from "react";
import { INSETS, TEMPLATE_SETUP } from "~/app/copy";
import { TemplateInsetField, TemplateSizeFields } from "../setup/SizeSection";
import { Row } from "./controls";
import type { Inspect } from "./field-helpers";

/** What Design shows with nothing selected: the side itself, and the
 *  template's size, which every side shares. */
export const SideSection = memo(function SideSection({
	ins,
}: {
	ins: Inspect;
}) {
	const t = ins.template;
	const name = t.template_data[ins.side]?.name ?? "";
	return (
		<PanelSection title="Side">
			<Row label="Name">
				<span className="truncate text-fc-text">{name}</span>
			</Row>
			<Row label="Size">
				<div
					className="flex min-w-0 flex-1 items-center gap-1"
					data-testid="side-size"
				>
					<TemplateSizeFields template={t} />
				</div>
			</Row>
			<p className="m-0 pl-[60px] text-fc-faint text-fc-sm">
				{TEMPLATE_SETUP.sharedSize}
			</p>
			{(["bleed", "safeArea"] as const).map((key) => (
				<Row key={key} label={INSETS[key]}>
					<TemplateInsetField
						template={t}
						inset={key}
						className="min-w-0 flex-1"
					/>
				</Row>
			))}
		</PanelSection>
	);
});
