import type { Template } from "@freshcoat-js/coatfile";
import { toast } from "@freshcoat-js/ui/toast";
import { useSyncExternalStore } from "react";
import { sendableTemplate } from "~/doc/io";
import type { EditorController } from "./controller";
import { plural } from "./copy";

// A page that hands Studio a template with `#coat=<data>&return=<origin>`
// and keeps the tab it opened can have the edited template sent back. The
// template is posted to `window.opener`, addressed to that origin only, so a
// tab that has since navigated elsewhere never receives it:
//
//   Studio → opener  { type: "freshcoat:template", template }
//   opener → Studio  { type: "freshcoat:received" }
//                    { type: "freshcoat:rejected", reason }
//
// Nothing is saved by sending. The opener decides what to do with what it
// receives, and Studio has no account to save it with.

export const TEMPLATE_MESSAGE = "freshcoat:template";
export const RECEIVED_MESSAGE = "freshcoat:received";
export const REJECTED_MESSAGE = "freshcoat:rejected";

/** How long the opener has to answer before Studio says it did not. */
export const REPLY_TIMEOUT_MS = 5000;

export type SendBackTarget = {
	/** The opener's origin, as the link named it. */
	origin: string;
	/** The workspace template that came from it. */
	templateId: string;
};

export type SendReply =
	| { kind: "received" }
	| { kind: "rejected"; reason: string }
	| { kind: "timeout" };

// ── The target ──────────────────────────────────────────────────────────────

let target: SendBackTarget | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

export function setSendBackTarget(next: SendBackTarget | null): void {
	target = next;
	for (const fn of listeners) fn();
}

export function getSendBackTarget(): SendBackTarget | null {
	return target;
}

/** The target, when `templateId` is the template that came from it. */
export function useSendBackTarget(
	templateId: string | undefined,
): SendBackTarget | null {
	const current = useSyncExternalStore(subscribe, getSendBackTarget);
	return current && current.templateId === templateId ? current : null;
}

/** "orders.example.com" for "https://orders.example.com". */
export function hostOf(origin: string): string {
	return new URL(origin).host;
}

// ── Sending ─────────────────────────────────────────────────────────────────

/** Posts `template` to `opener` at `origin` and waits for its answer. Only a
 *  reply from that window and origin counts. */
export function postTemplate(
	opener: Window,
	origin: string,
	template: Template,
	{
		timeoutMs = REPLY_TIMEOUT_MS,
		host = window,
	}: { timeoutMs?: number; host?: Window } = {},
): Promise<SendReply> {
	return new Promise((resolve) => {
		const done = (reply: SendReply) => {
			host.removeEventListener("message", onMessage);
			clearTimeout(timer);
			resolve(reply);
		};
		const onMessage = (event: MessageEvent) => {
			if (event.origin !== origin || event.source !== opener) return;
			const data = event.data as { type?: unknown; reason?: unknown } | null;
			if (data?.type === RECEIVED_MESSAGE) done({ kind: "received" });
			else if (data?.type === REJECTED_MESSAGE)
				done({
					kind: "rejected",
					reason:
						typeof data.reason === "string" && data.reason
							? data.reason
							: "no reason given",
				});
		};
		const timer = setTimeout(() => done({ kind: "timeout" }), timeoutMs);
		host.addEventListener("message", onMessage);
		opener.postMessage({ type: TEMPLATE_MESSAGE, template }, origin);
	});
}

/** Sends the active template back to the tab that opened it, and says how
 *  that went. */
export async function sendBack(controller: EditorController): Promise<void> {
	const active = controller.state.workspace?.activeTemplateId;
	const to = target && target.templateId === active ? target : null;
	const base = controller.base;
	if (!to || !base) return;
	const host = hostOf(to.origin);
	const opener = window.opener as Window | null;
	if (!opener || opener.closed) {
		toast(
			`The ${host} tab that opened this template is closed. Export a .coat and import it there instead.`,
			{ tone: "danger", timeout: 0 },
		);
		return;
	}
	const sendable = sendableTemplate(base);
	if (!sendable.ok) {
		const first = sendable.errors[0];
		toast(
			`Fix ${plural(sendable.errors.length, "issue")} before sending${first ? `: ${first.message}` : ""}`,
			{ tone: "danger" },
		);
		controller.showIssues();
		return;
	}
	const reply = await postTemplate(opener, to.origin, sendable.data);
	if (reply.kind === "received")
		toast(`Sent to ${host}. Review and save it there.`, { tone: "success" });
	else if (reply.kind === "rejected")
		toast(`${host} refused the template: ${reply.reason}`, {
			tone: "danger",
			timeout: 0,
		});
	else
		toast(
			`${host} didn't answer. Is the page that opened this template still open?`,
			{ tone: "danger", timeout: 0 },
		);
}
