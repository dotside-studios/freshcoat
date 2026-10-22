#!/usr/bin/env node
import { listenForCancel } from "./cancel";
import { processIo } from "./io";
import { run } from "./main";

const cancel = listenForCancel();
let code: number;
try {
	code = await run(
		process.argv.slice(2),
		{ ...processIo(), signal: cancel.signal },
		(name) => {
			cancel.cancellable = name === "render";
		},
	);
} finally {
	cancel.dispose();
}
process.exitCode = code;
if (code === 130 || code === 143) process.exit(code);
