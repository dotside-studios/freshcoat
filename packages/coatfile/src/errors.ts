export type CoatErrorCode =
	| "newer_format_version"
	| "unsupported_format_version"
	| "invalid_package"
	| "wrong_media_type"
	| "missing_template"
	| "invalid_json"
	| "missing_asset"
	| "asset_hash_mismatch"
	| "package_too_large"
	| "hash_failed"
	| "read_failed"
	| "write_failed"
	| "invalid_template"
	| "unknown_variant"
	| "unknown_element_type"
	| "aspect_mismatch"
	| "invalid_target"
	| "unresolved_asset"
	| "unknown_side"
	| "unknown_slice"
	| "open_slice"
	| "multiple_piece_sides"
	| "image_sample_failed"
	| "invalid_svg";

export type CoatErrorOptions = {
	/** A JSON pointer into the template, when the error is about one place. */
	path?: string;
	cause?: unknown;
};

/** The one error coatfile throws. Match on `code`, not on `message`. */
export class CoatError extends Error {
	readonly path?: string;

	constructor(
		readonly code: CoatErrorCode,
		message: string,
		options: CoatErrorOptions = {},
	) {
		super(message, options.cause === undefined ? {} : { cause: options.cause });
		this.name = "CoatError";
		if (options.path !== undefined) this.path = options.path;
	}
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
