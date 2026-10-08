import { Button } from "@freshcoat-js/ui/button";
import { ComboBox, ComboBoxItem } from "@freshcoat-js/ui/combo-box";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { ChevronRightIcon } from "@freshcoat-js/ui/icons";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import type { Dataset } from "@freshcoat-js/workspace";
import { useMemo } from "react";
import {
	Disclosure,
	DisclosurePanel,
	Button as RACButton,
} from "react-aria-components";
import { useController } from "~/app/context";
import { CONTENT, EMPTY, plural } from "~/app/copy";
import { TemplateBindingEditor } from "~/binding/BindingEditor";
import { readsDataset } from "~/binding/binding";
import { useEditor } from "~/state/hooks";
import { activeSlot } from "~/state/workspace";
import SamplesIcon from "~icons/mingcute/back-line";
import PrevIcon from "~icons/mingcute/left-line";
import NextIcon from "~icons/mingcute/right-line";

/** Steps the Edit preview through the bound dataset's records, or offers the
 *  workspace's datasets to an unbound template. */
export function RecordStepper() {
	const binding = useEditor((s) => activeSlot(s)?.binding);
	const datasets = useEditor((s) => s.workspace?.datasets);
	const templateId = useEditor((s) => s.workspace?.activeTemplateId);
	const dataset = readsDataset(binding)
		? datasets?.find((d) => d.id === binding.datasetId)
		: undefined;
	if (!templateId || !datasets || datasets.length === 0) return null;
	if (!dataset)
		return <DatasetPicker datasets={datasets} templateId={templateId} />;
	return <Stepper dataset={dataset} templateId={templateId} />;
}

function DatasetPicker({
	datasets,
	templateId,
}: {
	datasets: readonly Dataset[];
	templateId: string;
}) {
	const controller = useController();
	return (
		<PanelSection title={CONTENT.tryWith}>
			<Select
				aria-label="Dataset to try"
				value={null}
				placeholder={CONTENT.chooseDataset}
				onChange={(key) => {
					if (typeof key === "string") controller.bindTemplate(templateId, key);
				}}
			>
				{datasets.map((d) => (
					<SelectItem key={d.id} id={d.id} textValue={d.name}>
						{d.name}
					</SelectItem>
				))}
			</Select>
		</PanelSection>
	);
}

function Stepper({
	dataset,
	templateId,
}: {
	dataset: Dataset;
	templateId: string;
}) {
	const controller = useController();
	const current = useEditor((s) => s.previewRecordId);

	const labelColumn = useMemo(
		() =>
			dataset.columns.find((c) => c.type === "text")?.key ??
			dataset.columns[0]?.key,
		[dataset],
	);
	const items = useMemo(
		() =>
			dataset.records.map((r, i) => ({
				id: r.id,
				label: `${i + 1}. ${labelColumn ? String(r.values[labelColumn] ?? "") : r.id}`,
			})),
		[dataset, labelColumn],
	);

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
				{items.length === 0 ? (
					<p className="text-fc-faint text-fc-sm">{EMPTY.records}</p>
				) : (
					<>
						<div
							className="flex items-center gap-1"
							data-testid="record-stepper"
						>
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
					</>
				)}
				<Disclosure className="group/binding mt-1">
					<RACButton
						slot="trigger"
						className="flex h-fc-control cursor-default items-center gap-1 text-fc-muted text-fc-sm outline-none data-hovered:text-fc-text data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid"
					>
						<ChevronRightIcon className="size-3 shrink-0 transition-transform duration-100 group-data-expanded/binding:rotate-90" />
						{CONTENT.binding}
					</RACButton>
					<DisclosurePanel>
						<TemplateBindingEditor templateId={templateId} />
					</DisclosurePanel>
				</Disclosure>
			</PanelSection>
		</div>
	);
}
