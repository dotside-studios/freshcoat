import type { FieldDefinition, Template } from "@freshcoat-js/coatfile";

export type FieldEntry = { id: string; field: FieldDefinition };

/** Fields in declaration order. */
export function listFields(template: Template): FieldEntry[] {
	return Object.entries(template.fields.properties).map(([id, field]) => ({
		id,
		field,
	}));
}
