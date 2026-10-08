import {
	type ImageCrop,
	type ImageElement,
	type ImageProperties,
	parseAssetUri,
	parseImageFocus,
	type Template,
} from "@freshcoat-js/coatfile";
import { Button } from "@freshcoat-js/ui/button";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { TextField } from "@freshcoat-js/ui/field";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { toast } from "@freshcoat-js/ui/toast";
import { useEffect, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { formatBytes } from "~/app/format";
import { attachImageAsset } from "~/doc/ops";
import { getElement } from "~/doc/path";
import UploadIcon from "~icons/mingcute/upload-2-line";
import { Pair, Row, sectionActions } from "./controls";
import {
	commonValue,
	focusFieldOf,
	type Inspect,
	patchLayers,
} from "./field-helpers";
import { InsertFieldMenu } from "./InsertFieldMenu";

type Mask = NonNullable<ImageProperties["mask"]>;
type MaskKind =
	| "none"
	| "circle"
	| "ellipse"
	| "rounded-rect"
	| "squircle"
	| "polygon";

const MASKS: [MaskKind, string][] = [
	["none", "None"],
	["circle", "Circle"],
	["ellipse", "Ellipse"],
	["rounded-rect", "Rounded"],
	["squircle", "Squircle"],
	["polygon", "Polygon"],
];

const FITS = ["cover", "contain", "fill", "tile"] as const;

export function maskKind(m: Mask | undefined): MaskKind {
	if (m === undefined) return "none";
	return typeof m === "string" ? m : m.kind;
}

export function defaultMask(kind: MaskKind): Mask | undefined {
	switch (kind) {
		case "none":
			return undefined;
		case "circle":
		case "ellipse":
			return kind;
		case "rounded-rect":
		case "squircle":
			return { kind, radius: 16 };
		case "polygon":
			return { kind, sides: 6 };
	}
}

const FIXED_FOCUS = "__fixed";

/** A focal point in percent, the centre when unset or bound to a field. */
export function focusPercent(focus: ImageProperties["focus"]): {
	x: number;
	y: number;
} {
	const f = parseImageFocus(focus) ?? { x: 0.5, y: 0.5 };
	return { x: Math.round(f.x * 1000) / 10, y: Math.round(f.y * 1000) / 10 };
}

/** The focus a percent point writes: none at the centre. */
export function focusFromPercent(
	x: number,
	y: number,
): [number, number] | undefined {
	if (x === 50 && y === 50) return undefined;
	const clamp = (v: number) => Math.min(Math.max(v, 0), 100) / 100;
	return [clamp(x), clamp(y)];
}

export const FULL_CROP: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };

/** The crop with one edge moved, kept inside the image: an offset pulls the
 *  size in, and a size stops at the far edge. */
export function setCropValue(
	crop: ImageCrop,
	key: keyof ImageCrop,
	percent: number,
): ImageCrop {
	const v = Math.min(Math.max(percent, 0), 100) / 100;
	const next = { ...crop, [key]: v };
	if (key === "x") next.width = Math.min(next.width, 1 - v);
	if (key === "y") next.height = Math.min(next.height, 1 - v);
	if (key === "width") next.width = Math.max(0.01, Math.min(v, 1 - next.x));
	if (key === "height") next.height = Math.max(0.01, Math.min(v, 1 - next.y));
	if (next.width <= 0) next.width = 0.01;
	if (next.height <= 0) next.height = 0.01;
	if (next.x + next.width > 1) next.x = 1 - next.width;
	if (next.y + next.height > 1) next.y = 1 - next.height;
	return next;
}

/** "Embedded · PNG · 24 kB" for an `asset:` src, or null for anything else. */
export function assetSummary(t: Template, src: string): string | null {
	const sha = parseAssetUri(src);
	if (!sha) return null;
	const asset = t.assets?.find((a) => a.sha256 === sha);
	if (!asset) return "Embedded · missing";
	const type = asset.contentType.split("/")[1]?.split("+")[0]?.toUpperCase();
	const bytes = Math.floor((asset.base64.replace(/=+$/, "").length * 3) / 4);
	return `Embedded · ${type ?? "image"} · ${formatBytes(bytes)}`;
}

export function ImageSection({
	ins,
	background = false,
}: {
	ins: Inspect;
	background?: boolean;
}) {
	const props = (ins.layers as ImageElement[]).map((e) => e.properties);
	const src = commonValue(props.map((p) => p.src));
	const fit = commonValue(props.map((p) => p.fit));
	const masks = props.map((p) => p.mask);
	const kind = commonValue(masks.map(maskKind));
	const mask = commonValue(masks);
	const summary = src === null ? null : assetSummary(ins.template, src);

	const setImage = (field: string, patch: Partial<ImageProperties>) =>
		ins.setProps(field, () => patch as Record<string, unknown>);

	const replace = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;
		const bytes = new Uint8Array(await file.arrayBuffer());
		const current = ins.controller.template;
		if (!current) return;
		const attached = await attachImageAsset(
			current,
			bytes,
			file.type || "image/png",
		);
		const sha = parseAssetUri(attached.src);
		const asset = attached.template.assets?.find((a) => a.sha256 === sha);
		const r = ins.controller.edit((t) => {
			const base =
				asset && !t.assets?.some((a) => a.sha256 === sha)
					? { ...t, assets: [...(t.assets ?? []), asset] }
					: t;
			return patchLayers(
				base,
				ins.keys,
				() => ({ properties: { src: attached.src } }),
				getElement,
			);
		});
		if (!r?.ok) toast("Couldn't add that image", { tone: "danger" });
	};

	return (
		<PanelSection
			title={background ? "Background image" : "Image"}
			actions={background ? sectionActions(["src"]) : undefined}
		>
			<Row label="Source" keys={["src"]}>
				{summary ? (
					<span
						className="flex h-fc-control min-w-0 flex-1 items-center truncate rounded-[3px] bg-fc-raised px-1.5 text-fc-muted"
						data-testid="image-asset-summary"
					>
						{summary}
					</span>
				) : (
					<SrcField
						template={ins.template}
						value={src}
						onCommit={(v) => setImage("src", { src: v })}
					/>
				)}
			</Row>
			<Row label="">
				<FileTrigger
					acceptedFileTypes={[
						"image/png",
						"image/jpeg",
						"image/webp",
						"image/gif",
					]}
					onSelect={(files) => void replace(files)}
				>
					<Button size="md" className="flex-1">
						<UploadIcon />
						Replace…
					</Button>
				</FileTrigger>
			</Row>
			<Row label="Fit" keys={["fit"]}>
				<Select
					aria-label="Image fit"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={fit}
					onChange={(v) =>
						setImage("fit", { fit: v as ImageProperties["fit"] })
					}
				>
					{FITS.map((f) => (
						<SelectItem key={f} id={f}>
							{f[0].toUpperCase() + f.slice(1)}
						</SelectItem>
					))}
				</Select>
			</Row>
			{fit === "cover" && <FocusRows ins={ins} />}
			{fit !== null && fit !== "tile" && <CropRows ins={ins} />}
			{!background && (
				<>
					<Row label="Mask" keys={["mask"]}>
						<Select
							aria-label="Image mask"
							className="min-w-0 flex-1"
							placeholder="Mixed"
							value={kind}
							onChange={(v) =>
								setImage("mask", { mask: defaultMask(v as MaskKind) })
							}
						>
							{MASKS.map(([id, name]) => (
								<SelectItem key={id} id={id}>
									{name}
								</SelectItem>
							))}
						</Select>
					</Row>
					{mask && typeof mask === "object" && (
						<MaskParams
							mask={mask}
							onChange={(m) => setImage("mask-params", { mask: m })}
						/>
					)}
				</>
			)}
		</PanelSection>
	);
}

function FocusRows({ ins }: { ins: Inspect }) {
	const props = (ins.layers as ImageElement[]).map((e) => e.properties);
	const focuses = props.map((p) => p.focus);
	const source = commonValue(
		focuses.map((f) => focusFieldOf(f) ?? FIXED_FOCUS),
	);
	const point = commonValue(focuses.map(focusPercent));
	const fields = Object.entries(ins.template.fields.properties);
	const write = (x: number, y: number) =>
		ins.setProps("focus", () => ({ focus: focusFromPercent(x, y) }));

	return (
		<>
			<Row label="Focus" keys={["focus"]}>
				<Select
					aria-label="Focus source"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={source}
					onChange={(v) =>
						ins.setProps("focus-source", () => ({
							focus: v === FIXED_FOCUS ? undefined : `{{${String(v)}}}`,
						}))
					}
				>
					<SelectItem id={FIXED_FOCUS}>Fixed point</SelectItem>
					{fields.map(([key, def]) => (
						<SelectItem key={key} id={key}>
							{def.title ?? key}
						</SelectItem>
					))}
				</Select>
			</Row>
			{source === FIXED_FOCUS && (
				<Row label="">
					<Pair className="flex-1">
						<NumberField
							label="X"
							aria-label="Focus X"
							unit="%"
							min={0}
							max={100}
							precision={1}
							value={point?.x ?? null}
							onChange={(v) => write(v, point?.y ?? 50)}
						/>
						<NumberField
							label="Y"
							aria-label="Focus Y"
							unit="%"
							min={0}
							max={100}
							precision={1}
							value={point?.y ?? null}
							onChange={(v) => write(point?.x ?? 50, v)}
						/>
					</Pair>
				</Row>
			)}
		</>
	);
}

const CROP_FIELDS: [keyof ImageCrop, string, string][] = [
	["x", "X", "Crop X"],
	["y", "Y", "Crop Y"],
	["width", "W", "Crop width"],
	["height", "H", "Crop height"],
];

function CropRows({ ins }: { ins: Inspect }) {
	const crops = (ins.layers as ImageElement[]).map((e) => e.properties.crop);
	const on = commonValue(crops.map((c) => c !== undefined));
	const common = commonValue(crops);
	return (
		<>
			<Row label="Crop" keys={["crop"]}>
				<Checkbox
					isSelected={on === true}
					isIndeterminate={on === null}
					onChange={(v) =>
						ins.setProps("crop-toggle", (el) => {
							const current = (el as ImageElement).properties.crop;
							if (v) return current ? null : { crop: FULL_CROP };
							return { crop: undefined };
						})
					}
				>
					Crop image
				</Checkbox>
			</Row>
			{on === true &&
				[CROP_FIELDS.slice(0, 2), CROP_FIELDS.slice(2)].map((pair) => (
					<Row key={pair[0][0]} label="">
						<Pair className="flex-1">
							{pair.map(([key, label, aria]) => (
								<NumberField
									key={key}
									label={label}
									aria-label={aria}
									unit="%"
									min={key === "width" || key === "height" ? 1 : 0}
									max={100}
									precision={1}
									value={common ? Math.round(common[key] * 1000) / 10 : null}
									onChange={(v) =>
										ins.setProps(`crop-${key}`, (el) => {
											const c = (el as ImageElement).properties.crop;
											return c ? { crop: setCropValue(c, key, v) } : null;
										})
									}
								/>
							))}
						</Pair>
					</Row>
				))}
		</>
	);
}

function MaskParams({
	mask,
	onChange,
}: {
	mask: Exclude<Mask, string>;
	onChange: (m: Mask) => void;
}) {
	if (mask.kind === "polygon")
		return (
			<Row label="">
				<Pair className="flex-1">
					<NumberField
						label="Sides"
						aria-label="Polygon sides"
						min={3}
						max={64}
						precision={0}
						value={mask.sides}
						onChange={(v) => onChange({ ...mask, sides: Math.round(v) })}
					/>
					<NumberField
						label="∠"
						aria-label="Polygon rotation"
						unit="°"
						value={mask.rotation ?? 0}
						onChange={(v) =>
							onChange({ ...mask, rotation: v === 0 ? undefined : v })
						}
					/>
				</Pair>
			</Row>
		);
	return (
		<Row label="">
			<NumberField
				label="R"
				aria-label="Mask radius"
				className="min-w-0 flex-1"
				min={0}
				value={mask.radius}
				onChange={(v) => onChange({ ...mask, radius: v })}
			/>
		</Row>
	);
}

const IMAGE_FORMATS = ["image", "url"] as const;

function SrcField({
	template,
	value,
	onCommit,
}: {
	template: Template;
	value: string | null;
	onCommit: (v: string) => void;
}) {
	const shown = value ?? "";
	const [draft, setDraft] = useState(shown);
	useEffect(() => setDraft(shown), [shown]);
	const commit = () => {
		const v = draft.trim();
		if (v && v !== shown) onCommit(v);
		else setDraft(shown);
	};
	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<TextField
				aria-label="Image source"
				className="min-w-0 flex-1"
				placeholder={value === null ? "Mixed" : "https://… or {{field}}"}
				value={draft}
				onChange={setDraft}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") setDraft(shown);
				}}
			/>
			<InsertFieldMenu
				template={template}
				prefer={IMAGE_FORMATS}
				onInsert={(id) => onCommit(`{{${id}}}`)}
			/>
		</div>
	);
}
