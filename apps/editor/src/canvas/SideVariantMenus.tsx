import { CheckIcon, ChevronDownIcon } from "@freshcoat-js/ui/icons";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem, MenuSeparator } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import type { ReactNode } from "react";
import { MenuTrigger, Button as RACButton } from "react-aria-components";
import { useController } from "~/app/context";
import { VARIANT_UI } from "~/app/copy";
import { activeVariantId } from "~/doc/variant-edit";
import { useEditor } from "~/state/hooks";
import { present } from "~/state/store";

const DEFAULT = "\0default";
const PREVIOUS = "\0previous";
const NEXT = "\0next";

type Placement = "top start" | "bottom start";

/** The side shown, as a button that picks another. Plain text when the
 *  template has one side. */
export function SideMenu({
	className,
	placement = "bottom start",
}: {
	className?: string;
	placement?: Placement;
}) {
	const controller = useController();
	const names = useEditor((s) =>
		JSON.stringify(present(s)?.template_data.map((f) => f.name) ?? []),
	);
	const side = useEditor((s) => s.side);
	const sides = JSON.parse(names) as string[];
	const name = sides[side];
	if (name === undefined) return null;
	if (sides.length < 2) return <span className={className}>{name}</span>;
	return (
		<Picker
			label={`Side: ${name}`}
			testId="side-menu"
			className={className}
			text={name}
			placement={placement}
			onAction={(k) => {
				if (k === PREVIOUS || k === NEXT)
					controller.stepSide(k === NEXT ? 1 : -1);
				else controller.dispatch({ type: "setSide", side: Number(k) });
			}}
		>
			{sides.map((n, i) => (
				<MenuItem
					key={n}
					id={String(i)}
					icon={i === side ? <CheckIcon /> : null}
				>
					{n}
				</MenuItem>
			))}
			<MenuSeparator />
			<MenuItem id={PREVIOUS} shortcut="Alt+,">
				Previous side
			</MenuItem>
			<MenuItem id={NEXT} shortcut="Alt+.">
				Next side
			</MenuItem>
		</Picker>
	);
}

/** The active variant, as a button that picks another. */
export function VariantMenu({
	className,
	placement = "bottom start",
	children,
}: {
	className?: string;
	placement?: Placement;
	children: ReactNode;
}) {
	const controller = useController();
	const shown = useEditor((s) => {
		const t = present(s);
		return JSON.stringify([
			t ? (activeVariantId(t, s.variantId) ?? DEFAULT) : DEFAULT,
			(t?.variants ?? []).map((v) => [v.id, v.label]),
		]);
	});
	const [active, variants] = JSON.parse(shown) as [string, [string, string][]];
	const label =
		variants.find(([id]) => id === active)?.[1] ?? VARIANT_UI.default;
	const item = (id: string, text: string) => (
		<MenuItem key={id} id={id} icon={id === active ? <CheckIcon /> : null}>
			{text}
		</MenuItem>
	);
	return (
		<Picker
			label={`Variant: ${label}`}
			testId="variant-menu"
			className={className}
			text={children}
			placement={placement}
			onAction={(k) => {
				if (k === PREVIOUS || k === NEXT)
					controller.stepVariant(k === NEXT ? 1 : -1);
				else controller.setVariant(k === DEFAULT ? undefined : k);
			}}
		>
			{item(DEFAULT, VARIANT_UI.default)}
			{variants.map(([id, text]) => item(id, text))}
			<MenuSeparator />
			<MenuItem id={PREVIOUS} shortcut="Alt+Shift+,">
				Previous variant
			</MenuItem>
			<MenuItem id={NEXT} shortcut="Alt+Shift+.">
				Next variant
			</MenuItem>
		</Picker>
	);
}

function Picker({
	label,
	testId,
	className,
	text,
	placement,
	onAction,
	children,
}: {
	label: string;
	testId: string;
	className?: string;
	text: ReactNode;
	placement: Placement;
	onAction: (key: string) => void;
	children: ReactNode;
}) {
	return (
		<MenuTrigger>
			<RACButton
				aria-label={label}
				data-testid={testId}
				className={cn(
					"flex min-w-0 cursor-default items-center gap-0.5 rounded-[3px] outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-current",
					className,
				)}
			>
				<span className="min-w-0 truncate">{text}</span>
				<ChevronDownIcon className="size-3 shrink-0 opacity-70" />
			</RACButton>
			<Popover placement={placement}>
				<Menu aria-label={label} onAction={(k) => onAction(String(k))}>
					{children}
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}
