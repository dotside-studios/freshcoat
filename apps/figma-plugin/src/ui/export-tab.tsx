import { Button } from "@create-figma-plugin/ui";
import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import type { FieldOverviewItem, PluginSettings } from "~/shared/protocol";
import { OpenInFreshcoatLabel } from "~/ui/components";
import {
	StepCanvas,
	StepDetails,
	StepExport,
	StepFrames,
} from "~/ui/export-steps";
import type { ExportTarget } from "~/ui/export-target";
import type { FieldDetector } from "~/ui/fields-tab";
import { Fill, Panel, Row } from "~/ui/layout";
import { type Action, useExport } from "~/ui/use-export";
import { useThumbnails } from "~/ui/use-thumbnails";

export function ExportTab(props: {
	target: ExportTarget;
	products: ProductRegistryEntry[];
	/** Ask the shell to load the live product catalog. Called only once the
	 *  author opts into a Davi export. */
	onNeedProducts: () => void;
	productSku: string;
	/** False until main's stored settings arrive; nothing is written back
	 *  before then, or a default would overwrite the stored choice. */
	settingsLoaded: boolean;
	onPersist: (patch: Partial<PluginSettings>) => void;
	fields: FieldOverviewItem[];
	detector: FieldDetector;
	freshcoatUrl: string;
	showDiagnostics: boolean;
	onOpenSettings: () => void;
}): JSX.Element {
	const {
		target,
		products,
		onNeedProducts,
		productSku,
		settingsLoaded,
		onPersist,
		fields,
		detector,
	} = props;
	const { daviMode, card, node, product } = target;

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [mood, setMood] = useState("");
	// undefined: follow progress (the first unfinished step is open). A click
	// on a header takes over from there.
	const [openStep, setOpenStep] = useState<number | null | undefined>(
		undefined,
	);
	// Set once the author types a name, which stops the prefill from the frame.
	const nameEditedRef = useRef(false);

	const ex = useExport({
		target,
		freshcoatUrl: props.freshcoatUrl,
		showDiagnostics: props.showDiagnostics,
		onOpenSettings: props.onOpenSettings,
		onOpenStep: setOpenStep,
	});
	const { phase, sizeIssues } = ex;
	const working = phase.kind === "working";

	// Previews for exactly what is on screen: the picked frame or its sides,
	// colorway instances, and frames that need resizing.
	const thumbnailIds = useMemo(() => {
		const ids = daviMode
			? (card?.sides ?? []).map((s) => s.nodeId).filter((id) => id !== null)
			: node
				? [node.id]
				: [];
		return [
			...ids,
			...(target.colorwaySource?.colorways ?? []).map((cw) => cw.instanceId),
			...sizeIssues.map((i) => i.nodeId),
		];
	}, [daviMode, card, node, target.colorwaySource, sizeIssues]);
	const thumbnails = useThumbnails(thumbnailIds);

	// Prefill the name from the picked frame's name until the author edits it.
	useEffect(() => {
		if (nameEditedRef.current) return;
		const picked = daviMode ? card : node;
		if (picked) setName(picked.name);
	}, [daviMode, card, node]);

	useEffect(() => {
		if (settingsLoaded && daviMode) onNeedProducts();
	}, [settingsLoaded, daviMode, onNeedProducts]);

	// The catalog lands asynchronously, so seed an empty product pick from it.
	useEffect(() => {
		if (settingsLoaded && !productSku && products[0])
			onPersist({ productSku: products[0].sku });
	}, [settingsLoaded, products, productSku, onPersist]);

	// Step completion, in order.
	const nameOk = name.trim() !== "";
	const done: Record<1 | 2 | 3, boolean> = {
		1: !daviMode || !!product,
		2: target.complete,
		3: nameOk,
	};
	const firstOpen = ([1, 2, 3] as const).find((n) => !done[n]) ?? null;
	const current = openStep === undefined ? firstOpen : openStep;
	const toggle = (n: number) => () => setOpenStep(current === n ? null : n);
	const next = (n: number) => () => {
		const after = ([1, 2, 3] as const).find((m) => m > n && !done[m]);
		setOpenStep(after ?? null);
	};
	const ready = done[1] && done[2] && done[3];
	const missing = !done[2]
		? daviMode
			? "Pick a card in step 2"
			: "Pick a frame in step 2"
		: !done[3]
			? "Name the template in step 3"
			: null;

	function start(action: Action): void {
		if (!ready) return;
		const d = description.trim();
		const m = mood.trim();
		ex.start(action, {
			name: name.trim(),
			...(d ? { description: d } : {}),
			...(daviMode && m ? { mood: m } : {}),
		});
	}

	// The two ways out stay pinned under the steps, so however far the result
	// and its warnings scroll, exporting again is where it was.
	const footer = (
		<Row>
			<Fill>
				<Button
					fullWidth
					onClick={() => start("download")}
					disabled={!ready || working}
					loading={working && phase.action === "download"}
				>
					Export .coat
				</Button>
			</Fill>
			<Button
				secondary
				onClick={() => start("open")}
				disabled={!ready || working}
				loading={working && phase.action === "open"}
			>
				<OpenInFreshcoatLabel />
			</Button>
		</Row>
	);

	return (
		<Panel footer={footer}>
			<div style={{ marginTop: "-8px" }}>
				<StepCanvas
					target={target}
					products={products}
					productSku={productSku}
					onPersist={onPersist}
					done={done[1]}
					open={current === 1}
					onToggle={toggle(1)}
					onNext={next(1)}
				/>
				<StepFrames
					target={target}
					thumbnails={thumbnails}
					sizeIssues={sizeIssues}
					onResize={ex.resize}
					done={done[2]}
					open={current === 2}
					onToggle={toggle(2)}
					onNext={next(2)}
				/>
				<StepDetails
					daviMode={daviMode}
					name={name}
					onName={(v) => {
						nameEditedRef.current = true;
						setName(v);
					}}
					description={description}
					onDescription={setDescription}
					mood={mood}
					onMood={setMood}
					fields={fields}
					detector={detector}
					done={done[3]}
					open={current === 3}
					onToggle={toggle(3)}
					onNext={next(3)}
				/>
				<StepExport
					phase={phase}
					result={ex.result}
					missing={missing}
					product={product}
					name={name}
					detailsOpen={ex.detailsOpen}
					onToggleDetails={ex.toggleDetails}
					onExportAnyway={ex.exportAnyway}
					onDownload={() => void ex.downloadResult()}
					onOpen={(r) => void ex.handOff(r)}
					onDiagnostics={ex.downloadDiagnostics}
				/>
			</div>
		</Panel>
	);
}
