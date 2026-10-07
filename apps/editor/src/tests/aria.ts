import { screen, within } from "@testing-library/react";
import userEvent, {
	PointerEventsCheckLevel,
} from "@testing-library/user-event";

type User = ReturnType<typeof userEvent.setup>;

/**
 * A user that clicks without waiting between events or checking
 * `pointer-events` up the tree, which jsdom resolves through its slow style
 * cascade and which none of the app's CSS sets here anyway.
 */
export function fastUser(): User {
	return userEvent.setup({
		delay: null,
		pointerEventsCheck: PointerEventsCheckLevel.Never,
	});
}

/**
 * Opens a select or combobox and clicks one of its options.
 *
 * The option is looked up inside the open listbox, not the document. jsdom
 * resolves `getComputedStyle` by cascading its whole user-agent stylesheet,
 * about 2 ms an element, and drops every cached style on any DOM change. A
 * `*ByRole` query with a name computes the name of every element of that
 * role in its container, checking each descendant's visibility on the way,
 * so the same query over a whole panel costs 100 to 300 ms after each click.
 * The popover hides everything outside it from assistive technology, so the
 * open listbox is the only one a query can see.
 */
export async function chooseOption(
	user: User,
	trigger: HTMLElement,
	option: string | RegExp,
): Promise<void> {
	await user.click(trigger);
	const listbox = await screen.findByRole("listbox");
	await user.click(within(listbox).getByRole("option", { name: option }));
}
