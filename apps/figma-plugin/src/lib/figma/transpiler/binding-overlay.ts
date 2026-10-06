import {
	type BindingResolver,
	buildFieldMeta,
	type FieldMeta,
	resolveNodeBinding,
} from "../binding";
import type { FigmaNode } from "../types";
import { extractTokens } from "./fields";

const TOKEN = /\{\{[^{}]*\}\}/g;

// A text field keeps its runs' styling only when the runs spell out the
// template itself, each token whole inside one run, so every token is filled
// in where it was typed and in that run's style. Otherwise the field's value
// replaces the whole text in the first run's style.
function spansSpellTemplate(spans: unknown, template: string): boolean {
	if (!Array.isArray(spans)) return false;
	const texts = (spans as Array<{ text: string }>).map((s) => s.text);
	if (texts.join("") !== template) return false;
	const whole = texts.reduce((n, t) => n + (t.match(TOKEN)?.length ?? 0), 0);
	return whole === (template.match(TOKEN)?.length ?? 0);
}

// Drive an element from the node's binding (stored pluginData, else live). The
// single source for field registration + value templating across kinds:
//  - text value, text color, shape/frame fill (templated here)
//  - image / qr (the element transpiler already templated src/value; we own the
//    field registration so metadata is uniform)
// A text binding on a non-text element is ignored (inferNodeBinding returns
// nothing for that case). Registers only the field ids actually applied.
export function applyBindingOverlay(
	node: FigmaNode,
	el: Record<string, unknown>,
	overlayMeta: Map<string, FieldMeta>,
	resolveBinding: BindingResolver = resolveNodeBinding,
): void {
	const binding = resolveBinding(node);
	if (!binding) return;

	const props = el.properties as Record<string, unknown>;
	const applied = new Set<string>();
	const mark = (tmpl: string): void => {
		for (const id of extractTokens(tmpl)) applied.add(id);
	};

	if (el.type === "text" && binding.bind.text !== undefined) {
		if (
			props.value !== binding.bind.text &&
			!spansSpellTemplate(props.spans, binding.bind.text)
		) {
			props.value = binding.bind.text;
			delete props.spans;
		}
		mark(binding.bind.text);
	}

	if (el.type === "text" && binding.bind.textColor !== undefined) {
		props.color = binding.bind.textColor;
		delete props.fill;
		if (Array.isArray(props.spans))
			for (const span of props.spans as Array<Record<string, unknown>>)
				delete span.color;
		mark(binding.bind.textColor);
	}
	if (
		(el.type === "rect" || el.type === "frame") &&
		binding.bind.fill !== undefined
	) {
		props.fill = binding.bind.fill;
		mark(binding.bind.fill);
	}
	if (el.type === "image" && binding.bind.image !== undefined) {
		mark(binding.bind.image);
	}
	if (el.type === "qr_code" && binding.bind.qr !== undefined) {
		mark(binding.bind.qr);
	}
	// A placeholder standing in for a barcode that cannot be drawn carries no
	// value, so it asks for no field.
	if (
		el.type === "barcode" &&
		binding.bind.barcode !== undefined &&
		props.value !== ""
	) {
		mark(binding.bind.barcode);
	}

	for (const draft of binding.fields) {
		if (applied.has(draft.id) && !overlayMeta.has(draft.id)) {
			overlayMeta.set(draft.id, buildFieldMeta(draft));
		}
	}
}
