import type { BindProperty, FieldFormat } from "~/lib/figma/binding";

// Names for binding properties and field formats, shared by the Layer and
// Fields tabs.

const PROPERTY_LABEL: Record<BindProperty, string> = {
	text: "Text",
	textColor: "Text color",
	fill: "Fill color",
	image: "Image",
	qr: "QR code",
	barcode: "Barcode",
};

/** The order a layer's choices are offered in: content first, then color. */
const PROPERTY_ORDER: BindProperty[] = [
	"text",
	"image",
	"qr",
	"barcode",
	"textColor",
	"fill",
];

const FORMAT_LABEL: Record<FieldFormat, string> = {
	text: "Text",
	longText: "Long text",
	color: "Color",
	url: "URL",
	image: "Image",
	boolean: "Toggle",
};

export function propertyLabel(property: BindProperty): string {
	return PROPERTY_LABEL[property] ?? property;
}

export function formatLabel(format: FieldFormat): string {
	return FORMAT_LABEL[format] ?? format;
}

export function byPropertyOrder(a: BindProperty, b: BindProperty): number {
	return PROPERTY_ORDER.indexOf(a) - PROPERTY_ORDER.indexOf(b);
}
