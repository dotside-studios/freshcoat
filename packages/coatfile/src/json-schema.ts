import { z } from "zod";
import { FORMAT_MAJOR } from "./format";
import { TemplateSchema } from "./schemas";

// Served by the npm CDN from the published package, so the address needs no
// host of its own and resolves for as long as a 1.x release exists.
export const TEMPLATE_SCHEMA_ID = `https://cdn.jsdelivr.net/npm/@freshcoat/coatfile@${FORMAT_MAJOR}/schema/coatfile.v${FORMAT_MAJOR}.schema.json`;

/** The JSON Schema for a template's shape. See scripts/build-json-schema.ts. */
export function templateJsonSchema(): Record<string, unknown> {
	const generated = z.toJSONSchema(TemplateSchema, {
		io: "input",
		unrepresentable: "any",
	}) as Record<string, unknown>;
	const { $schema, ...rest } = generated;
	return {
		$schema,
		$id: TEMPLATE_SCHEMA_ID,
		title: "Coatfile",
		description: `A freshcoat template (coatfile), format ${FORMAT_MAJOR}.x. Shape only: validate() also enforces unique ids, resolvable variant overrides and declared mustache fields.`,
		...rest,
	};
}
