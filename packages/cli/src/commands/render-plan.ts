import { WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { type Io, UsageError } from "../io";
import { type BatchOptions, renderBatch } from "./batch";
import { type RenderOptions, render } from "./render";
import { renderWorkspace, type WorkspaceOptions, writesFile } from "./workspace";

/** Every option `render` takes, as the command line gave them. A flag left
 *  out is undefined; `cropMarks` is false only for `--no-crop-marks`. */
export type RenderInput = Omit<BatchOptions, "out"> &
	Omit<WorkspaceOptions, "out"> & { out?: string };

export type RenderPlan =
	| { kind: "workspace"; options: WorkspaceOptions }
	| { kind: "template"; options: RenderOptions }
	| { kind: "batch"; options: BatchOptions };

const WORKSPACE_KEYS = ["preset", "out", "records", "save", "where", "dryRun", "jobs", "pieces", "cut", "cutLines", "minDpi", "quiet"];
const WORKSPACE_ONLY = ["preset", "records", "save"];
const PDF_OPTIONS = [
	"dpi",
	"pdfPages",
	"sheets",
	"duplex",
	"margin",
	"gap",
	"copies",
	"cropMarks",
	"outputIntent",
	"noOutputIntent",
	"outputIntentId",
	"cutLines",
];
const SHEET_OPTIONS = ["duplex", "margin", "gap", "copies", "cropMarks"];
const EXPORT_OPTIONS = ["name", "quality", "bleed", "jobs", "cut", ...PDF_OPTIONS];

/** What `render` runs for `file` and these options, or the UsageError that
 *  says why they do not go together. */
export function planRender(file: string, input: RenderInput): RenderPlan {
	const given = Object.entries(input)
		.filter(([key, value]) =>
			key === "cropMarks" ? value === false : value !== undefined && key !== "quiet",
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
	const exporting = rest.pieces || rest.cut || rest.cutLines;
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
	const { values, set, variant, frame, scale, format, pngAlpha, minDpi, dryRun, quiet } = input;
	return {
		...(values !== undefined ? { values } : {}),
		...(set !== undefined ? { set } : {}),
		...(variant !== undefined ? { variant } : {}),
		...(frame !== undefined ? { frame } : {}),
		...(scale !== undefined ? { scale } : {}),
		...(format !== undefined ? { format } : {}),
		...(pngAlpha !== undefined ? { pngAlpha } : {}),
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
		"scale" | "format" | "pngAlpha" | "quality" | "pdfPages" | "outputIntent" | "pieces" | "cut"
	>,
	out: string,
): string | undefined {
	const pdf = /\.pdf$/i.test(out);
	if ((options.scale?.length ?? 0) > 1) return "an export takes one --scale";
	if (options.pieces && options.pdfPages === "vector")
		return "--pieces does not go with --pdf-pages vector";
	if (pdf && options.format !== undefined)
		return "--format applies only to images; a PDF takes --pdf-pages";
	if (pdf && options.pngAlpha !== undefined)
		return "--png-alpha applies only to images; a PDF takes --pdf-pages";
	if (pdf && options.cut !== undefined)
		return "--cut applies only to images; a PDF takes --cut-lines";
	const pdfOnly = given.filter((key) => PDF_OPTIONS.includes(key));
	if (!pdf && pdfOnly.length > 0)
		return listed(pdfOnly, "applies only to a .pdf", "apply only to a .pdf");
	if (given.includes("outputIntentId") && typeof options.outputIntent !== "string")
		return "--output-intent-id needs --output-intent <file>";
	const sheetOnly = given.filter((key) => SHEET_OPTIONS.includes(key));
	if (sheetOnly.length > 0 && !given.includes("sheets"))
		return listed(sheetOnly, "needs --sheets", "need --sheets");
	if (options.quality !== undefined) {
		if (pdf && options.pdfPages !== "jpeg") return "--quality needs --pdf-pages jpeg";
		if (!pdf && (options.format === undefined || options.format === "png"))
			return "--quality needs --format jpeg or webp";
	}
	return undefined;
}

function flag(key: string): string {
	return key === "cropMarks"
		? "--no-crop-marks"
		: `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function listed(keys: string[], one: string, many: string): string {
	return `${keys.map(flag).join(", ")} ${keys.length === 1 ? one : many}`;
}
