import { afterEach, describe, expect, test, vi } from "vitest";
import { loadFor, once } from "~/app/lazy";

const toast = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("@freshcoat-js/ui/toast", async (actual) => ({
	...(await actual<object>()),
	toast,
}));

const COPY = { loading: "Loading", failed: "Failed" };

afterEach(() => {
	vi.useRealTimers();
	toast.mockClear();
});

describe("once", () => {
	test("shares one load", async () => {
		const load = vi.fn(async () => 1);
		const get = once(load);
		expect(await Promise.all([get(), get()])).toEqual([1, 1]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	test("retries after a failed load", async () => {
		const load = vi
			.fn<() => Promise<number>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(2);
		const get = once(load);
		await expect(get()).rejects.toThrow("offline");
		expect(await get()).toBe(2);
	});
});

describe("loadFor", () => {
	test("resolves what loaded, quietly when it is quick", async () => {
		expect(
			await loadFor(
				async () => 3,
				COPY,
				() => {},
			),
		).toBe(3);
		expect(toast).not.toHaveBeenCalled();
	});

	test("says it is loading when the load is slow, then closes it", async () => {
		vi.useFakeTimers();
		const close = vi.fn();
		toast.mockReturnValueOnce(close);
		let resolve = (_: number) => {};
		const pending = loadFor(
			() => new Promise<number>((r) => (resolve = r)),
			COPY,
			() => {},
		);
		await vi.advanceTimersByTimeAsync(500);
		expect(toast).toHaveBeenCalledWith("Loading", { timeout: 0 });
		resolve(4);
		expect(await pending).toBe(4);
		expect(close).toHaveBeenCalled();
	});

	test("reports a failed load with a retry and resolves null", async () => {
		const retry = vi.fn();
		const out = await loadFor(
			() => Promise.reject(new Error("offline")),
			COPY,
			retry,
		);
		expect(out).toBeNull();
		const [message, options] = toast.mock.calls[0] as unknown as [
			string,
			{ tone: string; action: { label: string; onAction(): void } },
		];
		expect(message).toBe("Failed");
		expect(options.tone).toBe("danger");
		options.action.onAction();
		expect(retry).toHaveBeenCalled();
	});
});
