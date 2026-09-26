import type { UiToMain } from "~/shared/protocol";

/** Send a message to the main sandbox. The UI runs in an iframe, so everything
 *  it asks the document to do goes through here. */
export function postToMain(message: UiToMain): void {
	parent.postMessage({ pluginMessage: message }, "*");
}
