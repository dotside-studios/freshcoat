import { cn } from "@freshcoat/ui/lib/cn";

/** A variant's swatch, wherever a variant is named: the Variants list, the
 *  canvas bar, the export filmstrip and preview.
 *
 *  The ring is opaque, mixed from the text color into the surface the swatch
 *  sits on, so it contrasts with that surface in either theme. A swatch close
 *  to the surface (a near-black one on the dark panel) is then outlined by a
 *  ring it also contrasts with, and a swatch far from it reads by its fill.
 *  A translucent ring would take the swatch's own color and vanish with it.
 *
 *  Without a color, Default shows half the panel and half the text color, and
 *  any other variant a slash. `--swatch-surface` and `--swatch-mark` retune
 *  the ring and the slash for a surface other than the panel. */
export function VariantSwatch({
	swatch,
	none = "empty",
	className,
}: {
	swatch?: string | null;
	none?: "default" | "empty";
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			data-testid="variant-swatch"
			className={cn(
				"inline-block size-3.5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-fc-text)_40%,var(--swatch-surface,var(--color-fc-panel)))]",
				className,
			)}
			style={{
				background:
					swatch ||
					(none === "default"
						? "linear-gradient(135deg, var(--color-fc-panel) 50%, var(--color-fc-text) 50%)"
						: "linear-gradient(135deg, transparent 44%, var(--swatch-mark, var(--color-fc-faint)) 44% 56%, transparent 56%)"),
			}}
		/>
	);
}
