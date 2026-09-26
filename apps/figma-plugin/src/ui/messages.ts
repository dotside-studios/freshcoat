import { useLayoutEffect, useRef } from "preact/hooks";
import type { MainToUi } from "~/shared/protocol";

/** Listen to messages from the main sandbox for the life of the component.
 *
 *  The listener is attached once and always calls the latest handler, so a
 *  handler can read current state without re-subscribing on every render. It
 *  is attached in a layout effect, in the same task as the render that mounts
 *  the component: main posts its startup messages back to back, and a passive
 *  effect would run after the next of them had already been dispatched. */
export function useMainMessage(handler: (msg: MainToUi) => void): void {
	const ref = useRef(handler);
	ref.current = handler;
	useLayoutEffect(() => {
		const onMessage = (e: MessageEvent): void => {
			const msg = e.data?.pluginMessage as MainToUi | undefined;
			if (msg) ref.current(msg);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);
}
