import type { Template } from "./types";

export type TemplateModule =
	| Template
	| Promise<Template>
	| (() => Template | Promise<Template>);

export function defineTemplate<T extends TemplateModule>(template: T): T {
	return template;
}
