import type { TableFormat } from "../types";
import type { WorkbookCodec } from "./codec";

export {
	cellText,
	type WorkbookCell,
	type WorkbookCodec,
	type WorkbookSheet,
} from "./codec";

type LoadCodec = () => Promise<WorkbookCodec>;

const hucre: LoadCodec = async () => (await import("./hucre")).hucreCodec;

/** The codec that reads each workbook extension. Codecs load on first use. */
export const WORKBOOK_READERS: Readonly<Record<string, LoadCodec>> = {
	xlsx: hucre,
	xlsm: hucre,
	xls: hucre,
	ods: hucre,
};

/** The codec that writes each workbook format. */
export const WORKBOOK_WRITERS: Readonly<
	Partial<Record<TableFormat, LoadCodec>>
> = { xlsx: hucre };
