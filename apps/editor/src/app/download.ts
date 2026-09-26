/** Hands bytes to the browser as a download. A Blob is handed over as it
 *  is, without reading it. */
export async function downloadBytes(
	data: Uint8Array | string | Blob,
	name: string,
	type: string,
): Promise<void> {
	const blob =
		data instanceof Blob && data.type === type
			? data
			: new Blob([data as BlobPart], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
