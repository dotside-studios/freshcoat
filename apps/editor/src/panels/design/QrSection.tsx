import {
	MAX_QR_LOGO_SIZE,
	type QrCodeElement,
	type QrCodeProperties,
	type QrFinderInner,
	type QrFinderOuter,
	type QrModuleShape,
} from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { ColorInput } from "@freshcoat-js/ui/color";
import { TextField } from "@freshcoat-js/ui/field";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@freshcoat-js/ui/toggle";
import { useRef } from "react";
import { RemoveButton, Row } from "./controls";
import { commonValue, type Inspect } from "./field-helpers";
import {
	assetSummary,
	attachImageFile,
	fieldSummary,
	ReplaceMenu,
} from "./ImageSection";
import { InsertFieldMenu, spliceToken } from "./InsertFieldMenu";
import { InspectorSection } from "./InspectorSection";

const LEVELS = [
	["L", "Low: 7% of the code can be lost"],
	["M", "Medium: 15%"],
	["Q", "Quartile: 25%"],
	["H", "High: 30%"],
] as const;

const MODULE_SHAPES: [QrModuleShape, string][] = [
	["square", "Square"],
	["dot", "Dots"],
	["rounded", "Rounded"],
	["classy", "Classy"],
];

const FINDER_OUTER: [QrFinderOuter, string][] = [
	["square", "Square"],
	["rounded", "Rounded"],
	["circle", "Circle"],
];

const FINDER_INNER: [QrFinderInner, string][] = [
	["square", "Square"],
	["rounded", "Rounded"],
	["dot", "Dot"],
];

type QrGradient = NonNullable<QrCodeProperties["gradient"]>;
type QrLogo = NonNullable<QrCodeProperties["logo"]>;

const DEFAULT_LOGO_SIZE = 0.2;

/** A two-stop gradient from `from`, or the gradient with one stop recoloured. */
export function withGradientStop(
	gradient: QrGradient | undefined,
	index: 0 | 1,
	color: string,
	from = "#000000",
): QrGradient {
	const base: QrGradient = gradient ?? {
		kind: "linear",
		angle: 0,
		stops: [
			{ offset: 0, color: from },
			{ offset: 1, color: from },
		],
	};
	const stops = base.stops.map((s, i) => (i === index ? { ...s, color } : s));
	return { ...base, stops };
}

export function QrSection({ ins }: { ins: Inspect }) {
	const props = (ins.layers as QrCodeElement[]).map((e) => e.properties);
	const pick = <T,>(fn: (p: QrCodeProperties) => T) =>
		commonValue(props.map(fn));
	const set = (field: string, patch: Partial<QrCodeProperties>) =>
		ins.setProps(field, () => patch as Record<string, unknown>);
	const setEach = (
		field: string,
		fn: (p: QrCodeProperties) => Partial<QrCodeProperties>,
	) =>
		ins.setProps(
			field,
			(el) => fn(el.properties as QrCodeProperties) as Record<string, unknown>,
		);
	const level = pick((p) => p.errorCorrection ?? "M");
	const value = pick((p) => p.value);
	const wrap = useRef<HTMLDivElement>(null);
	const write = (v: string) => set("qr-value", { value: v });
	const gradient = pick((p) => p.gradient !== undefined);
	const logo = pick((p) => p.logo);
	const hasLogo = pick((p) => p.logo !== undefined);
	const logoSrc = logo ? logo.src : null;
	const logoSummary =
		logoSrc === null
			? null
			: (assetSummary(ins.template, logoSrc) ??
				fieldSummary(ins.template, logoSrc));
	const setLogo = (field: string, patch: Partial<QrLogo>) =>
		setEach(field, (p) => ({
			logo: { src: "", ...p.logo, ...patch },
		}));

	return (
		<InspectorSection title="QR code">
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
			<Row label="Modules" keys={["moduleShape"]}>
				<Select
					aria-label="QR module shape"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pick((p) => p.moduleShape ?? "square")}
					onChange={(v) =>
						set("qr-modules", {
							moduleShape: v === "square" ? undefined : (v as QrModuleShape),
						})
					}
				>
					{MODULE_SHAPES.map(([id, label]) => (
						<SelectItem key={id} id={id}>
							{label}
						</SelectItem>
					))}
				</Select>
			</Row>
			<Row label="Eye frame" keys={["finderOuter"]}>
				<Select
					aria-label="QR eye frame"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pick((p) => p.finderOuter ?? "square")}
					onChange={(v) =>
						set("qr-finder-outer", {
							finderOuter: v === "square" ? undefined : (v as QrFinderOuter),
						})
					}
				>
					{FINDER_OUTER.map(([id, label]) => (
						<SelectItem key={id} id={id}>
							{label}
						</SelectItem>
					))}
				</Select>
			</Row>
			<Row label="Eye center" keys={["finderInner"]}>
				<Select
					aria-label="QR eye center"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pick((p) => p.finderInner ?? "square")}
					onChange={(v) =>
						set("qr-finder-inner", {
							finderInner: v === "square" ? undefined : (v as QrFinderInner),
						})
					}
				>
					{FINDER_INNER.map(([id, label]) => (
						<SelectItem key={id} id={id}>
							{label}
						</SelectItem>
					))}
				</Select>
			</Row>
			<Row label="Color" keys={["foreground", "gradient"]}>
				<ColorInput
					aria-label="QR foreground"
					className="min-w-0 flex-1"
					value={
						pick(
							(p) => p.gradient?.stops[0]?.color ?? p.foreground ?? "#000000",
						) ?? ""
					}
					swatches={ins.swatches}
					onChange={(c) =>
						setEach("qr-fg", (p) =>
							p.gradient
								? { gradient: withGradientStop(p.gradient, 0, c) }
								: { foreground: c },
						)
					}
				/>
			</Row>
			<Row label="Gradient" keys={["gradient"]}>
				<Checkbox
					aria-label="QR gradient"
					isSelected={gradient === true}
					isIndeterminate={gradient === null}
					onChange={(on) =>
						setEach("qr-gradient", (p) => ({
							gradient: on
								? withGradientStop(
										undefined,
										1,
										"#1a237e",
										p.foreground ?? "#000000",
									)
								: undefined,
						}))
					}
				/>
			</Row>
			{gradient === true && (
				<>
					<Row label="To" keys={["gradient"]}>
						<ColorInput
							aria-label="QR gradient end"
							className="min-w-0 flex-1"
							value={pick((p) => p.gradient?.stops[1]?.color ?? "") ?? ""}
							swatches={ins.swatches}
							onChange={(c) =>
								setEach("qr-gradient-end", (p) => ({
									gradient: withGradientStop(p.gradient, 1, c),
								}))
							}
						/>
					</Row>
					<Row label="Angle" keys={["gradient"]}>
						<NumberField
							aria-label="QR gradient angle"
							className="min-w-0 flex-1"
							precision={0}
							value={pick((p) => p.gradient?.angle ?? 0)}
							onChange={(v) =>
								setEach("qr-gradient-angle", (p) => ({
									gradient: p.gradient && { ...p.gradient, angle: v },
								}))
							}
						/>
					</Row>
				</>
			)}
			<Row label="Behind" keys={["background"]}>
				<ColorInput
					aria-label="QR background"
					className="min-w-0 flex-1"
					value={pick((p) => p.background ?? "#ffffff") ?? ""}
					swatches={ins.swatches}
					onChange={(c) => set("qr-bg", { background: c })}
				/>
			</Row>
			<Row label="Quiet zone" keys={["quietZone"]}>
				<NumberField
					aria-label="QR quiet zone"
					className="min-w-0 flex-1"
					min={0}
					max={20}
					precision={0}
					value={pick((p) => p.quietZone ?? 0)}
					onChange={(v) =>
						set("qr-quiet-zone", { quietZone: v === 0 ? undefined : v })
					}
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
			<Row label="Logo" keys={["logo"]}>
				<span
					className="flex h-fc-control min-w-0 flex-1 items-center truncate rounded-[3px] bg-fc-raised px-1.5 text-fc-muted"
					data-testid="qr-logo-summary"
				>
					{hasLogo === null ? "Mixed" : (logoSummary ?? logoSrc ?? "None")}
				</span>
				{hasLogo === true && (
					<RemoveButton
						label="Remove logo"
						onPress={() => set("qr-logo", { logo: undefined })}
					/>
				)}
			</Row>
			<Row label="">
				<ReplaceMenu
					template={ins.template}
					src={logoSrc}
					onFile={(file) =>
						void attachImageFile(ins, file, (src, el) => ({
							properties: {
								logo: { ...(el.properties as QrCodeProperties).logo, src },
							},
						}))
					}
					onSource={(src) => setLogo("qr-logo-src", { src })}
				/>
			</Row>
			{hasLogo === true && (
				<>
					<Row label="Logo size" keys={["logo"]}>
						<NumberField
							aria-label="QR logo size"
							className="min-w-0 flex-1"
							min={5}
							max={Math.round(MAX_QR_LOGO_SIZE * 100)}
							precision={0}
							unit="%"
							value={pick((p) =>
								Math.round((p.logo?.size ?? DEFAULT_LOGO_SIZE) * 100),
							)}
							onChange={(v) =>
								setLogo("qr-logo-size", { size: Math.max(0.05, v / 100) })
							}
						/>
					</Row>
					<Row label="Logo padding" keys={["logo"]}>
						<NumberField
							aria-label="QR logo padding"
							className="min-w-0 flex-1"
							min={0}
							max={10}
							precision={0}
							value={pick((p) => p.logo?.padding ?? 1)}
							onChange={(v) => setLogo("qr-logo-padding", { padding: v })}
						/>
					</Row>
				</>
			)}
		</InspectorSection>
	);
}
