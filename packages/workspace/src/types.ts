import type { Template } from "@freshcoat-js/coatfile";
import type { PrintProfile } from "@freshcoat-js/for-print";
import type { ItemCuts } from "./cut";

export type ColumnType =
	| "text"
	| "longText"
	| "number"
	| "integer"
	| "boolean"
	| "date"
	| "color"
	| "url"
	| "email"
	| "image";

export type CellValue = string | number | boolean | null;

export type Column = {
	/** `^[a-zA-Z_][a-zA-Z0-9_]*$`, unique in the dataset. */
	key: string;
	title?: string;
	description?: string;
	type: ColumnType;
	required?: boolean;
	default?: CellValue;
	/** text only */
	enum?: string[];
	/** text only: where the cells pick their value from */
	options?: ColumnOptions;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
};

/** A set of values a column's cells pick from, held elsewhere in the
 *  workspace: `variants` is the variants of the template `templateId`. */
export type ColumnOptions = { kind: "variants"; templateId: string };

export type RecordStatus = "pending" | "exported" | "failed" | "skipped";

export type DataRecord = {
	/** stable, "r_xxxxxxxx" */
	id: string;
	/** keyed by column key; a missing key means empty */
	values: Record<string, CellValue>;
	status: RecordStatus;
	/** ISO time of the last successful export */
	exportedAt?: string;
	/** last export error */
	error?: string;
};

export type DatasetAsset = {
	sha256: string;
	contentType: string;
	name: string;
	/** bytes */
	size: number;
	/** pixels as stored, from the header; EXIF orientation is not applied */
	width?: number;
	height?: number;
	/** EXIF 1..8, JPEG only */
	orientation?: number;
	/** the file's bytes: a File as picked, or a Blob read from an archive or
	 *  autosave; the workspace store never swaps it for an in-memory copy */
	blob: Blob;
};

export type Dataset = {
	id: string;
	name: string;
	columns: Column[];
	records: DataRecord[];
	/** photos referenced by image cells as "ws:<sha256>" */
	assets: DatasetAsset[];
};

export type FieldSource =
	| { kind: "column"; column: string }
	| { kind: "constant"; value: string }
	| {
			kind: "serial";
			start: number;
			step: number;
			pad: number;
			prefix?: string;
			suffix?: string;
	  };

/** Which variant a record renders in. `fixed` without an id, or naming a
 *  variant the template lacks, is Default. `all` renders each record in
 *  Default and then every variant that changes something. `image` picks,
 *  from Default and every variant, the one whose size is closest in aspect
 *  to the photo in `field`, as seen. `column` reads a variant's id or label,
 *  or `default`, from the record, and uses `fallback` when the cell is empty
 *  or names no variant. */
export type VariantSource =
	| { kind: "fixed"; id?: string }
	| { kind: "column"; column: string; fallback?: VariantFallback }
	| { kind: "all" }
	| { kind: "image"; field: string };

/** What a `column` variant source uses for a record whose cell picks no
 *  variant. */
export type VariantFallback = Extract<
	VariantSource,
	{ kind: "fixed" } | { kind: "image" }
>;

/** How a filter compares a cell with its value. `lt`, `lte`, `gt` and `gte`
 *  apply to number, integer and date columns; `empty` takes no value, and
 *  `contains` with no value keeps every record. */
export type FilterOp =
	| "equals"
	| "contains"
	| "empty"
	| "lt"
	| "lte"
	| "gt"
	| "gte";

export type ViewFilter = {
	column: string;
	op: FilterOp;
	/** as typed: a number, a date or text, read for the column's type */
	value?: string;
	/** keeps the records the condition does not match */
	not?: boolean;
};

/** A second dataset's columns added to each record whose `on` cell equals
 *  a `key` cell of that dataset, compared as trimmed text. */
export type ViewJoin = {
	datasetId: string;
	/** column of the bound dataset */
	on: string;
	/** column of the joined dataset */
	key: string;
	/** put before each joined column's key */
	prefix: string;
	/** a record with no match is dropped, rather than kept with the joined
	 *  cells empty; default false */
	inner?: boolean;
};

/** The records a binding reads: the bound dataset, joined to a second one,
 *  then the records every filter matches. */
export type DatasetView = {
	filters: ViewFilter[];
	join?: ViewJoin;
};

export type Binding = {
	datasetId: string;
	/** template field key -> source; absent = the field's default */
	fields: Record<string, FieldSource>;
	variant?: VariantSource;
	view?: DatasetView;
};

/** Ruler guides on one side, in template units: vertical guides at `x`,
 *  horizontal ones at `y`. */
export type SideGuides = { x: number[]; y: number[] };

/** Guides by side name. Editor state: the workspace keeps them, the template
 *  never does, so rendering and exports cannot see them. */
export type TemplateGuides = Readonly<Record<string, SideGuides>>;

export type TemplateEntry = {
	/** "t_xxxxxxxx", workspace-local, not the template's own id */
	id: string;
	/** shown and used when exporting it alone */
	fileName: string;
	template: Template;
	binding?: Binding;
	guides?: TemplateGuides;
};

/** Whether an export writes a side whole, or one file per slice piece. */
export type ExportSplit = "none" | "pieces";

/** The cutter file written beside each image of a zip: none, SVG or DXF. */
export type ExportCutFile = "none" | "svg" | "dxf";

export type ExportFormat = "png-zip" | "jpeg-zip" | "webp-zip" | "pdf";

/** How big each output is: the template's own size, or the size of the photo
 *  a field is bound to, as seen (EXIF orientation applied). */
export type ExportSize =
	| { kind: "template" }
	| {
			kind: "image";
			/** template field key whose value is the photo */
			field: string;
			/** caps the long edge, in pixels */
			maxEdge?: number;
	  };

/** Where an export's files go. Download is the fallback every browser has. */
export type ExportDestination = "download" | "zip-file" | "folder";

export type RecordFilter = "all" | "pending" | "failed" | "selected";

/** Output through for-print's card-printer path. Absent reads as off. */
export type PresetPrint = {
	enabled: boolean;
	/** a for-print PrintTarget id; default "ymcko-dye-sub" */
	target?: string;
	/** correct each photo from its own analysis; default true */
	analyze?: boolean;
	/** a measured printer, as for-print's own JSON */
	profile?: PrintProfile;
};

export type PaperName = "a4" | "letter" | "legal" | "a3" | "tabloid";

/** Cards imposed on sheets of paper, for a PDF. */
export type SheetLayout = {
	kind: "sheet";
	/** a named size, or a custom one; custom sizes are read short edge as
	 *  width, like the named ones */
	paper: PaperName | { widthMm: number; heightMm: number };
	/** auto: whichever fits more cards, portrait on a tie */
	orientation: "portrait" | "landscape" | "auto";
	/** default 10 */
	marginMm: number;
	/** between cards, default 0 */
	gapMm: number;
	/** default true */
	cropMarks: boolean;
	/** default none */
	duplex: "none" | "long-edge" | "short-edge";
	/** default 0,0; moves every back page, for a printer that drifts. `y` is
	 *  measured down the page */
	backOffsetMm?: { x: number; y: number };
	/** a one-sided template under duplex gets empty back pages; default false,
	 *  fronts only */
	blankBacks?: boolean;
};

/** How a PDF places its images: one per page, or imposed on sheets. */
export type PdfLayout = { kind: "single" } | SheetLayout;

/** What a PDF declares it was prepared for. `srgb`, the default, is the
 *  space Freshcoat draws in; `profile` names one of the workspace's
 *  `profiles`, such as a print shop's CMYK condition; `none` declares
 *  nothing. */
export type PdfOutputIntent =
	| { kind: "srgb" }
	| { kind: "profile"; sha256: string }
	| { kind: "none" };

/** An ICC profile a preset's output intent names, held once in the
 *  workspace however many presets name it. */
export type IccProfileAsset = {
	sha256: string;
	/** the file it was read from */
	name: string;
	/** the profile's own description */
	description: string;
	/** the OutputConditionIdentifier a PDF writes, such as FOGRA39; default
	 *  the description */
	identifier?: string;
	bytes: Uint8Array;
};

export type ExportPreset = {
	id: string;
	name: string;
	templateId: string;
	records: RecordFilter;
	/** record ids, when records === "selected" */
	selected?: string[];
	/** side names */
	sides: "all" | string[];
	format: ExportFormat;
	/** default template */
	size?: ExportSize;
	/** JPEG and WebP quality, 0..100, default 90 */
	quality?: number;
	/** png-zip only: "keep" writes RGBA even for an opaque card, for a
	 *  consumer that requires a 32-bit PNG; default auto */
	pngAlpha?: "auto" | "keep";
	/** what a PDF page embeds, default png. vector draws each card as PDF
	 *  vectors, with any layer a PDF cannot express as an image */
	pdfPageImage?: "png" | "jpeg" | "vector";
	/** default download */
	destination?: ExportDestination;
	/** PNG density, 1..4; a size from an image ignores it */
	scale: number;
	/** PDF physical size: widthPx / dpi inches (default 300) */
	dpi: number;
	/** file name pattern */
	fileName: string;
	/** default true */
	markExported: boolean;
	/** default off */
	print?: PresetPrint;
	/** PDF only; default single */
	layout?: PdfLayout;
	/** include the template's bleed around each card; default false, the
	 *  trim alone */
	bleed?: boolean;
	/** `pieces` exports each slice of a side as its own file; a side with no
	 *  slices exports whole. Default none. */
	split?: ExportSplit;
	/** image zips: a file of the item's cut lines beside each image that has
	 *  any, with the image's name. Default none. */
	cutFile?: ExportCutFile;
	/** PDF only: draw the cut lines over the art. Default false. */
	cutLines?: boolean;
	/** PDF only; default srgb */
	outputIntent?: PdfOutputIntent;
};

export type Workspace = {
	formatVersion: "1.0";
	name: string;
	/** at least one */
	templates: TemplateEntry[];
	datasets: Dataset[];
	presets: ExportPreset[];
	/** ICC profiles the presets' output intents name */
	profiles?: IccProfileAsset[];
};

export type CellIssue = { column: string; message: string };

export type CoerceResult = { value: CellValue; ok: boolean; message?: string };

export type ColumnMapping =
	| { kind: "column"; column: string }
	| { kind: "new"; key: string; type: ColumnType }
	| { kind: "skip" };

export type DateOrder = "dmy" | "mdy";

export type ImportPlan = {
	/** 0-based; -1 means no header (columns named A, B, C...) */
	headerRow: number;
	/** one per source column */
	mapping: ColumnMapping[];
	mode: "append" | "replace";
	dateOrder: DateOrder;
	/** upsert: update records whose column equals the source cell */
	match?: { source: number; column: string };
};

export type ImportIssue = {
	row: number;
	/** the record the row added or updated */
	record: string;
	column: string;
	message: string;
};

export type ApplyMappingResult = {
	dataset: Dataset;
	added: number;
	updated: number;
	issues: ImportIssue[];
};

export type ExportItem = {
	key: string;
	recordId: string;
	recordIndex: number;
	side: string;
	fileName: string;
	values: Record<string, string>;
	variantId?: string;
	/** the slice this item is the piece of; unset for a whole side */
	piece?: string;
	/** a piece's size in design units: its box and its bleed */
	pieceSize?: { width: number; height: number };
	/** required fields the binding leaves to their defaults: unbound, or
	 *  bound to a missing column. The item still renders. */
	unfilled?: string[];
};

export type TableSheet = { name: string; rows: string[][] };

export type TableFormat = "csv" | "tsv" | "xlsx" | "json" | "ndjson";

export type WrittenTable = {
	bytes: Uint8Array;
	mediaType: string;
	extension: string;
};

export type PdfPage = {
	/** the item's cut lines, drawn over the art in an optional content group
	 *  named Cut; in the image's design units */
	cut?: ItemCuts;
	/** a PNG, a JPEG or a one-page PDF, as `format` says */
	bytes: Uint8Array;
	format: "png" | "jpeg" | "pdf";
	widthPx: number;
	heightPx: number;
	/** the record it shows; on sheets, duplex pairs a record's sides by it */
	recordId?: string;
	/** the variant it shows, which with `recordId` names the card when every
	 *  variant is exported */
	variantId?: string;
	/** which of the record's sides it is, 0-based; a page without one counts
	 *  from the record's first page */
	sideIndex?: number;
};

export type UnpackErrorCode =
	| "not_a_zip"
	| "too_large"
	| "wrong_mimetype"
	| "missing_manifest"
	| "invalid_manifest"
	| "missing_entry"
	| "invalid_entry"
	| "asset_hash_mismatch"
	| "invalid_template"
	| "newer_version";

export type UnpackResult =
	| { ok: true; workspace: Workspace; warnings: string[] }
	| { ok: false; code: UnpackErrorCode; message: string };
