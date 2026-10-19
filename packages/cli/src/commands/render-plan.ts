import { WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { type Io, UsageError } from "../io";
import { type BatchOptions, renderBatch } from "./batch";
import { type RenderOptions, render } from "./render";
import { renderWorkspace, type WorkspaceOptions, writesFile } from "./workspace";

/** Every option `render` takes, as the command line gave them. A flag left
 *  out is undefined; `cropMarks` is false only for `--no-crop-marks`, and
 *  `analyze` only for `--no-analyze`. */
export type RenderInput = Omit<BatchOptions, "out"> &
	Omit<WorkspaceOptions, "out"> & { out?: string };

export type RenderPlan =
	| { kind: "workspace"; options: WorkspaceOptions }
	| { kind: "template"; options: RenderOptions }
	| { kind: "batch"; options: BatchOptions };

const WORKSPACE_KEYS = ["preset", "out", "records", "save", "where", "dryRun", "jobs", "pieces", "cut", "cutLines", "cutSpot", "minDpi", "quiet"];
const WORKSPACE_ONLY = ["preset", "records", "save"];
const PDF_OPTIONS = [
	"pdfPages",
	"pdfText",
	"sheets",
	"orientation",
	"duplex",
	"margin",
	"gap",
	"copies",
	"cropMarks",
	"backOffset",
	"blankBacks",
	"marks",
	"outputIntent",
	"noOutputIntent",
	"outputIntentId",
	"cutLines",
	"cutSpot",
];
const SHEET_OPTIONS = ["orientation", "duplex", "margin", "gap", "copies", "cropMarks", "marks", "backOffset", "blankBacks"];
const NEGATED = ["cropMarks", "analyze"];
const DUPLEX_OPTIONS = ["backOffset", "blankBacks"];
const EXPORT_OPTIONS = ["name", "quality", "bleed", "jobs", "cut", "sizeFrom", "maxEdge", ...PDF_OPTIONS];

/** What `render` runs for `file` and these options, or the UsageError that
 *  says why they do not go together. */
export function planRender(file: string, input: RenderInput): RenderPlan {
	const given = Object.entries(input)
		.filter(([key, value]) =>
			NEGATED.includes(key) ? value === false : value !== undefined && key !== "quiet",
		)
		.map(([key, value]) => (key === "outputIntent" && value === false ? "noOutputIntent" : key));
	const { preset, out, records, save, ...rest } = input;
	if (save && rest.dryRun) throw new UsageError("--save and --dry-run do not go together");

	if (file.toLowerCase().endsWith(WORKSPACE_EXTENSION)) {
		const misplaced = given.filter((key) => !WORKSPACE_KEYS.includes(key));
		if (misplaced.length > 0)
			throw new UsageError(listed(misplaced, "applies only to templates", "apply only to templates"));
		if (out === undefined) throw new UsageError("a .coatworkspace needs --out <path>");
		return {
			kind: "workspace",
			options: {
				...(preset ? { preset } : {}),
				...(records ? { records } : {}),
				...(save ? { save } : {}),
				...(rest.where ? { where: rest.where } : {}),
				...(rest.dryRun ? { dryRun: rest.dryRun } : {}),
				...(rest.jobs ? { jobs: rest.jobs } : {}),
				...(rest.pieces ? { pieces: rest.pieces } : {}),
				...(rest.cut ? { cut: rest.cut } : {}),
				...(rest.cutLines ? { cutLines: rest.cutLines } : {}),
				...(rest.cutSpot ? { cutSpot: rest.cutSpot } : {}),
				...(rest.minDpi !== undefined ? { minDpi: rest.minDpi } : {}),
				out,
				quiet: input.quiet,
			},
		};
	}

	const workspaceOnly = given.filter((key) => WORKSPACE_ONLY.includes(key));
	if (workspaceOnly.length > 0)
		throw new UsageError(`${listed(workspaceOnly, "needs", "need")} a .coatworkspace file`);
	if (rest.pngAlpha !== undefined && rest.format !== undefined && rest.format !== "png")
		throw new UsageError("--png-alpha needs --format png");
	if (rest.where !== undefined && rest.data === undefined)
		throw new UsageError("--where needs --data or a .coatworkspace file");
	if (rest.printProfile !== undefined && rest.printTarget === "none")
		throw new UsageError("--print-profile does not go with --print-target none");
	if (
		rest.analyze === false &&
		rest.printProfile === undefined &&
		(rest.printTarget === undefined || rest.printTarget === "none")
	)
		throw new UsageError("--no-analyze needs --print-target or --print-profile");
	const exporting =
		rest.pieces ||
		rest.cut ||
		rest.cutLines ||
		rest.cutSpot ||
		rest.printTarget !== undefined ||
		rest.printProfile !== undefined;
	if (/\.zip$/i.test(file) && (rest.data !== undefined || exporting || (out !== undefined && writesFile(out))))
		throw new UsageError(
			"a templates .zip renders each template's frames into a directory; --data, a .zip or .pdf --out and the export options need one template",
		);
	if (rest.data === undefined && !exporting && (out === undefined || !writesFile(out))) {
		const exportOnly = given.filter((key) => EXPORT_OPTIONS.includes(key));
		if (exportOnly.length > 0)
			throw new UsageError(
				`${listed(exportOnly, "needs", "need")} --data or a .zip or .pdf --out`,
			);
		return { kind: "template", options: templateOptions(rest, out) };
	}
	if (out === undefined && !exporting)
		throw new UsageError("--data needs --out <dir|file.zip|file.pdf>");
	const to = out ?? ".";
	const problem = exportProblem(given, rest, to);
	if (problem) throw new UsageError(problem);
	return { kind: "batch", options: { ...rest, out: to } };
}

/** Plans `render` and runs what it chose. */
export async function runRender(file: string, input: RenderInput, io: Io): Promise<void> {
	const plan = planRender(file, input);
	if (plan.kind === "workspace") return renderWorkspace(file, plan.options, io);
	if (plan.kind === "template") return render(file, plan.options, io);
	return renderBatch(file, plan.options, io);
}

function templateOptions(input: Omit<RenderInput, "out">, out: string | undefined): RenderOptions {
	const { values, set, variant, frame, scale, format, pngAlpha, dpi, minDpi, dryRun, quiet } = input;
	return {
		...(values !== undefined ? { values } : {}),
		...(set !== undefined ? { set } : {}),
		...(variant !== undefined ? { variant } : {}),
		...(frame !== undefined ? { frame } : {}),
		...(scale !== undefined ? { scale } : {}),
		...(format !== undefined ? { format } : {}),
		...(pngAlpha !== undefined ? { pngAlpha } : {}),
		...(dpi !== undefined ? { dpi } : {}),
		...(minDpi !== undefined ? { minDpi } : {}),
		...(dryRun ? { dryRun } : {}),
		...(out !== undefined ? { out } : {}),
		quiet,
	};
}

function exportProblem(
	given: string[],
	options: Pick<
		RenderInput,
		| "scale"
		| "format"
		| "pngAlpha"
		| "quality"
		| "pdfPages"
		| "pdfText"
		| "outputIntent"
		| "pieces"
		| "cut"
		| "sizeFrom"
		| "bleed"
	>,
	out: string,
): string | undefined {
	const pdf = /\.pdf$/i.test(out);
	if ((options.scale?.length ?? 0) > 1) return "an export takes one --scale";
	if (given.includes("maxEdge") && options.sizeFrom === undefined)
		return "--max-edge needs --size-from";
	if (options.sizeFrom !== undefined) {
		const templateSized = given.filter((key) => ["scale", "bleed", "sheets"].includes(key));
		if (templateSized.length > 0)
			return `${listed(templateSized, "does", "do")} not go with --size-from, which sizes each file by its photo`;
	}
	if (options.pieces && options.pdfPages === "vector")
		return "--pieces does not go with --pdf-pages vector";
	if (options.pieces && given.includes("duplex"))
		return "--pieces does not go with --duplex; a piece is not a side of a card";
	if (pdf && options.format !== undefined)
		return "--format applies only to images; a PDF takes --pdf-pages";
	if (pdf && options.pngAlpha !== undefined)
		return "--png-alpha applies only to images; a PDF takes --pdf-pages";
	if (pdf && options.cut !== undefined)
		return "--cut applies only to images; a PDF takes --cut-lines";
	const pdfOnly = given.filter((key) => PDF_OPTIONS.includes(key));
	if (!pdf && pdfOnly.length > 0)
		return listed(pdfOnly, "applies only to a .pdf", "apply only to a .pdf");
	if (options.pdfText !== undefined && options.pdfPages !== "vector")
		return "--pdf-text needs --pdf-pages vector";
	if (given.includes("outputIntentId") && typeof options.outputIntent !== "string")
		return "--output-intent-id needs --output-intent <file>";
	const sheetOnly = given.filter((key) => SHEET_OPTIONS.includes(key));
	if (sheetOnly.length > 0 && !given.includes("sheets"))
		return listed(sheetOnly, "needs --sheets", "need --sheets");
	const duplexOnly = given.filter((key) => DUPLEX_OPTIONS.includes(key));
	if (duplexOnly.length > 0 && !given.includes("duplex"))
		return listed(duplexOnly, "needs --duplex", "need --duplex");
	if (options.quality !== undefined) {
		if (pdf && options.pdfPages !== "jpeg") return "--quality needs --pdf-pages jpeg";
		if (!pdf && (options.format === undefined || options.format === "png"))
			return "--quality needs --format jpeg or webp";
	}
	return undefined;
}

function flag(key: string): string {
	if (key === "cropMarks") return "--no-crop-marks";
	if (key === "analyze") return "--no-analyze";
	return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function listed(keys: string[], one: string, many: string): string {
	return `${keys.map(flag).join(", ")} ${keys.length === 1 ? one : many}`;
}
