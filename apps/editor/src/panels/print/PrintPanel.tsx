import { Button } from "@freshcoat-js/ui/button";
import { useMemo } from "react";
import { EMPTY, TEMPLATE_SETUP } from "~/app/copy";
import { isOperand } from "~/doc/path";
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
	if (ins?.keys[0]?.endsWith("/bg") ?? true)
		return (
			<Empty title={EMPTY.noSideSelection} onTemplateSetup={onTemplateSetup} />
		);
	if (!body) return <Empty title={EMPTY.noPrintSettings} />;
	return (
		<InspectorCollapsedProvider value={collapsed}>
			<OverridesContext.Provider value={overrides}>
				{body}
			</OverridesContext.Provider>
		</InspectorCollapsedProvider>
	);
}
