/** Hand a file to the browser.
 *
 *  Call this from a user gesture. A plugin's UI is a sandboxed iframe, where the
 *  browser grants the one download the click asked for and silently drops any
 *  further one issued in the same task, so two files means two clicks, not two
 *  calls in a row.
 *
 *  The object URL is revoked on the next tick rather than immediately: the
 *  download reads the blob asynchronously, and revoking in the same task can cut
 *  it off before it starts. */
export function download(fileName: string, file: Blob): void {
	const url = URL.createObjectURL(file);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
