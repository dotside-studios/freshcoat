// validateCommands — IR well-formedness, checked independently of any backend.
//
// The question it answers is "is this Command[] legal?", never "did the backend
// draw it right". That split is what makes a second backend debuggable: a
// malformed scene fails here once, with a path to the offending field, instead of
// failing differently in every implementation that consumes it. Skia will happily
// read past a short bitmap buffer and an SVG emitter will not, so a check that
// only one of them performs is a divergence nobody can attribute.
//
// Not part of the paint path. The conformance harness runs it on every case, and
// a consumer building scenes by hand can run it in dev; production paints
// unchecked, as it always has.
import { PATTERN_KINDS } from "./pattern";
import type {
	Adjust,
	Command,
	CornerRadius,
	DrawCommand,
	FrameFinish,
	ResolvedFill,
	ShapeMask,
	Stroke,
} from "./types";

export type IrIssue = {
	// Machine-readable, stable: the conformance corpus asserts on these.
	code: string;
	message: string;
	// Where in the stream, e.g. `commands[3].children[0].adjust.colorMatrix`.
	path: string;
	// The source node id the drawable carries, when it has one.
	id?: string;
};

const MASK_KINDS = new Set<ShapeMask["kind"]>([
	"rect",
	"rounded-rect",
	"circle",
	"ellipse",
	"polygon",
	"squircle",
]);

const finite = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

export function validateCommands(commands: Command[]): IrIssue[] {
	const issues: IrIssue[] = [];
	const add = (code: string, message: string, path: string, id?: string) =>
		issues.push(id ? { code, message, path, id } : { code, message, path });

	const setups = commands.filter((c) => c.op === "createCanvas");
	if (setups.length === 0)
		add("missing_create_canvas", "no createCanvas command", "commands");
	if (setups.length > 1)
		add(
			"duplicate_create_canvas",
			`${setups.length} createCanvas commands; a scene is one surface`,
			"commands",
		);
	if (setups.length > 0 && commands[0]?.op !== "createCanvas")
		add(
			"create_canvas_not_first",
			"createCanvas must be the first command",
			"commands[0]",
		);

	commands.forEach((cmd, i) => {
		const path = `commands[${i}]`;
		if (cmd.op === "createCanvas") {
			if (!finite(cmd.width) || cmd.width <= 0)
				add(
					"bad_canvas_size",
					`width must be > 0, got ${cmd.width}`,
					`${path}.width`,
				);
			if (!finite(cmd.height) || cmd.height <= 0)
				add(
					"bad_canvas_size",
					`height must be > 0, got ${cmd.height}`,
					`${path}.height`,
				);
			if (cmd.scale !== undefined && (!finite(cmd.scale) || cmd.scale <= 0))
				add(
					"bad_scale",
					`scale must be > 0, got ${cmd.scale}`,
					`${path}.scale`,
				);
			if (
				cmd.supersample !== undefined &&
				(!finite(cmd.supersample) || cmd.supersample < 1)
			)
				add(
					"bad_supersample",
					`supersample must be >= 1, got ${cmd.supersample}`,
					`${path}.supersample`,
				);
			if (
				cmd.precision !== undefined &&
				cmd.precision !== "u8" &&
				cmd.precision !== "f16"
			)
				add(
					"bad_precision",
					`precision must be "u8" or "f16", got ${String(cmd.precision)}`,
					`${path}.precision`,
				);
			return;
		}
		if (cmd.op === "finishFrame") {
			validateFinish(cmd.finish, path, add);
			return;
		}
		if (cmd.op === "loadFonts" || cmd.op === "loadImages") return;
		validateDrawable(cmd, path, add);
	});

	return issues;
}

type Add = (code: string, message: string, path: string, id?: string) => void;

function validateFinish(finish: FrameFinish, path: string, add: Add): void {
	const threshold = (v: number | undefined, name: string) => {
		if (v === undefined) return;
		if (!finite(v) || v < 0 || v > 255)
			add(
				"bad_finish_threshold",
				`${name} must be within 0..255, got ${v}`,
				`${path}.finish.${name}`,
			);
	};
	if (finish.curve)
		for (const ch of ["r", "g", "b"] as const)
			if (finish.curve[ch]?.length !== 256)
				add(
					"bad_lut",
					`curve.${ch} must have 256 entries, got ${finish.curve[ch]?.length}`,
					`${path}.finish.curve.${ch}`,
				);
	threshold(finish.whiteClamp, "whiteClamp");
	threshold(finish.blackExtract, "blackExtract");
	const amount =
		typeof finish.dither === "number" ? finish.dither : finish.dither?.amount;
	if (amount !== undefined && !finite(amount))
		add(
			"bad_dither",
			`dither amount must be finite, got ${amount}`,
			`${path}.finish.dither`,
		);
}

function validateDrawable(cmd: DrawCommand, path: string, add: Add): void {
	const id = cmd.id;
	if (!finite(cmd.pos?.x) || !finite(cmd.pos?.y))
		add("bad_pos", "pos.x and pos.y must be finite", `${path}.pos`, id);
	if (!finite(cmd.size?.width) || !finite(cmd.size?.height))
		add(
			"bad_size",
			"size.width and size.height must be finite",
			`${path}.size`,
			id,
		);
	else if (cmd.size.width < 0 || cmd.size.height < 0)
		add("bad_size", "size must not be negative", `${path}.size`, id);

	if (
		cmd.opacity !== undefined &&
		(!finite(cmd.opacity) || cmd.opacity < 0 || cmd.opacity > 1)
	)
		add(
			"bad_opacity",
			`opacity must be within 0..1, got ${cmd.opacity}`,
			`${path}.opacity`,
			id,
		);
	if (cmd.rotation !== undefined && !finite(cmd.rotation))
		add("bad_rotation", "rotation must be finite", `${path}.rotation`, id);
	if (cmd.blur !== undefined && (!finite(cmd.blur) || cmd.blur < 0))
		add("bad_blur", `blur must be >= 0, got ${cmd.blur}`, `${path}.blur`, id);
	if (
		cmd.backdropBlur !== undefined &&
		(!finite(cmd.backdropBlur) || cmd.backdropBlur < 0)
	)
		add(
			"bad_backdrop_blur",
			`backdropBlur must be >= 0, got ${cmd.backdropBlur}`,
			`${path}.backdropBlur`,
			id,
		);

	if (cmd.clip && !MASK_KINDS.has(cmd.clip.kind))
		add(
			"unknown_clip_kind",
			`unknown clip kind "${cmd.clip.kind}"`,
			`${path}.clip`,
			id,
		);
	if (cmd.backdropClip && !MASK_KINDS.has(cmd.backdropClip.kind))
		add(
			"unknown_clip_kind",
			`unknown clip kind "${cmd.backdropClip.kind}"`,
			`${path}.backdropClip`,
			id,
		);
	if (
		cmd.clip?.kind === "polygon" &&
		(!finite(cmd.clip.sides) || cmd.clip.sides < 3)
	)
		add(
			"bad_polygon",
			`polygon needs >= 3 sides, got ${cmd.clip.sides}`,
			`${path}.clip.sides`,
			id,
		);

	if (cmd.clip?.kind === "rounded-rect" && Array.isArray(cmd.clip.radius))
		validateCornerRadius(cmd.clip.radius, `${path}.clip.radius`, add, id);
	if (cmd.clip?.kind === "rounded-rect" && cmd.clip.smoothing !== undefined) {
		const smoothing = cmd.clip.smoothing;
		if (!finite(smoothing) || smoothing < 0)
			add(
				"bad_corner_smoothing",
				`smoothing must be >= 0, got ${smoothing}`,
				`${path}.clip.smoothing`,
				id,
			);
	}

	for (const shadow of cmd.shadow
		? Array.isArray(cmd.shadow)
			? cmd.shadow
			: [cmd.shadow]
		: []) {
		if (!finite(shadow.blur) || shadow.blur < 0)
			add(
				"bad_shadow",
				`shadow.blur must be >= 0, got ${shadow.blur}`,
				`${path}.shadow`,
				id,
			);
		if (!finite(shadow.dx) || !finite(shadow.dy))
			add("bad_shadow", "shadow dx/dy must be finite", `${path}.shadow`, id);
	}

	if (cmd.adjust) validateAdjust(cmd.adjust, `${path}.adjust`, add, id);
	if (cmd.op !== "drawGroup" && "isolate" in cmd)
		add(
			"isolate_not_group",
			`isolate applies to drawGroup only, not ${cmd.op}`,
			`${path}.isolate`,
			id,
		);

	if ("fills" in cmd && cmd.fills)
		cmd.fills.forEach((f, i) => {
			validateFill(f, `${path}.fills[${i}]`, add, id);
		});
	if ("stroke" in cmd && cmd.stroke)
		validateStroke(cmd.stroke, `${path}.stroke`, add, id);
	if ("cornerRadius" in cmd && cmd.cornerRadius !== undefined)
		validateCornerRadius(cmd.cornerRadius, `${path}.cornerRadius`, add, id);

	switch (cmd.op) {
		case "drawBitmap": {
			const { pixelWidth: w, pixelHeight: h, pixels } = cmd;
			if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0)
				add(
					"bad_bitmap_size",
					`pixelWidth/pixelHeight must be positive integers, got ${w}x${h}`,
					`${path}`,
					id,
				);
			else if (pixels.length !== w * h * 4)
				add(
					"bitmap_buffer_mismatch",
					`pixels.length ${pixels.length} != pixelWidth*pixelHeight*4 (${w * h * 4})`,
					`${path}.pixels`,
					id,
				);
			if (cmd.role !== undefined && cmd.role !== "barcode")
				add(
					"bad_bitmap_role",
					`role must be "barcode" when set, got ${String(cmd.role)}`,
					`${path}.role`,
					id,
				);
			break;
		}
		case "drawPath": {
			if (!cmd.d) add("empty_path", "path `d` is empty", `${path}.d`, id);
			if (cmd.viewBox) {
				const { width, height } = cmd.viewBox;
				if (!finite(width) || width <= 0 || !finite(height) || height <= 0)
					add(
						"bad_viewbox",
						`viewBox must have positive width/height, got ${width}x${height}`,
						`${path}.viewBox`,
						id,
					);
			}
			break;
		}
		case "drawImage":
			if (!cmd.src)
				add("empty_image_src", "image src is empty", `${path}.src`, id);
			if (
				cmd.crop &&
				!(
					[cmd.crop.x, cmd.crop.y].every((v) => finite(v) && v >= 0) &&
					cmd.crop.width > 0 &&
					cmd.crop.height > 0 &&
					cmd.crop.x + cmd.crop.width <= 1 + 1e-9 &&
					cmd.crop.y + cmd.crop.height <= 1 + 1e-9
				)
			)
				add(
					"bad_image_crop",
					"image crop must be a non-empty region inside [0, 1]",
					`${path}.crop`,
					id,
				);
			if (cmd.focus && !(finite(cmd.focus.x) && finite(cmd.focus.y)))
				add(
					"bad_image_focus",
					"image focus must be finite",
					`${path}.focus`,
					id,
				);
			break;
		case "drawText":
			if (!cmd.layout?.lines)
				add(
					"missing_text_lines",
					"text layout has no lines",
					`${path}.layout`,
					id,
				);
			else
				cmd.layout.lines.forEach((line, i) => {
					if (!line.spans || line.spans.length === 0)
						add(
							"empty_text_line",
							`line ${i} has no spans`,
							`${path}.layout.lines[${i}]`,
							id,
						);
					if (line.baseline !== undefined && !finite(line.baseline))
						add(
							"bad_baseline",
							`line ${i} baseline is not finite`,
							`${path}.layout.lines[${i}].baseline`,
							id,
						);
				});
			if (cmd.arc) {
				const { radius, startAngle, sweep } = cmd.arc;
				if (!finite(radius) || radius < 0)
					add(
						"bad_arc",
						"arc radius must be a finite number >= 0",
						`${path}.arc.radius`,
						id,
					);
				if (!finite(startAngle))
					add(
						"bad_arc",
						"arc startAngle is not finite",
						`${path}.arc.startAngle`,
						id,
					);
				if (sweep !== undefined && (!finite(sweep) || sweep <= 0))
					add(
						"bad_arc",
						"arc sweep must be a finite number > 0",
						`${path}.arc.sweep`,
						id,
					);
			}
			break;
		case "drawGroup":
			if (cmd.isolate !== undefined && typeof cmd.isolate !== "boolean")
				add(
					"bad_isolate",
					`isolate must be a boolean, got ${typeof cmd.isolate}`,
					`${path}.isolate`,
					id,
				);
			cmd.children.forEach((c, i) => {
				validateDrawable(c, `${path}.children[${i}]`, add);
			});
			break;
		case "drawMasked":
			if (cmd.channel && cmd.channel !== "alpha" && cmd.channel !== "luminance")
				add(
					"unknown_mask_channel",
					`unknown mask channel "${cmd.channel}"`,
					`${path}.channel`,
					id,
				);
			validateDrawable(cmd.mask, `${path}.mask`, add);
			cmd.children.forEach((c, i) => {
				validateDrawable(c, `${path}.children[${i}]`, add);
			});
			break;
	}
}

function validateAdjust(
	adjust: Adjust,
	path: string,
	add: Add,
	id?: string,
): void {
	if (adjust.colorMatrix) {
		if (adjust.colorMatrix.length !== 20)
			add(
				"bad_color_matrix",
				`colorMatrix must have 20 entries (4x5), got ${adjust.colorMatrix.length}`,
				`${path}.colorMatrix`,
				id,
			);
		if (!adjust.colorMatrix.every(finite))
			add(
				"bad_color_matrix",
				"colorMatrix has a non-finite entry",
				`${path}.colorMatrix`,
				id,
			);
	}
	if (adjust.lut)
		for (const ch of ["r", "g", "b"] as const)
			if (adjust.lut[ch]?.length !== 256)
				add(
					"bad_lut",
					`lut.${ch} must have 256 entries, got ${adjust.lut[ch]?.length}`,
					`${path}.lut.${ch}`,
					id,
				);
	if (adjust.lut3d) {
		const { size, data } = adjust.lut3d;
		if (!Number.isInteger(size) || size < 2)
			add(
				"bad_lut3d",
				`lut3d.size must be an integer >= 2, got ${size}`,
				`${path}.lut3d.size`,
				id,
			);
		else if (data.length !== size ** 3 * 3)
			add(
				"bad_lut3d",
				`lut3d.data.length ${data.length} != size^3*3 (${size ** 3 * 3})`,
				`${path}.lut3d.data`,
				id,
			);
	}
	if (adjust.sharpen !== undefined && !finite(adjust.sharpen))
		add("bad_sharpen", "sharpen must be finite", `${path}.sharpen`, id);
	if (
		adjust.gamut &&
		adjust.gamut !== "clip" &&
		adjust.gamut !== "preserve-hue"
	)
		add(
			"unknown_gamut",
			`unknown gamut mode "${adjust.gamut}"`,
			`${path}.gamut`,
			id,
		);
}

function validatePattern(
	fill: Extract<ResolvedFill, { kind: "pattern" }>,
	path: string,
	add: Add,
	id?: string,
): void {
	if (!PATTERN_KINDS.includes(fill.pattern))
		add(
			"unknown_pattern",
			`unknown pattern "${fill.pattern}"`,
			`${path}.pattern`,
			id,
		);
	if (!finite(fill.scale) || fill.scale <= 0)
		add(
			"bad_pattern_scale",
			`pattern scale must be > 0, got ${fill.scale}`,
			`${path}.scale`,
			id,
		);
	if (!finite(fill.density) || fill.density < 0 || fill.density > 1)
		add(
			"bad_pattern_density",
			`pattern density must be within 0..1, got ${fill.density}`,
			`${path}.density`,
			id,
		);
	if (!finite(fill.angle))
		add(
			"bad_pattern_angle",
			"pattern angle must be finite",
			`${path}.angle`,
			id,
		);
	if (!Number.isInteger(fill.seed))
		add(
			"bad_pattern_seed",
			`pattern seed must be an integer, got ${fill.seed}`,
			`${path}.seed`,
			id,
		);
}

function validateFill(
	fill: ResolvedFill,
	path: string,
	add: Add,
	id?: string,
): void {
	if (fill.kind === "solid") return;
	if (fill.kind === "pattern") {
		validatePattern(fill, path, add, id);
		return;
	}
	const stops = fill.stops;
	if (!stops || stops.length === 0) {
		add("empty_gradient", "gradient has no stops", `${path}.stops`, id);
		return;
	}
	let previous = Number.NEGATIVE_INFINITY;
	stops.forEach((stop, i) => {
		if (!finite(stop.offset) || stop.offset < 0 || stop.offset > 1)
			add(
				"bad_stop_offset",
				`stop offset must be within 0..1, got ${stop.offset}`,
				`${path}.stops[${i}].offset`,
				id,
			);
		// Skia and every vector format read stops in order; an unsorted list is a
		// different gradient in each, rather than an error in any.
		if (stop.offset < previous)
			add(
				"unsorted_stops",
				`stop ${i} offset ${stop.offset} is below the previous ${previous}`,
				`${path}.stops[${i}].offset`,
				id,
			);
		previous = stop.offset;
	});
	if (fill.kind === "radial" && (!finite(fill.radius) || fill.radius <= 0))
		add(
			"bad_radius",
			`radial radius must be > 0, got ${fill.radius}`,
			`${path}.radius`,
			id,
		);
}

function validateStroke(
	stroke: Stroke,
	path: string,
	add: Add,
	id?: string,
): void {
	if (!finite(stroke.width) || stroke.width < 0)
		add(
			"bad_stroke_width",
			`stroke width must be >= 0, got ${stroke.width}`,
			`${path}.width`,
			id,
		);
	if (stroke.dash && !stroke.dash.every((d) => finite(d) && d >= 0))
		add(
			"bad_dash",
			"dash segments must be finite and >= 0",
			`${path}.dash`,
			id,
		);
	for (const key of ["trimStart", "trimEnd", "trimOffset"] as const) {
		const v = stroke[key];
		if (v === undefined) continue;
		const inRange = key === "trimOffset" || (v >= 0 && v <= 1);
		if (!finite(v) || !inRange)
			add(
				"bad_trim",
				`${key} must be finite${key === "trimOffset" ? "" : " and in [0, 1]"}, got ${v}`,
				`${path}.${key}`,
				id,
			);
	}
}

function validateCornerRadius(
	radius: CornerRadius,
	path: string,
	add: Add,
	id?: string,
): void {
	const values = Array.isArray(radius) ? radius : [radius];
	if (Array.isArray(radius) && radius.length !== 4)
		add(
			"bad_corner_radius",
			`per-corner radius needs 4 entries, got ${radius.length}`,
			path,
			id,
		);
	if (!values.every((v) => finite(v) && v >= 0))
		add(
			"bad_corner_radius",
			"corner radius entries must be finite and >= 0",
			path,
			id,
		);
}
