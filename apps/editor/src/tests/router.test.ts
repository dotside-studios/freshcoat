import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, test } from "vitest";
import type { EditorController } from "~/app/controller";
import { createAppRouter } from "~/app/router";

/** Where the router settles after loading `url`, and how many entries it
 *  left behind. */
async function land(url: string) {
	const history = createMemoryHistory({ initialEntries: [url] });
	const router = createAppRouter({
		controller: {} as EditorController,
		history,
	});
	await router.load();
	const { pathname, searchStr, hash } = router.state.location;
	return { at: `${pathname}${searchStr}${hash ? `#${hash}` : ""}`, history };
}

describe("routes", () => {
	test("/ goes to /edit, keeping the search", async () => {
		expect((await land("/")).at).toBe("/edit");
		expect((await land("/?theme=dark")).at).toBe("/edit?theme=dark");
		expect((await land("/?sample=certificate&theme=dark")).at).toBe(
			"/edit?sample=certificate&theme=dark",
		);
	});

	test("a hand-off from Figma survives the redirect from /", async () => {
		expect((await land("/#coat=abc_-1")).at).toBe("/edit#coat=abc_-1");
		expect((await land("/?theme=dark#open=1")).at).toBe(
			"/edit?theme=dark#open=1",
		);
		expect((await land("/#drop=1")).at).toBe("/edit#drop=1");
		expect((await land("/edit#coat=abc")).at).toBe("/edit#coat=abc");
	});

	test("the section routes stay where they are", async () => {
		expect((await land("/data?template=t_1&record=r_2")).at).toBe(
			"/data?template=t_1&record=r_2",
		);
		expect((await land("/export")).at).toBe("/export");
	});

	test("an unknown path is not a redirect loop", async () => {
		const { at } = await land("/nowhere");
		expect(at).toBe("/nowhere");
	});
});

describe("legacy redirects replace the entry", () => {
	test.each([
		["/?kit", "/kit"],
		["/?kit&theme=dark", "/kit?theme=dark"],
		["/?bench", "/bench"],
		[
			"/?bench&sample=certificate&frames=90",
			"/bench?sample=certificate&frames=90",
		],
		["/#section=data&template=t_1", "/data?template=t_1"],
		[
			"/?theme=dark#section=export&record=r_7&preset=p_y",
			"/export?theme=dark&record=r_7&preset=p_y",
		],
		["/#template=t_1&side=back", "/edit?template=t_1&side=back"],
		["/#section=nowhere", "/edit"],
		["/data#record=r_1", "/data?record=r_1"],
	])("%s → %s", async (from, to) => {
		const { at, history } = await land(from);
		expect(at).toBe(to);
		expect(history.length).toBe(1);
	});
});
