// WASM heap bytes in use: the heap's size less what 1 MiB mallocs can still
// claim before it has to grow. Accurate to about 1 MiB.
export function heapInUse(ck: any): number {
	const MiB = 1 << 20;
	const size = ck.HEAPU8.byteLength;
	const claimed: number[] = [];
	let free = 0;
	try {
		for (;;) {
			const ptr = ck._malloc(MiB);
			if (!ptr) break;
			claimed.push(ptr);
			if (ck.HEAPU8.byteLength !== size) break;
			free += MiB;
		}
	} finally {
		for (const ptr of claimed) ck._free(ptr);
	}
	return size - free;
}
