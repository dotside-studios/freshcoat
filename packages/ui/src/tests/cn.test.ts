import { formatShortcut } from "../kbd";
import { cn } from "../lib/cn";

describe("cn", () => {
	it("keeps a kit font size beside a kit text colour", () => {
		expect(cn("text-fc-sm", "text-fc-muted")).toBe("text-fc-sm text-fc-muted");
		expect(cn("text-fc-muted", "text-fc-xs")).toBe("text-fc-muted text-fc-xs");
	});

	it("still resolves conflicts within each group", () => {
		expect(cn("text-fc-sm", "text-fc-base")).toBe("text-fc-base");
		expect(cn("text-fc-muted", "text-fc-text")).toBe("text-fc-text");
		expect(cn("text-fc-sm text-sm")).toBe("text-sm");
		expect(cn("h-fc-control", "h-8")).toBe("h-8");
		expect(cn("size-fc-icon", "size-5")).toBe("size-5");
	});
});

describe("formatShortcut", () => {
	it("formats for Mac and elsewhere", () => {
		expect(formatShortcut("Mod+Shift+Z", true)).toBe("⌘⇧Z");
		expect(formatShortcut("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
		expect(formatShortcut("Mod++", false)).toBe("Ctrl++");
		expect(formatShortcut("Delete", true)).toBe("⌫");
	});
});
