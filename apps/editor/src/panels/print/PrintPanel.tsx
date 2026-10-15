import { Button } from "@freshcoat-js/ui/button";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { type ReactNode, useMemo } from "react";
import { EMPTY, TEMPLATE_SETUP } from "~/app/copy";
import { setSeparationsShown, useSeparationsShown } from "~/canvas/separations";
import { isOperand } from "~/doc/path";
import DropIcon from "~icons/mingcute/drop-line";
import { OverridesContext } from "../design/controls";
import type { Inspect } from "../design/field-helpers";
import {
	InspectorCollapsedProvider,
	useInspectorCollapsed,
} from "../design/InspectorSection";
import { SliceSection, takesSlice } from "../design/SliceSection";
import { SpotSection, takesSpot } from "../design/SpotSection";
import { useInspect } from "../design/use-inspect";

function sections(ins: Inspect) {
	const painted = !ins.keys.some((k) => isOperand(ins.template, k));
	const slice = takesSlice(ins);
	const spot = painted && takesSpot(ins);
	if (!slice && !spot) return null;
	return (
		<div data-testid="print-inspector">
			{slice && <SliceSection ins={ins} />}
			{spot && <SpotSection ins={ins} />}
		</div>
	);
}

function Empty({
	title,
	onTemplateSetup,
}: {
	title: string;
	onTemplateSetup?: () => void;
}) {
	return (
		<div
			className="flex flex-col items-start gap-2 p-3"
			data-testid="print-empty"
		>
			<p className="m-0 text-fc-faint text-fc-sm">{title}</p>
			{onTemplateSetup && (
				<Button size="sm" onPress={onTemplateSetup}>
					{TEMPLATE_SETUP.command}
				</Button>
			)}
		</div>
	);
}

function SeparationsToggle() {
	const on = useSeparationsShown();
	return (
		<div className="flex p-2 pb-0">
			<ToggleButton
				shape="text"
				isSelected={on}
				onChange={setSeparationsShown}
				className="gap-1.5 text-fc-sm"
				data-testid="separations-toggle"
			>
				<DropIcon className="size-4" />
				Separations
			</ToggleButton>
		</div>
	);
}

/** Print settings for the selection: slices and spot inks. With nothing
 *  selected it points to Template setup, where bleed and safe area live. */
export function PrintPanel({
	onTemplateSetup,
}: {
	onTemplateSetup?: () => void;
}) {
	const { template, ins, overrides } = useInspect();
	const body = useMemo(() => (ins ? sections(ins) : null), [ins]);
	const collapsed = useInspectorCollapsed();

	if (!template) return null;
	let content: ReactNode;
	if (ins?.keys[0]?.endsWith("/bg") ?? true)
		content = (
			<Empty title={EMPTY.noSideSelection} onTemplateSetup={onTemplateSetup} />
		);
	else if (!body) content = <Empty title={EMPTY.noPrintSettings} />;
	else
		content = (
			<InspectorCollapsedProvider value={collapsed}>
				<OverridesContext.Provider value={overrides}>
					{body}
				</OverridesContext.Provider>
			</InspectorCollapsedProvider>
		);
	return (
		<>
			<SeparationsToggle />
			{content}
		</>
	);
}
