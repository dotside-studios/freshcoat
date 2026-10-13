import {
	compactInsets,
	resolveInsets,
	type Sides,
	type Template,
	variantSize,
} from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { useRef, useState } from "react";
import { useController } from "~/app/context";
import { INSETS } from "~/app/copy";
import { useDisplayUnit } from "~/app/units";
import { wholePx } from "~/doc/new-document";
import { resizeTemplate, setTemplateInsets, setVariantSize } from "~/doc/ops";
import { resizeWithConstraints } from "~/doc/resize";
import { activeVariantId } from "~/doc/variant-edit";
import { LengthField } from "~/panels/design/LengthField";
import { useEditor } from "~/state/hooks";
import { present } from "~/state/store";
import LinkIcon from "~icons/mingcute/link-line";
import UnlinkIcon from "~icons/mingcute/unlink-line";

const MAX_SIDE = 16384;

/** Width, height, lock ratio and resize with constraints. */
export function SizeSection({ template }: { template: Template }) {
	const [locked, setLocked] = useState(false);
	const [constrained, setConstrained] = useState(false);
	const ratio = useRef(template.width / template.height);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<span className="w-16 shrink-0 truncate text-fc-muted text-fc-sm">
					Size
				</span>
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<TemplateSizeFields
						template={template}
						constrained={constrained}
						ratio={locked ? ratio.current : undefined}
					/>
					<ToggleButton
						aria-label="Lock aspect ratio"
						tooltip={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
						isSelected={locked}
						onChange={(on) => {
							ratio.current = template.width / template.height;
							setLocked(on);
						}}
					>
						{locked ? <LinkIcon /> : <UnlinkIcon />}
					</ToggleButton>
				</div>
			</div>
			<Checkbox
				className="ml-18"
				isSelected={constrained}
				onChange={setConstrained}
			>
				Resize with constraints
			</Checkbox>
			{(["bleed", "safeArea"] as const).map((key) => (
				<div key={key} className="flex items-center gap-2">
					<span className="w-16 shrink-0 truncate text-fc-muted text-fc-sm">
						{INSETS[key]}
					</span>
					<TemplateInsets
						template={template}
						inset={key}
						className="min-w-0 flex-1"
					/>
				</div>
			))}
		</div>
	);
}

const SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * The template's bleed or safe area: one value for every side while linked,
 * else a field per side. Sides set apart in the file start unlinked; linked,
 * they show as mixed until a value is typed. Linking or unlinking alone
 * leaves the file as it is.
 */
export function TemplateInsets({
	template,
	inset,
	className,
}: {
	template: Template;
	inset: "bleed" | "safeArea";
	className?: string;
}) {
	const controller = useController();
	const [choice, setChoice] = useState<boolean>();
	const sides = resolveInsets(template[inset]);
	const compact = compactInsets(sides);
	const linked = choice ?? typeof compact === "number";
	const label = inset === "bleed" ? INSETS.bleedLabel : INSETS.safeAreaLabel;
	const set = (value: (t: Template) => number | Sides, mergeKey: string) =>
		controller.edit((t) => setTemplateInsets(t, inset, value(t)), {
			mergeKey,
			scope: "base",
		});

	return (
		<div className={cn("flex items-start gap-1", className)}>
			{linked ? (
				<LengthField
					aria-label={label}
					className="min-w-0 flex-1"
					value={typeof compact === "number" ? compact : null}
					placeholder={INSETS.mixed}
					min={0}
					max={MAX_SIDE}
					onChange={(n) => set(() => n, inset)}
				/>
			) : (
				<div
					className="grid min-w-0 flex-1 grid-cols-2 gap-1"
					data-testid={`${inset}-sides`}
				>
					{SIDES.map((side) => (
						<LengthField
							key={side}
							label={INSETS.sides[side]}
							aria-label={`${label} ${INSETS.sideNames[side]}`}
							className="min-w-0"
							value={sides[side]}
							min={0}
							max={MAX_SIDE}
							onChange={(n) =>
								set(
									(t) => ({ ...resolveInsets(t[inset]), [side]: n }),
									`${inset}.${side}`,
								)
							}
						/>
					))}
				</div>
			)}
			<ToggleButton
				aria-label={`Link ${inset === "bleed" ? "bleed" : "safe area"} sides`}
				tooltip={linked ? INSETS.unlink : INSETS.link}
				isSelected={linked}
				onChange={setChoice}
			>
				{linked ? <LinkIcon /> : <UnlinkIcon />}
			</ToggleButton>
		</div>
	);
}

/** The active variant when it has its own size, else undefined. */
export function useSizedVariant(): string | undefined {
	return useEditor((s) => {
		const t = present(s);
		const id = t ? activeVariantId(t, s.variantId) : undefined;
		return id !== undefined && t?.variants?.some((v) => v.id === id && v.size)
			? id
			: undefined;
	});
}

/**
 * The template's W and H fields, or the active variant's when it has its own
 * size. Every side shares the size, so this is the same edit wherever it is
 * shown: one undo step per run of changes.
 */
export function TemplateSizeFields({
	template,
	constrained = false,
	ratio,
}: {
	template: Template;
	/** Layers follow their constraints instead of staying where they are. */
	constrained?: boolean;
	/** Width over height to keep, when the ratio is locked. */
	ratio?: number;
}) {
	const controller = useController();
	const unit = useDisplayUnit();
	const sized = useSizedVariant();
	const base = useEditor(present);
	const shown = sized && base ? variantSize(base, sized) : template;
	const resize = (w: number, h: number) =>
		controller.edit(
			(t) =>
				sized
					? setVariantSize(t, sized, { width: w, height: h })
					: constrained
						? resizeWithConstraints(t, w, h)
						: resizeTemplate(t, w, h),
			{ mergeKey: "resize", scope: "base" },
		);

	return (
		<>
			<LengthField
				label="W"
				aria-label={sized ? "Variant width" : "Template width"}
				className="min-w-0 flex-1"
				value={shown.width}
				min={1}
				max={MAX_SIDE}
				onChange={(v) => {
					const w = clampSide(wholePx(v, unit));
					resize(w, ratio ? clampSide(Math.round(w / ratio)) : shown.height);
				}}
			/>
			<LengthField
				label="H"
				aria-label={sized ? "Variant height" : "Template height"}
				className="min-w-0 flex-1"
				value={shown.height}
				min={1}
				max={MAX_SIDE}
				onChange={(v) => {
					const h = clampSide(wholePx(v, unit));
					resize(ratio ? clampSide(Math.round(h * ratio)) : shown.width, h);
				}}
			/>
		</>
	);
}

function clampSide(n: number): number {
	return Math.min(MAX_SIDE, Math.max(1, n));
}
