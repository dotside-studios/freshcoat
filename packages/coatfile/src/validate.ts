import { TemplateSchema } from "./schemas";
import type {
	FieldsSchema,
	Template,
	ValidationError,
	ValidationResult,
} from "./types";

export function validate(input: unknown): ValidationResult<Template> {
	const result = TemplateSchema.safeParse(input);
	if (result.success) return { ok: true, value: result.data };
	return {
		ok: false,
		errors: adaptIssues(result.error.issues as unknown as ZodIssueLite[]),
	};
}

type ZodIssueLite = {
	code: string;
	path: (string | number)[];
	message: string;
	params?: Record<string, unknown>;
};

const BUILTIN_CODE_MAP: Record<string, string> = {
	invalid_type: "invalid_shape",
	invalid_union: "invalid_shape",
	invalid_value: "invalid_shape",
	invalid_key: "invalid_shape",
	invalid_element: "invalid_shape",
	too_small: "invalid_shape",
	too_big: "invalid_shape",
	invalid_format: "invalid_shape",
	unrecognized_keys: "invalid_shape",
	invalid_literal: "invalid_shape",
	invalid_enum_value: "invalid_shape",
};

function adaptIssues(issues: readonly ZodIssueLite[]): ValidationError[] {
	return issues.map(issueToError);
}

const TOP_LEVEL_FIELD_CODES: Record<string, string> = {
	format_version: "missing_format_version",
	id: "missing_required_field",
	name: "missing_required_field",
	width: "invalid_dimension",
	height: "invalid_dimension",
	template_data: "invalid_template_data",
	fields: "invalid_fields_schema",
};

function issueToError(issue: ZodIssueLite): ValidationError {
	const path = pathToPointer(issue.path);
	if (issue.code === "custom") {
		const kitCode = (issue.params as { kitCode?: string } | undefined)?.kitCode;
		if (kitCode) {
			return { path, code: kitCode, message: issue.message };
		}
	}
	if (
		issue.code === "invalid_union" &&
		issue.path.includes("background") &&
		issue.path[issue.path.length - 1] === "type"
	) {
		return { path, code: "invalid_background_type", message: issue.message };
	}
	if (path === "" && issue.code === "invalid_type") {
		return { path: "", code: "not_an_object", message: issue.message };
	}
	if (issue.path.length === 1 && issue.code === "invalid_type") {
		const key = String(issue.path[0]);
		const code = TOP_LEVEL_FIELD_CODES[key];
		if (code) return { path, code, message: issue.message };
	}
	return {
		path,
		code: BUILTIN_CODE_MAP[issue.code] ?? "invalid_shape",
		message: issue.message,
	};
}

function pathToPointer(path: (string | number)[]): string {
	if (path.length === 0) return "";
	return "/" + path.map(String).join("/");
}

export function validateValues(
	values: unknown,
	fields: FieldsSchema,
): ValidationResult<Record<string, unknown>> {
	const errors: ValidationError[] = [];
	if (values === null || typeof values !== "object" || Array.isArray(values)) {
		return {
			ok: false,
			errors: [
				{
					path: "",
					code: "not_an_object",
					message: "values must be an object",
				},
			],
		};
	}
	const v = values as Record<string, unknown>;

	for (const req of fields.required ?? []) {
		// A boolean left unset is its default, which is an answer.
		if (fields.properties[req]?.format === "boolean") continue;
		const got = v[req];
		if (got === undefined || got === null || got === "") {
			errors.push({
				path: `/${req}`,
				code: "missing_required_value",
				message: `${req} is required`,
			});
		}
	}

	for (const [key, raw] of Object.entries(v)) {
		const def = fields.properties[key];
		if (!def) continue;
		if (typeof raw !== "string") {
			errors.push({
				path: `/${key}`,
				code: "invalid_value_type",
				message: `${key} must be a string`,
			});
			continue;
		}
		if (def.format === "boolean" && raw !== "true" && raw !== "false") {
			errors.push({
				path: `/${key}`,
				code: "invalid_boolean_value",
				message: `${key} must be "true" or "false"`,
			});
			continue;
		}
		if (def.maxLength !== undefined && raw.length > def.maxLength) {
			errors.push({
				path: `/${key}`,
				code: "value_too_long",
				message: `${key} exceeds maxLength ${def.maxLength}`,
			});
		}
		if (def.minLength !== undefined && raw.length < def.minLength) {
			errors.push({
				path: `/${key}`,
				code: "value_too_short",
				message: `${key} below minLength ${def.minLength}`,
			});
		}
		if (def.pattern !== undefined) {
			const re = compiledPattern(def.pattern);
			if (re !== null && !re.test(raw)) {
				errors.push({
					path: `/${key}`,
					code: "value_pattern_mismatch",
					message: `${key} does not match pattern`,
				});
			}
		}
	}

	if (errors.length) return { ok: false, errors };
	return { ok: true, value: v };
}

const patterns = new Map<string, RegExp | null>();

function compiledPattern(pattern: string): RegExp | null {
	let re = patterns.get(pattern);
	if (re === undefined) {
		try {
			re = new RegExp(pattern);
		} catch {
			// ignore invalid regex in schema
			re = null;
		}
		patterns.set(pattern, re);
	}
	return re;
}
