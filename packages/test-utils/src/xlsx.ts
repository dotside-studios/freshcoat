import { crc32 } from "node:zlib";
import { Deflate, strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const cell = (ref: string) =>
	`<c r="${ref}" t="inlineStr"><is><t>x</t></is></c>`;
const SHEET = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cell("A1")}</row><row r="1048576">${cell("ALL1048576")}</row></sheetData></worksheet>`;

const MIB = 1 << 20;

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

/** An entry of `mib` MiB of spaces. One MiB is deflated once and its block
 *  written for every MiB, so a large entry costs no compression time. */
class SpacesEntry extends ZipPassThrough {
	private readonly block: Uint8Array<ArrayBuffer>;
	private readonly spaces = new Uint8Array(MIB).fill(0x20);

	constructor(
		name: string,
		private readonly mib: number,
	) {
		super(name);
		this.compression = 8;
		this.crc = 0;
		const parts: Uint8Array[] = [];
		const deflate = new Deflate((chunk) => parts.push(chunk));
		deflate.push(this.spaces);
		deflate.flush(true);
		this.block = concat(parts);
	}

	write() {
		for (let i = 0; i < this.mib; i++) {
			this.size += MIB;
			this.crc = crc32(this.spaces, this.crc);
			this.ondata(null, this.block, false);
		}
		this.ondata(null, new Uint8Array([0x03, 0x00]), true);
	}
}

function xlsx(workbook: string | SpacesEntry): Uint8Array {
	const chunks: Uint8Array[] = [];
	const archive = new Zip((err, chunk) => {
		if (err) throw err;
		chunks.push(chunk);
	});
	const add = (name: string, text: string) => {
		const file = new ZipDeflate(name);
		archive.add(file);
		file.push(strToU8(text), true);
	};
	add("[Content_Types].xml", CONTENT_TYPES);
	add("_rels/.rels", ROOT_RELS);
	add("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
	if (typeof workbook === "string") add("xl/workbook.xml", workbook);
	else {
		archive.add(workbook);
		workbook.write();
	}
	add("xl/worksheets/sheet1.xml", SHEET);
	archive.end();
	return concat(chunks);
}

/** A 700 KB xlsx whose `xl/workbook.xml` inflates to 700 MiB of spaces. */
export function workbookBomb(): Uint8Array {
	return xlsx(new SpacesEntry("xl/workbook.xml", 700));
}

/** A 1.6 KB xlsx with one cell at A1 and one at ALL1048576, a sheet of
 *  1,048,576 rows by 1,000 columns. */
export function cornerCells(): Uint8Array {
	return xlsx(WORKBOOK);
}
