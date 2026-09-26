import { Button as RACButton } from "react-aria-components";
import { useController } from "~/app/context";
import { VARIANT_UI } from "~/app/copy";
import { VariantSwatch } from "~/app/VariantSwatch";
import { activeVariantId, changedLayerCount } from "~/doc/variant-edit";
import { useEditor } from "~/state/hooks";
import { present } from "~/state/store";
import BackIcon from "~icons/mingcute/back-line";

/** Across the top of the canvas while a variant is active, so every edit is
 *  plainly an edit of that variant. */
export function VariantBar() {
	const controller = useController();
	// A string of what the bar shows, so edits that leave it alone do not
	// re-render it.
	const shown = useEditor((s) => {
		const t = present(s);
		const id = t ? activeVariantId(t, s.variantId) : undefined;
		const v = id ? t?.variants?.find((x) => x.id === id) : undefined;
		if (!t || !v) return null;
		return JSON.stringify([
			v.label,
			v.swatch ?? null,
			changedLayerCount(t, v.id),
		]);
	});
	if (!shown) return null;
	const [label, swatch, changed] = JSON.parse(shown) as [
		string,
		string | null,
		number,
	];

	return (
		<section
			aria-label="Variant"
			data-testid="variant-bar"
			className="absolute inset-x-0 top-0 z-10 flex h-8 items-center gap-2 bg-fc-accent px-3 text-fc-base text-white shadow-(--shadow-fc-control) pointer-coarse:h-10"
		>
			<VariantSwatch
				swatch={swatch}
				className="shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-white)_70%,transparent)] [--swatch-mark:currentColor]"
			/>
			<span className="min-w-0 truncate font-semibold">
				{VARIANT_UI.editing(label)}
			</span>
			<span className="shrink-0 text-white/80 tabular-nums">
				{VARIANT_UI.changed(changed)}
			</span>
			<span className="flex-1" />
			<RACButton
				onPress={() => controller.setVariant(undefined)}
				className="flex h-6 shrink-0 cursor-default items-center gap-1 rounded-[3px] border border-white/50 px-2 font-medium text-white outline-none data-hovered:bg-white/15 data-pressed:bg-white/25 data-focus-visible:outline-solid data-focus-visible:outline-2 data-focus-visible:outline-white pointer-coarse:h-8"
			>
				<BackIcon className="size-3.5" />
				{VARIANT_UI.backToDefault}
			</RACButton>
		</section>
	);
}
