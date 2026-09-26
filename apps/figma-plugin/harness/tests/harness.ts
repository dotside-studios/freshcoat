import { expect, type FrameLocator, type Page } from "@playwright/test";
import type { UiToMain } from "~/shared/protocol";

export type Theme = "light" | "dark";

/** Open the harness in one state and wait for the panel to show. */
export async function openState(
	page: Page,
	state: string,
	opts: { theme?: Theme; width?: number; height?: number } = {},
): Promise<FrameLocator> {
	const { theme = "light", width = 320, height = 480 } = opts;
	await page.setViewportSize({ width, height });
	await page.goto(`/?state=${state}&theme=${theme}&w=${width}&h=${height}`);
	const ui = page.frameLocator("iframe");
	await expect(ui.getByRole("tabpanel")).toBeVisible();
	return ui;
}

/** What the UI has sent the fake main thread so far. */
export async function sent(page: Page): Promise<UiToMain[]> {
	return page.evaluate(() => window.harness.log);
}

export async function sentOfType<T extends UiToMain["type"]>(
	page: Page,
	type: T,
): Promise<Extract<UiToMain, { type: T }>[]> {
	return (await sent(page)).filter(
		(m): m is Extract<UiToMain, { type: T }> => m.type === type,
	);
}

export function status(ui: FrameLocator) {
	return ui.locator("output[aria-live=polite]");
}
