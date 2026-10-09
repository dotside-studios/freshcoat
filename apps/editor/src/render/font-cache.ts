/** Font bytes Studio has fetched this session, shared by every resolve. */
export const fontCache = new Map<string, Promise<Uint8Array[]>>();
