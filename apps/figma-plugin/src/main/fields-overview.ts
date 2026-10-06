import type { FieldOverviewItem } from "~/shared/protocol";

/** The fields overview, kept per top-level frame so an edit rescans only the
 *  frame it touched. */
export function createFieldsOverview<F extends { id: string }>(
	scan: (frame: F) => FieldOverviewItem[],
) {
	let byFrame = new Map<string, FieldOverviewItem[]>();

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
	};
}
