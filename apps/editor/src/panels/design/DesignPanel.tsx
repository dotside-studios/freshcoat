import { hasFills } from "@freshcoat-js/coatfile/fills";
import { useMemo } from "react";
import { isBooleanShape } from "~/doc/boolean";
import { isBooleanVector, isOperand } from "~/doc/path";
import { AdjustSection } from "./AdjustSection";
import { AlignSection } from "./AlignSection";
import { BarcodeSection } from "./BarcodeSection";
import { BooleanSection } from "./BooleanSection";
import { ConstraintsSection, takesConstraints } from "./ConstraintsSection";
import { OverridesContext } from "./controls";
import { EffectsSection } from "./EffectsSection";
import { FillSection } from "./FillSection";
import { FrameSection } from "./FrameSection";
import type { Inspect, Layer } from "./field-helpers";
import { ImageSection } from "./ImageSection";
import {
	InspectorCollapsedProvider,
	useInspectorCollapsed,
} from "./InspectorSection";
import { LayerSection } from "./LayerSection";
import { MaskSection } from "./MaskSection";
import { QrSection } from "./QrSection";
import { SideSection } from "./SideSection";
import { StrokeSection } from "./StrokeSection";
import { TextSection } from "./TextSection";
import { useInspect } from "./use-inspect";
import { VectorSection } from "./VectorSection";
import { VisibilitySection } from "./VisibilitySection";

const STROKED = new Set(["rect", "vector", "frame", "image", "text"]);

export function DesignPanel() {
	const { template, ins, overrides } = useInspect();
	const body = useMemo(() => (ins ? sections(ins) : null), [ins]);
	const collapsed = useInspectorCollapsed();

	if (!template) return null;
	if (!ins)
		return <p className="p-3 text-fc-muted text-fc-sm">Nothing selected</p>;
	return (
		<InspectorCollapsedProvider value={collapsed}>
			<OverridesContext.Provider value={overrides}>
				{body}
			</OverridesContext.Provider>
		</InspectorCollapsedProvider>
	);
}

function sections(ins: Inspect) {
	const { layers } = ins;
	const background = ins.keys[0]?.endsWith("/bg") ?? false;
	if (background) {
		const bg = layers[0] as Layer;
		return (
			<div data-testid="design-inspector" data-mode="side">
				<SideSection ins={ins} />
				{bg.type === "rect" ? (
					<FillSection ins={ins} title="Background" />
				) : (
					<ImageSection ins={ins} background />
				)}
				<AdjustSection ins={ins} />
			</div>
		);
	}

	const types = new Set(layers.map((l) => l.type));
	const painted = !ins.keys.some((k) => isOperand(ins.template, k));
	const every = (ok: (type: string) => boolean) => [...types].every(ok);

	return (
		<div data-testid="design-inspector" data-mode="layers">
			<AlignSection ins={ins} />
			{((layers.length > 1 && layers.every(isBooleanShape)) ||
				(layers.length === 1 && isBooleanVector(layers[0]))) && (
				<BooleanSection ins={ins} />
			)}
			<LayerSection ins={ins} />
			{every((t) => t === "text") && <TextSection ins={ins} />}
			{every((t) => t === "image") && <ImageSection ins={ins} />}
			{every((t) => t === "qr_code") && <QrSection ins={ins} />}
			{every((t) => t === "barcode") && <BarcodeSection ins={ins} />}
			{every((t) => t === "vector") && <VectorSection ins={ins} />}
			{every((t) => t === "frame") && <FrameSection ins={ins} />}
			{every((t) => t === "mask") && <MaskSection ins={ins} />}
			{painted && layers.every(hasFills) && <FillSection ins={ins} />}
			{painted && every((t) => STROKED.has(t)) && (
				<StrokeSection ins={ins} text={types.has("text")} />
			)}
			{painted && <EffectsSection ins={ins} />}
			{takesConstraints(ins) && <ConstraintsSection ins={ins} />}
			{painted && <AdjustSection ins={ins} />}
			<VisibilitySection ins={ins} />
		</div>
	);
}
