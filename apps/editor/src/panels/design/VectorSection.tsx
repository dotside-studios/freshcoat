import type { VectorElement } from "@freshcoat-js/coatfile";
import { scalePathData } from "@freshcoat-js/engine";
import { TextArea } from "@freshcoat-js/ui/field";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { useEffect, useState } from "react";
import { BOOLEAN } from "~/app/copy";
import RadiusIcon from "~icons/mingcute/border-radius-line";
import { Notice, Row } from "./controls";
import { commonValue, type Inspect } from "./field-helpers";
import { InspectorSection } from "./InspectorSection";

/** Why the coat engine would refuse this path data, or null when it reads. */
export function pathDataError(d: string): string | null {
	const s = d.trim();
	if (!s) return "Path data is empty";
	if (!/^[Mm]/.test(s)) return "Path data must start with M";
	try {
		// A non-unit scale makes the kit tokenize every command and number.
		scalePathData(s, 2, 2);
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
	return null;
}

export function VectorSection({ ins }: { ins: Inspect }) {
	const props = (ins.layers as VectorElement[]).map((e) => e.properties);
	const rule = commonValue(props.map((p) => p.fillRule ?? "nonzero"));
	const radius = commonValue(props.map((p) => p.cornerRadius ?? 0));
	const live = props.some((p) => p.boolean);
	return (
		<InspectorSection title="Vector">
			{!live && (
				<Row label="Fill rule">
					<Select
						aria-label="Fill rule"
						className="min-w-0 flex-1"
						placeholder="Mixed"
						value={rule}
						onChange={(v) =>
							ins.setProps("fill-rule", () => ({
								fillRule: v === "nonzero" ? undefined : v,
							}))
						}
					>
						<SelectItem id="nonzero">Non-zero</SelectItem>
						<SelectItem id="evenodd">Even-odd</SelectItem>
					</Select>
				</Row>
			)}
			<NumberField
				label={<RadiusIcon />}
				aria-label="Corner radius"
				min={0}
				value={radius}
				onChange={(v) =>
					ins.setProps("corner-radius", () => ({
						cornerRadius: v === 0 ? undefined : v,
					}))
				}
			/>
			{live ? (
				<Notice>{BOOLEAN.editPoints}</Notice>
			) : props.length === 1 ? (
				<PathField
					value={props[0].d}
					onCommit={(d) => ins.setProps("path", () => ({ d }))}
				/>
			) : (
				<Notice>Select one vector to edit its path</Notice>
			)}
		</InspectorSection>
	);
}

function PathField({
	value,
	onCommit,
}: {
	value: string;
	onCommit: (d: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setDraft(value);
		setError(null);
	}, [value]);
	const commit = () => {
		if (draft === value) return;
		const problem = pathDataError(draft);
		setError(problem);
		if (!problem) onCommit(draft.trim());
	};
	return (
		<TextArea
			label="Path data"
			rows={4}
			value={draft}
			isInvalid={error !== null}
			errorMessage={error ?? undefined}
			inputClassName="font-fc-mono text-[11px] break-all"
			onChange={(v) => {
				setDraft(v);
				setError(null);
			}}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					setDraft(value);
					setError(null);
				}
			}}
		/>
	);
}
