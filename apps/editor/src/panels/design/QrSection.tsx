import type { QrCodeElement, QrCodeProperties } from "@freshcoat-js/coatfile";
import { ColorInput } from "@freshcoat-js/ui/color";
import { TextField } from "@freshcoat-js/ui/field";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { ToggleGroup, ToggleGroupItem } from "@freshcoat-js/ui/toggle";
import { useRef } from "react";
import { Row } from "./controls";
import { commonValue, type Inspect } from "./field-helpers";
import { InsertFieldMenu, spliceToken } from "./InsertFieldMenu";

const LEVELS = [
	["L", "Low: 7% of the code can be lost"],
	["M", "Medium: 15%"],
	["Q", "Quartile: 25%"],
	["H", "High: 30%"],
] as const;

export function QrSection({ ins }: { ins: Inspect }) {
	const props = (ins.layers as QrCodeElement[]).map((e) => e.properties);
	const pick = <T,>(fn: (p: QrCodeProperties) => T) =>
		commonValue(props.map(fn));
	const set = (field: string, patch: Partial<QrCodeProperties>) =>
		ins.setProps(field, () => patch as Record<string, unknown>);
	const level = pick((p) => p.errorCorrection ?? "M");
	const value = pick((p) => p.value);
	const wrap = useRef<HTMLDivElement>(null);
	const write = (v: string) => set("qr-value", { value: v });

	return (
		<PanelSection title="QR code">
			<Row label="Value" keys={["value"]}>
				<div ref={wrap} className="flex min-w-0 flex-1 items-center gap-1">
					<TextField
						aria-label="QR value"
						className="min-w-0 flex-1"
						placeholder={value === null ? "Mixed" : "https://… or {{field}}"}
						value={value ?? ""}
						onChange={write}
					/>
					<InsertFieldMenu
						template={ins.template}
						isDisabled={value === null}
						onInsert={(id) =>
							spliceToken(
								wrap.current?.querySelector("input"),
								value ?? "",
								id,
								write,
							)
						}
					/>
				</div>
			</Row>
			<Row label="Recovery" keys={["errorCorrection"]}>
				<ToggleGroup
					aria-label="Error correction"
					className="flex-1"
					selectedKeys={level ? [level] : []}
					onSelectionChange={(k) => {
						const v = [...k][0] as QrCodeProperties["errorCorrection"];
						set("qr-ec", { errorCorrection: v });
					}}
				>
					{LEVELS.map(([id, tip]) => (
						<ToggleGroupItem key={id} id={id} tooltip={tip}>
							{id}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Row>
			<Row label="Color" keys={["foreground"]}>
				<ColorInput
					aria-label="QR foreground"
					className="min-w-0 flex-1"
					value={pick((p) => p.foreground ?? "#000000") ?? ""}
					swatches={ins.swatches}
					onChange={(c) => set("qr-fg", { foreground: c })}
				/>
			</Row>
			<Row label="Behind" keys={["background"]}>
				<ColorInput
					aria-label="QR background"
					className="min-w-0 flex-1"
					value={pick((p) => p.background ?? "#ffffff") ?? ""}
					swatches={ins.swatches}
					onChange={(c) => set("qr-bg", { background: c })}
				/>
			</Row>
			<Row label="Margin" keys={["margin"]}>
				<NumberField
					aria-label="QR margin"
					className="min-w-0 flex-1"
					min={0}
					precision={0}
					value={pick((p) => p.margin ?? 0)}
					onChange={(v) =>
						set("qr-margin", { margin: v === 0 ? undefined : v })
					}
				/>
			</Row>
		</PanelSection>
	);
}
