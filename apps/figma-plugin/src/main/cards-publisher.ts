import type { CardsMessage } from "~/shared/protocol";

export type CardsView = Omit<
	CardsMessage,
	"type" | "selectedCardId" | "selectedNodeId"
>;
type SelectedIds = Pick<CardsMessage, "selectedCardId" | "selectedNodeId">;

/** Posts the card list, recomputing it only after `invalidate`. A selection
 *  change reuses the cached view and only re-derives the selected ids, so a
 *  click costs no page traversal. Every publish takes a sequence number and
 *  only the latest one posts, so an older, slower publish cannot overwrite a
 *  newer result. */
export function createCardsPublisher(opts: {
	compute: () => Promise<CardsView>;
	selected: (view: CardsView) => SelectedIds;
	post: (msg: CardsMessage) => void;
	delayMs?: number;
}) {
	let cached: Promise<CardsView> | null = null;
	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const cancelScheduled = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	async function publish(): Promise<void> {
		cancelScheduled();
		const mine = ++seq;
		let pending: Promise<CardsView>;
		let view: CardsView;
		do {
			pending = cached ??= opts.compute();
			try {
				view = await pending;
			} catch {
				if (cached === pending) cached = null;
				return;
			}
			if (mine !== seq) return;
			// Invalidated while computing: the view may predate the change.
		} while (cached !== pending);
		opts.post({ type: "cards", ...view, ...opts.selected(view) });
	}

	return {
		publish,
		/** The current view, computed only if invalidated since the last one. */
		async view(): Promise<CardsView> {
			for (;;) {
				cached ??= opts.compute();
				const pending = cached;
				try {
					const view = await pending;
					if (cached === pending) return view;
				} catch (err) {
					if (cached === pending) cached = null;
					throw err;
				}
			}
		},
		/** Coalesce bursts (rapid clicks, drag-select) into one publish. */
		schedule(): void {
			cancelScheduled();
			timer = setTimeout(() => {
				timer = null;
				void publish();
			}, opts.delayMs ?? 50);
		},
		invalidate(): void {
			cached = null;
		},
	};
}
