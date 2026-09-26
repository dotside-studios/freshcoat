import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { VariantSwatch } from "~/app/VariantSwatch";

describe("VariantSwatch", () => {
	afterEach(cleanup);

	test("fills with the swatch and rings it with an opaque mix of text and surface", () => {
		render(<VariantSwatch swatch="#18181b" />);
		const swatch = screen.getByTestId("variant-swatch");
		expect(swatch.style.background).toBe("rgb(24, 24, 27)");
		// Opaque: a translucent ring takes the swatch's color and vanishes
		// with a near-black swatch on the dark panel.
		expect(swatch.className).toContain(
			"color-mix(in_srgb,var(--color-fc-text)_40%,var(--swatch-surface,var(--color-fc-panel)))",
		);
		expect(swatch.className).not.toContain("swatch-ring");
	});

	test("without a color, Default is split and any other variant slashed", () => {
		const { rerender } = render(<VariantSwatch none="default" />);
		expect(screen.getByTestId("variant-swatch").style.background).toContain(
			"var(--color-fc-text) 50%",
		);
		rerender(<VariantSwatch />);
		expect(screen.getByTestId("variant-swatch").style.background).toContain(
			"--swatch-mark",
		);
	});
});
