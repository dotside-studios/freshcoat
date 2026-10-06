import type { FieldOverviewItem } from "~/shared/protocol";

/** The fields overview, kept per top-level frame so an edit rescans only the
 *  frame it touched. */
export function createFieldsOverview<F extends { id: string }>(
	scan: (frame: F) => FieldOverviewItem[],
) {
	let byFrame = new Map<string, FieldOverviewItem[]>();
	let frameOfNode = new Map<string, string>();

	function collect(
		frames: F[],
		rescan: (id: string) => boolean,
	): FieldOverviewItem[] {
		const next = new Map<string, FieldOverviewItem[]>();
		for (const frame of frames) {
			const cached = rescan(frame.id) ? undefined : byFrame.get(frame.id);
			next.set(frame.id, cached ?? scan(frame));
		}
		byFrame = next;
		frameOfNode = new Map();
		for (const [frameId, items] of next)
			for (const item of items)
				for (const nodeId of item.nodeIds) frameOfNode.set(nodeId, frameId);
		return [...next.values()].flat();
	}

	return {
		/** Scan every frame. */
		all: (frames: F[]): FieldOverviewItem[] => collect(frames, () => true),
		/** Rescan the `changed` frames and any not seen before. */
		update(frames: F[], changed: Iterable<string>): FieldOverviewItem[] {
			const ids = new Set(changed);
			return collect(frames, (id) => ids.has(id));
		},
		/** The cached frame a node id is, or is bound inside of, if any. */
		frameOf: (nodeId: string): string | undefined =>
			byFrame.has(nodeId) ? nodeId : frameOfNode.get(nodeId),
	};
}
