import type { Template } from "@freshcoat-js/coatfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	getSendBackTarget,
	hostOf,
	postTemplate,
	RECEIVED_MESSAGE,
	REJECTED_MESSAGE,
	setSendBackTarget,
	TEMPLATE_MESSAGE,
} from "~/app/send-back";
import { returnOrigin } from "~/app/url-state";
import { doc } from "./doc-fixture";

const ORIGIN = "https://orders.example.com";

function fakeOpener() {
	const posted: { message: unknown; origin: string }[] = [];
	const opener = {
		postMessage: (message: unknown, origin: string) =>
			posted.push({ message, origin }),
	} as unknown as Window;
	return { opener, posted };
}

function deliver(
	host: EventTarget,
	data: unknown,
	origin: string,
	source: unknown,
): void {
	const event = new Event("message");
	Object.assign(event, { data, origin, source });
	host.dispatchEvent(event);
}

afterEach(() => {
	vi.useRealTimers();
	setSendBackTarget(null);
});

describe("postTemplate", () => {
	test("posts the template to the opener's origin only", async () => {
		const host = new EventTarget() as Window;
		const { opener, posted } = fakeOpener();
		const template = doc() as Template;
		const reply = postTemplate(opener, ORIGIN, template, { host });
		expect(posted).toEqual([
			{ message: { type: TEMPLATE_MESSAGE, template }, origin: ORIGIN },
		]);
		deliver(host, { type: RECEIVED_MESSAGE }, ORIGIN, opener);
		await expect(reply).resolves.toEqual({ kind: "received" });
	});

	test("passes on a refusal and its reason", async () => {
		const host = new EventTarget() as Window;
		const { opener } = fakeOpener();
		const reply = postTemplate(opener, ORIGIN, doc() as Template, { host });
		deliver(
			host,
			{ type: REJECTED_MESSAGE, reason: "unsaved changes" },
			ORIGIN,
			opener,
		);
		await expect(reply).resolves.toEqual({
			kind: "rejected",
			reason: "unsaved changes",
		});
	});

	test("ignores answers from another origin or another window", async () => {
		vi.useFakeTimers();
		const host = new EventTarget() as Window;
		const { opener } = fakeOpener();
		const reply = postTemplate(opener, ORIGIN, doc() as Template, {
			host,
			timeoutMs: 1000,
		});
		deliver(host, { type: RECEIVED_MESSAGE }, "https://evil.example", opener);
		deliver(host, { type: RECEIVED_MESSAGE }, ORIGIN, {});
		vi.advanceTimersByTime(1000);
		await expect(reply).resolves.toEqual({ kind: "timeout" });
	});
});

describe("returnOrigin", () => {
	test("keeps the origin of an https or local address", () => {
		expect(returnOrigin("https://orders.example.com/admin/x?y=1")).toBe(ORIGIN);
		expect(returnOrigin("http://localhost:3000")).toBe("http://localhost:3000");
	});

	test("refuses plain http elsewhere, sign-ins and non-addresses", () => {
		expect(returnOrigin("http://orders.example.com")).toBeNull();
		expect(returnOrigin("https://me:pw@orders.example.com")).toBeNull();
		expect(returnOrigin("javascript:alert(1)")).toBeNull();
		expect(returnOrigin("")).toBeNull();
	});
});

describe("the target", () => {
	test("is set and cleared", () => {
		setSendBackTarget({ origin: ORIGIN, templateId: "t1" });
		expect(getSendBackTarget()).toEqual({ origin: ORIGIN, templateId: "t1" });
		setSendBackTarget(null);
		expect(getSendBackTarget()).toBeNull();
	});

	test("is named by its host", () => {
		expect(hostOf("https://orders.example.com:8443")).toBe(
			"orders.example.com:8443",
		);
	});
});
