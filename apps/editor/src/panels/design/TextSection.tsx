import type { TextElement, TextProperties } from "@freshcoat-js/coatfile";
import { Button } from "@freshcoat-js/ui/button";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { TextArea } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { ChevronDownIcon } from "@freshcoat-js/ui/icons";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Popover } from "@freshcoat-js/ui/popover";
import { Select, SelectItem, triggerButton } from "@freshcoat-js/ui/select";
import { toast } from "@freshcoat-js/ui/toast";
import {
	ToggleButton,
	ToggleGroup,
	ToggleGroupItem,
} from "@freshcoat-js/ui/toggle";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button as AriaButton, MenuTrigger } from "react-aria-components";
import { plural } from "~/app/copy";
import { addFont } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { listFields } from "~/doc/values";
import { applyFontPick, templateFamilies } from "~/fonts/apply";
import { type FontPick, FontPicker } from "~/fonts/FontPicker";
import AlignBottomIcon from "~icons/mingcute/align-bottom-line";
import AlignCenterIcon from "~icons/mingcute/align-center-line";
import AlignJustifyIcon from "~icons/mingcute/align-justify-line";
import AlignLeftIcon from "~icons/mingcute/align-left-line";
import AlignRightIcon from "~icons/mingcute/align-right-line";
import AlignTopIcon from "~icons/mingcute/align-top-line";
import AlignMiddleIcon from "~icons/mingcute/align-vertical-center-line";
import BracesIcon from "~icons/mingcute/braces-line";
import ItalicIcon from "~icons/mingcute/italic-line";
import LetterSpacingIcon from "~icons/mingcute/letter-spacing-line";
import LineHeightIcon from "~icons/mingcute/line-height-line";
import StrikeIcon from "~icons/mingcute/strikethrough-line";
import UnderlineIcon from "~icons/mingcute/underline-line";
import { OverrideMarker, Row } from "./controls";
import { commonValue, type Inspect, patchLayers } from "./field-helpers";
import { isDeclared, verifyGoogleFamily, WEIGHTS } from "./fonts";

type Font = TextProperties["font"];

export const FOCUS_TEXT_EVENT = "freshcoat:focus-text";

const CASES = [
	["original", "As typed"],
	["upper", "UPPERCASE"],
	["lower", "lowercase"],
	["title", "Title Case"],
] as const;

const DIRECTIONS = [
	["ltr", "Left to right"],
	["rtl", "Right to left"],
	["auto", "From the text"],
] as const;

const LAST_LINE = [
	["start", "Start"],
	["end", "End"],
	["left", "Left"],
	["center", "Center"],
	["right", "Right"],
	["justify", "Justify"],
] as const;

const FITS = [
	["none", "Overflow"],
	["shrink", "Shrink to fit"],
	["clip", "Clip"],
] as const;

function cleanFont(f: Font): Font {
	const out = { ...f } as Record<string, unknown>;
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as Font;
}

/** Family, weight, size, spacing and style all live in `font`. */
const FONT = ["font"];

export function TextSection({ ins }: { ins: Inspect }) {
	const texts = ins.layers as TextElement[];
	const props = texts.map((e) => e.properties);
	const fonts = props.map((p) => p.font);
	const pick = <T,>(fn: (p: TextProperties) => T) => commonValue(props.map(fn));
	const pickFont = <T,>(fn: (f: Font) => T) => commonValue(fonts.map(fn));

	const setText = (
		field: string,
		fn: (p: TextProperties) => Record<string, unknown>,
	) => ins.setProps(field, (el) => fn((el as TextElement).properties));
	const setFont = (field: string, patch: Partial<Font>) =>
		setText(field, (p) => ({ font: cleanFont({ ...p.font, ...patch }) }));

	const lineHeight = pickFont((f) => f.lineHeight ?? 1.2);
	const decoration = pickFont((f) => f.decoration ?? "none");

	return (
		<PanelSection title="Text">
			<ContentField ins={ins} texts={texts} />
			<Row label="Font" keys={FONT}>
				<FontFamilyField ins={ins} value={pickFont((f) => f.family)} />
			</Row>
			<Row label="Weight" keys={FONT}>
				<Select
					aria-label="Font weight"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pickFont((f) => String(f.weight ?? 400))}
					onChange={(v) =>
						setFont("font-weight", {
							weight:
								Number(v) === 400 ? undefined : (Number(v) as Font["weight"]),
						})
					}
				>
					{WEIGHTS.map(([w, name]) => (
						<SelectItem key={w} id={String(w)} textValue={name}>
							{name} · {w}
						</SelectItem>
					))}
				</Select>
				<NumberField
					label="Size"
					aria-label="Font size"
					className="w-[76px] shrink-0"
					min={1}
					value={pickFont((f) => f.size)}
					onChange={(v) => setFont("font-size", { size: v })}
				/>
			</Row>
			<Row label="Spacing" keys={FONT}>
				<NumberField
					label={<LineHeightIcon />}
					aria-label="Line height"
					className="min-w-0 flex-1"
					step={0.05}
					min={0}
					value={typeof lineHeight === "number" ? lineHeight : null}
					placeholder={lineHeight === "auto" ? "Auto" : "Mixed"}
					onChange={(v) => setFont("line-height", { lineHeight: v })}
				/>
				<ToggleButton
					shape="text"
					aria-label="Automatic line height"
					tooltip="Use the font's own line height"
					isSelected={lineHeight === "auto"}
					onChange={(on) =>
						setFont("line-height", { lineHeight: on ? "auto" : undefined })
					}
				>
					Auto
				</ToggleButton>
				<NumberField
					label={<LetterSpacingIcon />}
					aria-label="Letter spacing"
					className="min-w-0 flex-1"
					step={0.1}
					value={pickFont((f) => f.letterSpacing ?? 0)}
					onChange={(v) =>
						setFont("letter-spacing", {
							letterSpacing: v === 0 ? undefined : v,
						})
					}
				/>
			</Row>
			<Row label="Align" keys={["align", "verticalAlign"]}>
				<ToggleGroup
					aria-label="Text align"
					selectedKeys={keysOf(pick((p) => p.align ?? "left"))}
					onSelectionChange={(k) => {
						const v = [...k][0] as TextProperties["align"];
						setText("align", () => ({ align: v === "left" ? undefined : v }));
					}}
				>
					<ToggleGroupItem
						id="left"
						aria-label="Align left"
						tooltip="Align left"
					>
						<AlignLeftIcon />
					</ToggleGroupItem>
					<ToggleGroupItem
						id="center"
						aria-label="Align center"
						tooltip="Align center"
					>
						<AlignCenterIcon />
					</ToggleGroupItem>
					<ToggleGroupItem
						id="right"
						aria-label="Align right"
						tooltip="Align right"
					>
						<AlignRightIcon />
					</ToggleGroupItem>
					<ToggleGroupItem id="justify" aria-label="Justify" tooltip="Justify">
						<AlignJustifyIcon />
					</ToggleGroupItem>
				</ToggleGroup>
				<ToggleGroup
					aria-label="Vertical align"
					className="ml-auto"
					selectedKeys={keysOf(pick((p) => p.verticalAlign ?? "top"))}
					onSelectionChange={(k) => {
						const v = [...k][0] as TextProperties["verticalAlign"];
						setText("valign", () => ({
							verticalAlign: v === "top" ? undefined : v,
						}));
					}}
				>
					<ToggleGroupItem id="top" aria-label="Align top" tooltip="Align top">
						<AlignTopIcon />
					</ToggleGroupItem>
					<ToggleGroupItem
						id="middle"
						aria-label="Align middle"
						tooltip="Align middle"
					>
						<AlignMiddleIcon />
					</ToggleGroupItem>
					<ToggleGroupItem
						id="bottom"
						aria-label="Align bottom"
						tooltip="Align bottom"
					>
						<AlignBottomIcon />
					</ToggleGroupItem>
				</ToggleGroup>
			</Row>
			{pick((p) => p.align) === "justify" && (
				<Row label="Last line" keys={["alignLast"]}>
					<Select
						aria-label="Last line alignment"
						className="min-w-0 flex-1"
						placeholder="Mixed"
						value={pick((p) => p.alignLast ?? "start")}
						onChange={(v) =>
							setText("align-last", () => ({
								alignLast:
									v === "start"
										? undefined
										: (v as TextProperties["alignLast"]),
							}))
						}
					>
						{LAST_LINE.map(([id, name]) => (
							<SelectItem key={id} id={id}>
								{name}
							</SelectItem>
						))}
					</Select>
				</Row>
			)}
			<Row label="Direction" keys={["direction"]}>
				<Select
					aria-label="Text direction"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pick((p) => p.direction ?? "ltr")}
					onChange={(v) =>
						setText("direction", () => ({
							direction:
								v === "ltr" ? undefined : (v as TextProperties["direction"]),
						}))
					}
				>
					{DIRECTIONS.map(([id, name]) => (
						<SelectItem key={id} id={id}>
							{name}
						</SelectItem>
					))}
				</Select>
			</Row>
			<Row label="Style" keys={FONT}>
				<ToggleButton
					aria-label="Italic"
					tooltip="Italic"
					isSelected={pickFont((f) => f.style === "italic") === true}
					onChange={(on) =>
						setFont("font-style", { style: on ? "italic" : undefined })
					}
				>
					<ItalicIcon />
				</ToggleButton>
				<ToggleButton
					aria-label="Underline"
					tooltip="Underline"
					isSelected={decoration === "underline"}
					onChange={(on) =>
						setFont("decoration", { decoration: on ? "underline" : undefined })
					}
				>
					<UnderlineIcon />
				</ToggleButton>
				<ToggleButton
					aria-label="Strikethrough"
					tooltip="Strikethrough"
					isSelected={decoration === "line-through"}
					onChange={(on) =>
						setFont("decoration", {
							decoration: on ? "line-through" : undefined,
						})
					}
				>
					<StrikeIcon />
				</ToggleButton>
			</Row>
			<Row label="Case" keys={["case"]}>
				<Select
					aria-label="Case"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pick((p) => p.case ?? "original")}
					onChange={(v) =>
						setText("case", () => ({
							case:
								v === "original" ? undefined : (v as TextProperties["case"]),
						}))
					}
				>
					{CASES.map(([id, name]) => (
						<SelectItem key={id} id={id}>
							{name}
						</SelectItem>
					))}
				</Select>
			</Row>
			<Row label="Overflow" keys={["fit", "maxLines"]}>
				<Select
					aria-label="Fit"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pick((p) => p.fit ?? "none")}
					onChange={(v) =>
						setText("fit", () => ({
							fit: v === "none" ? undefined : (v as TextProperties["fit"]),
						}))
					}
				>
					{FITS.map(([id, name]) => (
						<SelectItem key={id} id={id}>
							{name}
						</SelectItem>
					))}
				</Select>
				<NumberField
					label="Lines"
					aria-label="Max lines"
					className="w-[84px] shrink-0"
					min={0}
					precision={0}
					value={pick((p) => p.maxLines ?? null)}
					placeholder={pick((p) => p.maxLines ?? 0) === null ? "Mixed" : "Any"}
					onChange={(v) =>
						setText("max-lines", () => ({
							maxLines: v >= 1 ? Math.round(v) : undefined,
						}))
					}
				/>
			</Row>
			<Row label="" keys={["leadingTrim"]}>
				<Checkbox
					isSelected={pick((p) => p.leadingTrim === true) === true}
					isIndeterminate={pick((p) => p.leadingTrim === true) === null}
					onChange={(on) =>
						setText("trim", () => ({ leadingTrim: on ? true : undefined }))
					}
				>
					Vertical trim
				</Checkbox>
			</Row>
		</PanelSection>
	);
}

function keysOf(v: string | null | undefined): string[] {
	return typeof v === "string" ? [v] : [];
}

function ContentField({ ins, texts }: { ins: Inspect; texts: TextElement[] }) {
	const wrap = useRef<HTMLDivElement>(null);
	const spans = texts.reduce(
		(n, e) => n + (e.properties.spans?.length ?? 0),
		0,
	);
	const value = commonValue(texts.map((e) => e.properties.value ?? ""));
	const fields = useMemo(() => listFields(ins.template), [ins.template]);

	useEffect(() => {
		const focus = () => {
			const area = wrap.current?.querySelector("textarea");
			area?.focus();
			area?.select();
		};
		window.addEventListener(FOCUS_TEXT_EVENT, focus);
		return () => window.removeEventListener(FOCUS_TEXT_EVENT, focus);
	}, []);

	const write = (v: string) => ins.setProps("text-value", () => ({ value: v }));

	const insertToken = (id: string) => {
		const area = wrap.current?.querySelector("textarea");
		const current = value ?? "";
		const token = `{{${id}}}`;
		const start = area?.selectionStart ?? current.length;
		const end = area?.selectionEnd ?? current.length;
		write(current.slice(0, start) + token + current.slice(end));
		requestAnimationFrame(() => {
			area?.focus();
			area?.setSelectionRange(start + token.length, start + token.length);
		});
	};

	const flatten = () =>
		ins.controller.edit((t) =>
			patchLayers(
				t,
				ins.keys,
				(el) => {
					const p = (el as TextElement).properties;
					if (!p.spans) return null;
					return {
						properties: {
							value: p.spans.map((s) => s.text).join(""),
							spans: undefined,
						},
					};
				},
				getElement,
			),
		);

	return (
		<div ref={wrap} className="flex flex-col gap-1.5">
			<div className="flex h-5 items-center justify-between pointer-coarse:h-8">
				<span className="flex items-center gap-1 text-fc-muted text-fc-sm">
					<OverrideMarker keys={["value", "spans"]} className="-ml-1" />
					Content
				</span>
				<MenuTrigger>
					<IconButton
						aria-label="Insert field"
						tooltip="Insert field"
						className="size-5 pointer-coarse:size-8"
						isDisabled={spans > 0 || fields.length === 0 || value === null}
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
			{spans > 0 ? (
				<div className="flex items-center justify-between gap-2 rounded-[3px] bg-fc-raised px-1.5 py-1">
					<span className="text-fc-muted text-fc-sm">
						Mixed styles ({plural(spans, "span")})
					</span>
					<Button size="sm" onPress={flatten}>
						Flatten to plain text
					</Button>
				</div>
			) : (
				<TextArea
					aria-label="Text content"
					rows={3}
					value={value ?? ""}
					placeholder={value === null ? "Mixed" : "Text"}
					onChange={write}
				/>
			)}
		</div>
	);
}

function FontFamilyField({
	ins,
	value,
}: {
	ins: Inspect;
	value: string | null;
}) {
	const [busy, setBusy] = useState(false);
	const families = useMemo(
		() => templateFamilies(ins.template),
		[ins.template],
	);

	const choose = async ({ family, row }: FontPick) => {
		const name = family.trim().replace(/\s+/g, " ");
		if (!name) return;
		const { controller, keys } = ins;
		if (row || isDeclared(ins.template, name)) {
			if (name !== value || !isDeclared(ins.template, name))
				controller.edit((t) => applyFontPick(t, keys, name, row));
			return;
		}
		// A name the catalogue lacks is checked against Google Fonts first.
		setBusy(true);
		const descriptor = await verifyGoogleFamily(name);
		setBusy(false);
		if (!descriptor) {
			toast(`Couldn't load "${name}" from Google Fonts`, {
				tone: "warning",
			});
			return;
		}
		controller.edit((t) => {
			const added = isDeclared(t, name)
				? { ok: true as const, template: t }
				: addFont(t, descriptor);
			return added.ok ? applyFontPick(added.template, keys, name) : added;
		});
	};

	return (
		<FontPicker
			value={value}
			templateFamilies={families}
			onPick={(pick) => void choose(pick)}
		>
			<AriaButton
				aria-label={`Font family: ${value ?? "Mixed"}`}
				isDisabled={busy}
				className={cn(triggerButton, "min-w-0 flex-1")}
			>
				<span
					className={cn(
						"min-w-0 flex-1 truncate",
						value === null && "text-fc-faint",
					)}
				>
					{value ?? "Mixed"}
				</span>
				<ChevronDownIcon className="size-3.5 shrink-0 text-fc-muted" />
			</AriaButton>
		</FontPicker>
	);
}
