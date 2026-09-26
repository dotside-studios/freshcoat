import { Button } from "@freshcoat/ui/button";
import { ComboBox, ComboBoxItem } from "@freshcoat/ui/combo-box";
import { IconButton } from "@freshcoat/ui/icon-button";
import { PanelSection } from "@freshcoat/ui/panel";
import { useMemo } from "react";
import { useController } from "~/app/context";
import { CONTENT, plural } from "~/app/copy";
import { useEditor } from "~/state/hooks";
import { activeSlot } from "~/state/workspace";
import SamplesIcon from "~icons/mingcute/back-line";
import PrevIcon from "~icons/mingcute/left-line";
import NextIcon from "~icons/mingcute/right-line";

/** Steps the Edit preview through the bound dataset's records. */
export function RecordStepper() {
	const controller = useController();
	const datasetId = useEditor((s) => activeSlot(s)?.binding?.datasetId);
	const dataset = useEditor((s) =>
		s.workspace?.datasets.find((d) => d.id === datasetId),
	);
	const current = useEditor((s) => s.previewRecordId);

	const labelColumn = useMemo(
		() =>
			dataset?.columns.find((c) => c.type === "text")?.key ??
			dataset?.columns[0]?.key,
		[dataset],
	);
	const items = useMemo(
		() =>
			(dataset?.records ?? []).map((r, i) => ({
				id: r.id,
				label: `${i + 1}. ${labelColumn ? String(r.values[labelColumn] ?? "") : r.id}`,
			})),
		[dataset, labelColumn],
	);

	if (!dataset || dataset.records.length === 0) return null;
	const index = items.findIndex((r) => r.id === current);
	const go = (i: number) => {
		const next = items[Math.max(0, Math.min(items.length - 1, i))];
		if (next) controller.previewRecord(next.id);
	};

	return (
		// At the inspector's narrowest, only the dataset's name gives way (its
		// full name in the tooltip), and "Samples" keeps only its icon, so
		// "Try with" always reads.
		<div className="@container">
			<PanelSection
				title={
					<span className="flex min-w-0 gap-[0.5em]">
						<span className="shrink-0">{CONTENT.tryWith}</span>{" "}
						<span className="min-w-0 truncate" title={dataset.name}>
							{dataset.name}
						</span>
					</span>
				}
				actions={
					current ? (
						<Button
							size="sm"
							variant="ghost"
							onPress={() => controller.previewRecord(null)}
						>
							<SamplesIcon />
							<span className="@max-[15rem]:sr-only">{CONTENT.samples}</span>
						</Button>
					) : null
				}
			>
				<div className="flex items-center gap-1" data-testid="record-stepper">
					<IconButton
						aria-label="Previous record"
						isDisabled={index <= 0}
						onPress={() => go(index - 1)}
					>
						<PrevIcon />
					</IconButton>
					<ComboBox
						aria-label="Preview record"
						className="min-w-0 flex-1"
						placeholder="Preview a record…"
						selectedKey={current}
						onSelectionChange={(key) => {
							if (typeof key === "string") controller.previewRecord(key);
						}}
						defaultItems={items}
					>
						{(item) => (
							<ComboBoxItem id={item.id} textValue={item.label}>
								{item.label}
							</ComboBoxItem>
						)}
					</ComboBox>
					<IconButton
						aria-label="Next record"
						isDisabled={index >= items.length - 1}
						onPress={() => go(index + 1)}
					>
						<NextIcon />
					</IconButton>
				</div>
				<p className="mt-1 text-fc-faint text-fc-sm tabular-nums">
					{index >= 0
						? `${index + 1} of ${items.length}`
						: plural(items.length, "record")}
				</p>
			</PanelSection>
		</div>
	);
}
