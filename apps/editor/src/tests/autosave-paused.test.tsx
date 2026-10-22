import "fake-indexeddb/auto";
import { ToastRegion } from "@freshcoat-js/ui/toast";
import {
	act,
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	autosavePaused,
	createAutosaveStore,
	loadAutosave,
	rereadAutosave,
	writeAutosave,
} from "~/app/autosave";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { AUTOSAVE_COPY } from "~/app/copy";
import { unloadWarns } from "~/app/Editor";
import { StatusBar } from "~/app/StatusBar";
import { workspaceSnapshot } from "~/state/workspace";
import { fastUser } from "./aria";
import { readSaved } from "./autosave-read";
import { doc } from "./doc-fixture";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function breakGets(): () => void {
	const get = vi
		.spyOn(IDBObjectStore.prototype, "get")
		.mockImplementation(() => {
			throw new DOMException("broken", "UnknownError");
		});
	return () => get.mockRestore();
}

function entry(c: EditorController, fileName: string) {
	const workspace = workspaceSnapshot(c.state);
	if (!workspace) throw new Error("no workspace");
	return { workspace, fileName };
}

function putCurrent(value: unknown): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open("freshcoat");
		req.onerror = () => reject(req.error);
		req.onsuccess = () => {
			const db = req.result;
			const tx = db.transaction("autosave", "readwrite");
			tx.objectStore("autosave").put(value, "current");
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => reject(tx.error);
		};
	});
}

const stored = async () =>
	(await readSaved(createAutosaveStore("freshcoat")))?.fileName;

async function mountBlocked(corrupt = false) {
	const c = new EditorController();
	c.open(doc(), "doc.coat");
	render(
		<ControllerProvider controller={c}>
			<StatusBar />
			<ToastRegion />
		</ControllerProvider>,
	);
	await act(() => writeAutosave(entry(c, "old")));
	if (corrupt)
		await putCurrent({ version: "bad", fileName: "bad", savedAt: 1 });
	const fix = corrupt ? () => {} : breakGets();
	await act(async () => {
		expect(await loadAutosave()).toBeNull();
	});
	fix();
	return { c, user: fastUser() };
}

async function dismissReadFailed(user: ReturnType<typeof fastUser>) {
	const toast = await screen.findByRole("alertdialog", {
		name: AUTOSAVE_COPY.readFailed,
	});
	await user.click(within(toast).getByRole("button", { name: "Dismiss" }));
	await waitFor(() =>
		expect(
			screen.queryByRole("alertdialog", { name: AUTOSAVE_COPY.readFailed }),
		).toBeNull(),
	);
}

async function openIndicator(user: ReturnType<typeof fastUser>) {
	await user.click(screen.getByRole("button", { name: AUTOSAVE_COPY.paused }));
	return screen.findByRole("dialog", { name: AUTOSAVE_COPY.paused });
}

describe("autosave paused", () => {
	it("stays reachable after both toasts are dismissed, and Retry resumes", async () => {
		const { c, user } = await mountBlocked();
		await dismissReadFailed(user);
		await act(() => writeAutosave(entry(c, "first")));
		await dismissReadFailed(user);
		await act(() => writeAutosave(entry(c, "second")));
		expect(
			screen.queryByRole("alertdialog", { name: AUTOSAVE_COPY.readFailed }),
		).toBeNull();
		expect(await stored()).toBe("old");

		let dialog = await openIndicator(user);
		const fix = breakGets();
		await user.click(
			within(dialog).getByRole("button", { name: AUTOSAVE_COPY.retry }),
		);
		await waitFor(() => expect(autosavePaused()).toBe("failed"));
		fix();
		await dismissReadFailed(user);

		dialog = await openIndicator(user);
		await user.click(
			within(dialog).getByRole("button", { name: AUTOSAVE_COPY.retry }),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: AUTOSAVE_COPY.paused }),
			).toBeNull(),
		);
		expect(autosavePaused()).toBeNull();
		expect(await stored()).toBe("old");
	});

	it("Discard clears the old autosave and writes the held edits", async () => {
		const { c, user } = await mountBlocked(true);
		await dismissReadFailed(user);
		await act(() => writeAutosave(entry(c, "held")));
		await dismissReadFailed(user);
		expect(await stored()).toBeUndefined();

		const dialog = await openIndicator(user);
		await user.click(
			within(dialog).getByRole("button", { name: AUTOSAVE_COPY.discard }),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: AUTOSAVE_COPY.paused }),
			).toBeNull(),
		);
		await waitFor(async () => expect(await stored()).toBe("held"));
		c.select(["0/0"]);
		c.deleteSelection();
		await act(() => writeAutosave(entry(c, "next")));
		expect(await stored()).toBe("next");
	});

	it("Discard keeps an autosave another tab wrote since the read failed", async () => {
		const { c, user } = await mountBlocked(true);
		await dismissReadFailed(user);
		await act(() => writeAutosave(entry(c, "held")));
		await dismissReadFailed(user);
		await act(() =>
			createAutosaveStore("freshcoat", { tabId: "b" }).write(entry(c, "b")),
		);

		const dialog = await openIndicator(user);
		await user.click(
			within(dialog).getByRole("button", { name: AUTOSAVE_COPY.discard }),
		);
		await waitFor(() => expect(autosavePaused()).toBeNull());
		expect(await stored()).toBe("b");
	});

	it("stays paused when Retry finds an autosave from a newer version", async () => {
		const { c, user } = await mountBlocked(true);
		await putCurrent({
			version: 99,
			workspace: {},
			fileName: "new",
			savedAt: 2,
		});
		let dialog = await openIndicator(user);
		expect(within(dialog).getByText(AUTOSAVE_COPY.pausedDetail)).toBeTruthy();
		await user.click(
			within(dialog).getByRole("button", { name: AUTOSAVE_COPY.retry }),
		);
		await waitFor(() => expect(autosavePaused()).toBe("newer"));
		await waitFor(() =>
			expect(
				screen.queryByRole("alertdialog", { name: AUTOSAVE_COPY.readFailed }),
			).toBeNull(),
		);
		expect(screen.getByTestId("autosave-paused-live").textContent).toBe(
			`${AUTOSAVE_COPY.paused}. ${AUTOSAVE_COPY.pausedNewerDetail}`,
		);

		dialog = await openIndicator(user);
		expect(
			within(dialog).getByText(AUTOSAVE_COPY.pausedNewerDetail),
		).toBeTruthy();
		expect(
			within(dialog).queryByRole("button", { name: AUTOSAVE_COPY.discard }),
		).toBeNull();
		await user.keyboard("{Escape}");

		const toasts = screen.queryAllByText(AUTOSAVE_COPY.newer).length;
		c.select(["0/0"]);
		c.deleteSelection();
		await act(() => writeAutosave(entry(c, "dropped")));
		await waitFor(() =>
			expect(screen.queryAllByText(AUTOSAVE_COPY.newer).length).toBe(
				toasts + 1,
			),
		);
		expect(await stored()).toBeUndefined();

		await act(async () => {
			await createAutosaveStore("freshcoat").clear();
			await rereadAutosave();
		});
		expect(autosavePaused()).toBeNull();
		expect(await stored()).toBe("dropped");
		for (const toast of screen.queryAllByRole("alertdialog", {
			name: AUTOSAVE_COPY.newer,
		}))
			await user.click(within(toast).getByRole("button", { name: "Dismiss" }));
	});

	it("announces the indicator and returns focus to the status bar", async () => {
		const live = () => screen.getByTestId("autosave-paused-live").textContent;
		const { user } = await mountBlocked();
		expect(live()).toBe(
			`${AUTOSAVE_COPY.paused}. ${AUTOSAVE_COPY.pausedDetail}`,
		);
		await dismissReadFailed(user);
		const dialog = await openIndicator(user);
		await user.click(
			within(dialog).getByRole("button", { name: AUTOSAVE_COPY.retry }),
		);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: AUTOSAVE_COPY.paused }),
			).toBeNull(),
		);
		expect(live()).toBe("");
		await waitFor(() =>
			expect(document.activeElement).toBe(document.querySelector("footer")),
		);
	});

	it("warns before leaving with unsaved edits while paused", async () => {
		const { c } = await mountBlocked();
		expect(autosavePaused()).toBe("failed");
		expect(unloadWarns(c)).toBe(false);
		c.select(["0/0"]);
		c.deleteSelection();
		expect(unloadWarns(c)).toBe(true);
	});
});
