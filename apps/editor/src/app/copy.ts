import type { RecordStatus } from "@freshcoat-js/workspace";
import { formatNumber } from "~/app/format";

/** Strings more than one part of the editor shows. The rest of the copy
 *  stays inline, beside the control it labels. */

/** A count and its noun: "1 record", "2,400 records". */
export function plural(n: number, one: string, many = `${one}s`): string {
	return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** The rule for a field key and a column key, which are the same thing. */
export const KEY_RULE = "Letters, numbers and _, not starting with a number";

/** The pointer at "Open file…" for the `.coat` the Figma plugin downloads
 *  when a template is too large for a link (`#open=1`): a line on the
 *  welcome screen, or a toast over a workspace. */
export const OPEN_HINT = "Open the .coat file you downloaded from Figma";

/** Empty-state titles used in more than one place. */
export const EMPTY = {
	datasets: "No datasets",
	records: "No records",
	fields: "No fields",
	columns: "No columns",
	presets: "No presets",
	noTemplate: "No template open",
	noMatch: "No matches",
} as const;

export const STATUS_LABEL: Record<RecordStatus, string> = {
	pending: "Pending",
	exported: "Exported",
	failed: "Failed",
	skipped: "Skipped",
};

/** Why a variant op refused, fit for a toast. */
export const BOOLEAN = {
	union: "Union selection",
	subtract: "Subtract selection",
	intersect: "Intersect selection",
	exclude: "Exclude selection",
	toolbar: "Boolean",
	tooFew: "Select two or more shapes",
	notShape: "Only rectangles, ellipses and vectors can be combined",
	autoLayout: "Layers in auto layout can't be combined",
	empty: "Nothing would be left of the shapes",
	couldNotLoad: "Couldn't load the path engine",
} as const;

export const VARIANT_COPY = {
	unknown: "That variant no longer exists",
	emptyLabel: "A variant needs a name",
	emptyId: "A variant id can't be empty",
	idRule: "Use lowercase letters, numbers and -",
	/** Export file names and bindings use `default` for Default. */
	reservedId: '"default" is kept for Default',
	idTaken: (id: string) => `"${id}" is already used by another variant`,
	noIndex: "No variant there",
	noSide: "That side no longer exists",
	noLayer: "That layer no longer exists",
} as const;

/** Editing in a variant: the Variants list, the canvas bar, override
 *  markers and the Issues entries. */
export const VARIANT_UI = {
	default: "Default",
	add: "Add variant",
	/** The label a new variant starts with. */
	newLabel: (n: number) => `Variant ${n}`,
	copyLabel: (label: string) => `${label} copy`,
	/** How much a variant changes, in its list entry. */
	changes: (layers: number) =>
		layers === 0 ? "No changes" : plural(layers, "layer"),
	editing: (label: string) => `Editing ${label}`,
	changed: (layers: number) =>
		layers === 0 ? "No changes" : `${plural(layers, "layer")} changed`,
	backToDefault: "Back to Default",
	size: (size: { width: number; height: number }) =>
		`${size.width} × ${size.height}`,
	sizePortrait: "Make portrait",
	sizeLandscape: "Make landscape",
	sizeSquare: "Make square",
	sizeDefault: "Use Default's size",
	changedIn: (label: string) => `Changed in ${label}`,
	resetToDefault: "Reset to Default",
	hideIn: (label: string) => `Hide in ${label}`,
	showIn: (label: string) => `Show in ${label}`,
	hiddenIn: (label: string) => `Hidden in ${label}`,
	/** Values a variant can't change, edited while one is active. */
	shared: "Same in every variant",
	sharedConditions: "Conditions are the same in every variant",
	useSuggested: "Use suggested",
	noSwatch: "None",
	changeId: "Change id",
	changeIdWarning:
		"Files, bindings and orders that saved the old id show the Default design instead.",
	deleteTitle: (label: string) => `Delete ${label}?`,
	deleteMessage: (layers: number) =>
		layers === 0
			? "It has no changes."
			: `Its changes to ${plural(layers, "layer")} are removed.`,
	removeUnused: "Remove unused changes",
	orphan: (label: string, layer: string, side: string) =>
		`${label} changes ${layer}, which isn't on ${side}`,
	empty: (label: string, layer: string) =>
		`${label} has a change to ${layer} that changes nothing`,
} as const;

/** The left panel's sections. */
export const LEFT_PANEL = {
	templates: "Templates",
	sides: "Sides",
	variants: "Variants",
	layers: "Layers",
	/** Under Default while a template has no variants; it adds one. */
	addVariantHint: "Add a variant, such as a colorway or a staff version",
} as const;

/** The inspector's tabs and the Content tab. */
export const BINDING = {
	unfilled: (n: number) => `${plural(n, "required field")} unfilled`,
} as const;

export const CONTENT = {
	design: "Design",
	content: "Content",
	/** The record stepper's heading, before the dataset's name. */
	tryWith: "Try with",
	chooseDataset: "Choose a dataset",
	binding: "Binding",
	samples: "Samples",
	fields: "Fields",
	addField: "Add field",
	newKey: "New field key",
	resetSamples: "Reset to samples",
	/** Fields a pipeline fills in rather than a person. */
	system: "From the system",
	unused: "unused",
	empty: "No fields yet. Add one with +, then type {{key}} in a text layer.",
} as const;

/** Template setup, the naming prompt and the template size. */
export const TEMPLATE_SETUP = {
	title: "Template setup",
	command: "Template setup…",
	naming: "Name this template",
	unnamed: (fileName: string) => `${fileName} has no name yet`,
	sharedSize: "Every side shares this size",
	variantSize: "This variant's own size, shared by every side",
} as const;

/** Bleed and safe area, in the template's size settings. */
export const INSETS = {
	bleed: "Bleed",
	safeArea: "Safe area",
	bleedLabel: "Template bleed",
	safeAreaLabel: "Template safe area",
	mixed: "Mixed",
	negative: "Bleed and safe area can't be negative",
	safeAreaTooLarge: "The safe area must fit inside the template",
} as const;

/** The variant choice of a binding and an export, and how the export
 *  preview names a variant. */
export const VARIANT_EXPORT = {
	/** the variant source's choices */
	kinds: {
		none: "Default",
		fixed: "Fixed",
		column: "Column",
		image: "Photo shape",
		all: "All variants",
	},
	noPhoto: "Choose a photo",
	default: "Default",
	defaultHint: "The template's default look",
	noVariants: "No variants",
	/** what All variants exports, beside the choice */
	allHint: (variants: number) =>
		variants === 0
			? "Default only, no variant changes anything"
			: `Default and ${plural(variants, "variant")}`,
	unbound: "Not bound. Fields use their defaults.",
	fileNameTokens:
		"Tokens: {{template}} {{side}} {{index}} {{record}} {{variant}} and any column key",
} as const;

/** What a validation issue says in the Issues list, by its code. The code
 *  itself stays in the entry's tooltip. */
export const ISSUE_COPY = {
	unknownField: (name: string) => `Uses {{${name}}}, which isn't a field`,
	unknownConditionField: (name: string) =>
		`Shows when ${name} is set, but ${name} isn't a field`,
	duplicateLayer: (name: string) => `Another layer is also named ${name}`,
	unnamedLayer: "This layer has no name",
	duplicateSide: (name: string) => `Two sides are named ${name}`,
	unnamedSide: "A side has no name",
	noSides: "The template has no sides",
	backgroundFill: "The background must fill the side",
	dimension: (what: string) => `${what} must be a whole number above 0`,
	required: (what: string) => `Template ${what} is required`,
	emptyOptional: (what: string) => `Template ${what} can't be empty`,
	noFormatVersion: "The file doesn't say which format version it is",
	newerFormat: "Made in a newer format version",
	unnamedVariantId: "A variant has no id",
	duplicateVariant: (id: string) => `Two variants have the id ${id}`,
	unnamedVariant: "A variant has no name",
	overrideNoSide: (variant: string) =>
		`${variant} changes a side it doesn't name`,
	overrideUnknownSide: (variant: string, side: string) =>
		`${variant} changes ${side}, which isn't a side`,
	overrideTwice: (variant: string, side: string) =>
		`${variant} changes ${side} twice`,
	booleanDefault: (field: string) =>
		`${field} is on or off, so its default must be true or false`,
	fillKind: "Unknown gradient type",
	twoStops: "A gradient needs at least 2 stops",
	stopOffset: "A gradient stop must sit between 0% and 100%",
	stopColor: "A gradient stop has no color",
	sameEnds: "The gradient starts and ends at the same point",
	fontFamily: "A font has no family",
	duplicateFont: (family: string) => `${family} is listed twice in Fonts`,
	fontUrl: "A web font has no URL",
	fontFiles: "A local font has no files",
	fontFileSrc: "A local font file has no source",
	backgroundType: "Unknown background type",
	notATemplate: "This isn't a template",
	sides: "The sides aren't valid",
	fields: "The fields aren't valid",
	unknownSetting: (name: string) => `Unknown setting ${name}`,
	invalid: (what: string) => `${what} isn't valid`,
} as const;
