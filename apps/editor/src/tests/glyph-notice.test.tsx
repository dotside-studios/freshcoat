import type { Template } from "@freshcoat-js/coatfile";
import type {
	GlyphCheckItem,
	GlyphIssue,
} from "@freshcoat-js/workspace/export";
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ChecksList } from "~/export/Checks";
import { exportChecks } from "~/export/checks";
import { type GlyphWorker, useGlyphPreflight } from "~/export/glyph-client";
import type { GlyphWorkerRequest } from "~/export/protocol";

const template = { id: "badge" } as unknown as Template;

const item = (recordId: string): GlyphCheckItem => ({
	recordId,
	side: "front",
	values: { name: recordId },
});

const ITEMS = [item("r1"), item("r2"), item("r3")];

afterEach(cleanup);

function fakeWorker() {
	const sent: GlyphWorkerRequest[] = [];
	const worker: GlyphWorker = {
		postMessage: (m) => sent.push(m),
		terminate: vi.fn(),
		onmessage: null,
		onerror: null,
	};
	const answer = (id: number, issues: GlyphIssue[]) =>
		act(() =>
			worker.onmessage?.({
				data: { type: "result", id, issues },
			} as MessageEvent),
		);
	return { worker, sent, answer };
}

describe("useGlyphPreflight", () => {
	test("sends the template and fonts once and keeps only the latest answer", async () => {
		vi.useFakeTimers();
		try {
			const fake = fakeWorker();
			const fonts = new Map([["Geist", [new Uint8Array([1])]]]);
			const { result, rerender } = renderHook(
				({ items }) =>
					useGlyphPreflight(template, fonts, items, () => fake.worker),
				{ initialProps: { items: ITEMS } },
			);
			expect(result.current).toBeNull();
			await act(() => vi.advanceTimersByTimeAsync(300));
			expect(fake.sent[0]?.template).toBe(template);
			expect(fake.sent[0]?.fonts).toEqual([...fonts]);

			rerender({ items: ITEMS.slice(1) });
			await act(() => vi.advanceTimersByTimeAsync(300));
			expect(fake.sent[1]?.template).toBeUndefined();
			expect(fake.sent[1]?.fonts).toBeUndefined();
			expect(fake.sent[1]?.items.map((i) => i.recordId)).toEqual(["r2", "r3"]);

			const stale = fake.sent[0]?.id as number;
			const latest = fake.sent[1]?.id as number;
			const issue: GlyphIssue = {
				recordId: "r2",
				side: "front",
				text: "김",
				codepoints: [0xae40],
			};
			fake.answer(stale, []);
			expect(result.current).toBeNull();
			fake.answer(latest, [issue]);
			expect(result.current).toEqual([issue]);
		} finally {
			vi.useRealTimers();
		}
	});

	test("an export with nothing to check has no issues", () => {
		const { result } = renderHook(() =>
			useGlyphPreflight(template, undefined, [], () => fakeWorker().worker),
		);
		expect(result.current).toEqual([]);
	});
});

describe("glyph checks", () => {
	const issues: GlyphIssue[] = [
		{
			recordId: "r2",
			side: "front",
			elementId: "name",
			text: "김민준",
			codepoints: [0xae40],
		},
	];
	const input = {
		blocked: null,
		unbound: false,
		unfilled: 0,
		glyphs: issues,
		failed: 0,
		labelFor: (id: string) => (id === "r2" ? "Minjun" : id),
		showSide: false,
		canPick: true,
	};

	test("summarizes, lists records and picks one", () => {
		const onTarget = vi.fn();
		render(<ChecksList checks={exportChecks(input)} onTarget={onTarget} />);
		const check = screen.getByTestId("export-check-glyphs");
		expect(check.textContent).toContain(
			"1 record has characters the fonts can't draw: 김",
		);
		const list = screen.getByTestId("export-check-glyphs-list");
		expect(list.textContent).toContain("name");
		expect(list.textContent).toContain("김 U+AE40");
		fireEvent.click(screen.getByRole("button", { name: "Minjun" }));
		expect(onTarget).toHaveBeenCalledWith({ kind: "record", recordId: "r2" });
	});

	test("shows all clear without issues", () => {
		render(
			<ChecksList
				checks={exportChecks({ ...input, glyphs: [] })}
				onTarget={() => {}}
			/>,
		);
		expect(screen.queryByTestId("export-check-glyphs")).toBeNull();
		expect(screen.getByTestId("export-checks-clear")).toBeTruthy();
	});

	test("orders what blocks the export first", () => {
		const checks = exportChecks({
			...input,
			blocked: { reason: "nothing", message: "Nothing to export" },
			unbound: true,
			unfilled: 2,
			failed: 1,
		});
		expect(checks.map((c) => c.id)).toEqual([
			"blocked",
			"unbound",
			"unfilled",
			"glyphs",
			"failed",
		]);
		expect(checks[0]?.severity).toBe("error");
	});
});
