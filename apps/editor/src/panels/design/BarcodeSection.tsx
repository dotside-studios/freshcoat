import {
	type BarcodeElement,
	type BarcodeProperties,
	type BearerBars,
	defaultQuietZone,
	errorCorrectionRange,
	getBarcodeEncoder,
	isLinearSymbology,
	SYMBOLOGIES,
	type Symbology,
	substitute,
	symbologyLabel,
	type Template,
} from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { ColorInput } from "@freshcoat-js/ui/color";
import { TextField } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Popover } from "@freshcoat-js/ui/popover";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { memo, useMemo, useRef } from "react";
import { Header, ListBoxSection, MenuTrigger } from "react-aria-components";
import { barcodeBoxFor } from "~/doc/factories";
import { listFields } from "~/doc/values";
import { useBarcodeEncoder } from "~/render/barcode";
import { useEditor } from "~/state/hooks";
import BracesIcon from "~icons/mingcute/braces-line";
import { AddButton, RemoveButton, Row } from "./controls";
import { commonValue, type Inspect } from "./field-helpers";

const GROUPS: [string, Symbology[]][] = [
	["1D", SYMBOLOGIES.filter(isLinearSymbology)],
	["2D", SYMBOLOGIES.filter((s) => !isLinearSymbology(s))],
];

const BEARER_BARS: [BearerBars, string][] = [
	["none", "None"],
	["frame", "Frame"],
	["horizontal", "Top and bottom"],
];

const EC_HINT: Partial<Record<Symbology, string>> = {
	pdf417: "Level 0 to 8: each level adds more recovery data",
	aztec: "Share of the symbol given to recovery, 5 to 95%",
};

/** What the encoder says about each layer's value as the preview fills it in,
 *  one entry per distinct message. Empty values are an unfilled field, not an
 *  error, and draw as a skeleton. */
export function barcodeMessages(
	template: Template,
	values: Record<string, unknown>,
	layers: readonly BarcodeElement[],
): string[] {
	const encoder = getBarcodeEncoder();
	if (!encoder) return [];
	const ctx: Record<string, unknown> = {};
	for (const [k, def] of Object.entries(template.fields.properties))
		if (def.default !== undefined) ctx[k] = def.default;
	for (const [k, v] of Object.entries(values))
		if (v !== undefined && v !== null) ctx[k] = v;
	const out = new Set<string>();
	for (const el of layers) {
		const p = el.properties;
		const value = String(substitute(p.value, ctx) ?? "");
		if (value === "") continue;
		const r = encoder(p.symbology, value, {
			errorCorrection: p.errorCorrection,
		});
		if (!r.ok) out.add(r.message);
	}
	return [...out];
}

export const BarcodeSection = memo(function BarcodeSection({
	ins,
}: {
	ins: Inspect;
}) {
	const codes = ins.layers as BarcodeElement[];
	const props = codes.map((e) => e.properties);
	const pick = <T,>(fn: (p: BarcodeProperties) => T) =>
		commonValue(props.map(fn));
	const set = (field: string, patch: Partial<BarcodeProperties>) =>
		ins.setProps(field, () => patch as Record<string, unknown>);

	const encoder = useBarcodeEncoder(ins.template);
	const values = useEditor((s) => s.values);
	const messages = useMemo(
		() =>
			encoder === "ready" ? barcodeMessages(ins.template, values, codes) : [],
		[encoder, ins.template, values, codes],
	);

	const symbology = pick((p) => p.symbology);
	const linear = props.every((p) => isLinearSymbology(p.symbology));
	const range = symbology ? errorCorrectionRange(symbology) : null;
	const showText = pick((p) => p.showText !== false);
	const background = pick((p) => p.background ?? null);
	const quietZone = pick((p) => p.quietZone ?? defaultQuietZone(p.symbology));
	const anyBackground = props.some((p) => p.background);
	const itf14 = props.every((p) => p.symbology === "itf14");
	const bearerBars = pick((p) => p.bearerBars ?? "none");

	const chooseSymbology = (next: Symbology) =>
		ins.set("barcode-symbology", (el) => {
			const code = el as BarcodeElement;
			if (code.properties.symbology === next) return null;
			const box = code.size
				? barcodeBoxFor(
						{ pos: code.pos ?? { x: 0, y: 0 }, size: code.size },
						code.properties.symbology,
						next,
					)
				: null;
			// Quiet zones and recovery are counted in the old symbology's terms.
			return {
				...(box ?? {}),
				properties: {
					symbology: next,
					quietZone: undefined,
					errorCorrection: undefined,
					bearerBars: undefined,
				},
			};
		});

	return (
		<PanelSection title="Barcode">
			<Row label="Type">
				<Select
					aria-label="Barcode type"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={symbology}
					onChange={(v) => chooseSymbology(v as Symbology)}
				>
					{GROUPS.map(([title, items]) => (
						<ListBoxSection key={title} className="flex flex-col">
							<Header className="px-2 pt-1.5 pb-0.5 pl-7 font-semibold text-[10px] text-fc-faint uppercase tracking-wider">
								{title}
							</Header>
							{items.map((s) => (
								<SelectItem key={s} id={s}>
									{symbologyLabel(s)}
								</SelectItem>
							))}
						</ListBoxSection>
					))}
				</Select>
			</Row>
			<ValueField ins={ins} codes={codes} invalid={messages.length > 0} />
			{messages.length > 0 ? (
				<output
					data-testid="barcode-message"
					className="flex flex-col gap-0.5 pl-[60px] text-fc-danger-text text-fc-sm leading-snug"
				>
					{messages.map((m) => (
						<span key={m}>{m}</span>
					))}
				</output>
			) : null}
			{linear ? (
				<>
					<Row label="Text">
						<Checkbox
							isSelected={showText === true}
							isIndeterminate={showText === null}
							onChange={(on) =>
								set("barcode-show-text", { showText: on ? undefined : false })
							}
						>
							Human-readable text
						</Checkbox>
					</Row>
					{showText !== false ? (
						<Row label="Text size">
							<NumberField
								aria-label="Barcode text size"
								className="min-w-0 flex-1"
								min={1}
								value={pick((p) => p.textSize ?? null)}
								placeholder={
									pick((p) => p.textSize ?? 0) === null ? "Mixed" : "Auto"
								}
								onChange={(v) =>
									set("barcode-text-size", { textSize: v > 0 ? v : undefined })
								}
							/>
						</Row>
					) : null}
				</>
			) : null}
			<Row label="Bars">
				<ColorInput
					aria-label="Barcode foreground"
					className="min-w-0 flex-1"
					value={pick((p) => p.foreground ?? "#000000") ?? ""}
					swatches={ins.swatches}
					onChange={(c) => set("barcode-fg", { foreground: c })}
				/>
			</Row>
			<Row label="Behind">
				{anyBackground ? (
					<>
						<ColorInput
							aria-label="Barcode background"
							className="min-w-0 flex-1"
							value={background ?? ""}
							swatches={ins.swatches}
							onChange={(c) => set("barcode-bg", { background: c })}
						/>
						<RemoveButton
							label="Remove background"
							onPress={() => set("barcode-bg", { background: undefined })}
						/>
					</>
				) : (
					<>
						<span className="flex-1 text-fc-faint text-fc-sm">None</span>
						<AddButton
							label="Add background"
							onPress={() => set("barcode-bg", { background: "#ffffff" })}
						/>
					</>
				)}
			</Row>
			<Row label="Margin">
				<NumberField
					aria-label="Quiet zone"
					className="min-w-0 flex-1"
					min={0}
					precision={0}
					unit={quietZone === 1 ? " module" : " modules"}
					value={quietZone}
					onChange={(v) =>
						ins.setProps("barcode-quiet", (el) => {
							const p = (el as BarcodeElement).properties;
							return {
								quietZone: v === defaultQuietZone(p.symbology) ? undefined : v,
							};
						})
					}
				/>
			</Row>
			{itf14 ? (
				<Row label="Bearers">
					<Select
						aria-label="Bearer bars"
						className="min-w-0 flex-1"
						placeholder="Mixed"
						value={bearerBars}
						onChange={(v) =>
							set("barcode-bearers", {
								bearerBars: v === "none" ? undefined : (v as BearerBars),
							})
						}
					>
						{BEARER_BARS.map(([id, label]) => (
							<SelectItem key={id} id={id}>
								{label}
							</SelectItem>
						))}
					</Select>
				</Row>
			) : null}
			{range && symbology ? (
				<>
					<Row label="Recovery">
						<NumberField
							aria-label="Error correction"
							className="min-w-0 flex-1"
							min={range.min}
							max={range.max}
							precision={0}
							unit={symbology === "aztec" ? "%" : undefined}
							placeholder="Auto"
							value={pick((p) => p.errorCorrection ?? null)}
							onChange={(v) =>
								set("barcode-ec", {
									errorCorrection: Math.min(
										range.max,
										Math.max(range.min, Math.round(v)),
									),
								})
							}
						/>
					</Row>
					<p className="m-0 pl-[60px] text-fc-faint text-fc-sm leading-snug">
						{EC_HINT[symbology]}
					</p>
				</>
			) : null}
		</PanelSection>
	);
});

function ValueField({
	ins,
	codes,
	invalid,
}: {
	ins: Inspect;
	codes: BarcodeElement[];
	invalid: boolean;
}) {
	const wrap = useRef<HTMLDivElement>(null);
	const value = commonValue(codes.map((e) => e.properties.value));
	const fields = useMemo(() => listFields(ins.template), [ins.template]);
	const write = (v: string) =>
		ins.setProps("barcode-value", () => ({ value: v }));

	const insertToken = (id: string) => {
		const input = wrap.current?.querySelector("input");
		const current = value ?? "";
		const token = `{{${id}}}`;
		const start = input?.selectionStart ?? current.length;
		const end = input?.selectionEnd ?? current.length;
		write(current.slice(0, start) + token + current.slice(end));
		requestAnimationFrame(() => {
			input?.focus();
			input?.setSelectionRange(start + token.length, start + token.length);
		});
	};

	return (
		<Row label="Value">
			<div ref={wrap} className="flex min-w-0 flex-1 items-center gap-1">
				<TextField
					aria-label="Barcode value"
					className="min-w-0 flex-1"
					isInvalid={invalid}
					placeholder={value === null ? "Mixed" : "Text or {{field}}"}
					value={value ?? ""}
					onChange={write}
				/>
				<MenuTrigger>
					<IconButton
						aria-label="Insert field"
						tooltip="Insert field"
						className="size-5 shrink-0 pointer-coarse:size-8"
						isDisabled={fields.length === 0 || value === null}
					>
						<BracesIcon />
					</IconButton>
					<Popover placement="bottom end">
						<Menu onAction={(k) => insertToken(String(k))}>
							{fields.map((f) => (
								<MenuItem key={f.id} id={f.id} textValue={f.id}>
									{f.field.title ? `${f.field.title} · ${f.id}` : f.id}
								</MenuItem>
							))}
						</Menu>
					</Popover>
				</MenuTrigger>
			</div>
		</Row>
	);
}
