import {
	type ImageElement,
	type ImageProperties,
	parseAssetUri,
	type Template,
} from "@freshcoat/coatfile";
import { Button } from "@freshcoat/ui/button";
import { TextField } from "@freshcoat/ui/field";
import { NumberField } from "@freshcoat/ui/number-field";
import { PanelSection } from "@freshcoat/ui/panel";
import { Select, SelectItem } from "@freshcoat/ui/select";
import { toast } from "@freshcoat/ui/toast";
import { useEffect, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { formatBytes } from "~/app/format";
import { attachImageAsset } from "~/doc/ops";
import { getElement } from "~/doc/path";
import UploadIcon from "~icons/mingcute/upload-2-line";
import { Pair, Row, sectionActions } from "./controls";
import { commonValue, type Inspect, patchLayers } from "./field-helpers";

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
					<SrcField value={src} onCommit={(v) => setImage("src", { src: v })} />
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

function SrcField({
	value,
	onCommit,
}: {
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
	);
}
